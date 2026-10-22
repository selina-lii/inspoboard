// Dragging cards on the board (SPEC 7.1): the drop target under the pointer (a board card, a note for scribbles, an
// outline or a calendar), group cards that carry the cards in their shapes, drops on the link bench, the compare bench,
// or an open page, outline rows (reorder or take out), calendar days, and plain moves (one command).

import type { Edge, ReactFlowInstance } from "@xyflow/react";
import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { Session } from "../../io/session";
import { moveIntoBoard, setStubPlace, moveIntoNote, setPlacementRects, type Rect } from "../../core/actions";
import type { Command } from "../../core/commands";
import { createOutline, moveOutline, moveRowTo, removeFromOutline } from "../../core/outline";
import { SMALL_KINDS, type Id, type PlaceLink } from "../../core/types";
import { calendarPointAt, addDays, snapToTime, reorderInDay, snapToDay } from "../../core/groups";
import type { Point } from "../tools/stroke";
import { cardHeight, OUTLINE_BAR, OUTLINE_PADDING, type BoardModel, type BoardNode } from "./boardModel";
import type { FlowNode } from "./nodes";
import { cleanNumber, roundBoard } from "../../core/stamps";
import { membersOf } from "../../core/groupShapes";
import { benchSlotAt, hoverBench, registerBenchSource, sendToBench } from "../app/LinkBench";
import { compareSlotAt, sendToCompareBench } from "../plugins/compare/CompareBench";
import { pagePointAt, registerBoardDrop } from "../app/boardDrop";
import { isPageHome, moveIn } from "../../core/inside";
import { pointerOf, moveOfDrag, isInside, mergeCommands, isGroupFrame, isGroupShape } from "./flowAdapter";
import { joinRadial, placeInRadial } from "../../core/radial";


type DragEnv = {
  session: Session;
  runCommand(command: Command): boolean;
  readOnly: boolean;
  flow: ReactFlowInstance<FlowNode, Edge>;
  boardId: Id;
  model: BoardModel;
  heightOf(place: PlaceLink): number;
  comparePlugin: boolean;
  setNodes: Dispatch<SetStateAction<FlowNode[]>>;
  setDropTargetId: Dispatch<SetStateAction<string | null>>;
  setLayoutRefresh: Dispatch<SetStateAction<number>>;
};

/** The drag handlers of the board, and the board as a drop place for small items and bench ghosts. */
export function useCardDrag({ session, runCommand, readOnly, flow, boardId, model, heightOf, comparePlugin, setNodes, setDropTargetId, setLayoutRefresh }: DragEnv) {
  /**
   * What a drop at a screen point does with the dragged nodes:
   * - "board": a board card. The records move into that board.
   * - "note": a card that is not a board. Dragged scribbles go into it (magnetic drop).
   * - "outline": an outline frame. Dragged cards join the outline.
   * Cards come before frames: a frame is large and lies under its cards.
   */
  const dropTargetAt = useCallback(
    (clientX: number, clientY: number, dragged: readonly FlowNode[]): { node: FlowNode; kind: "board" | "note" | "outline" | "calendar" | "radial" } | null => {
      const point = flow.screenToFlowPosition({ x: clientX, y: clientY });
      const draggedIds = new Set(dragged.map((node) => node.id));
      const onlyScribbles = dragged.every((node) => node.data.node.kind === "stamp");
      const onlyFreeCards = dragged.every((node) => node.data.node.kind === "item" && node.data.node.outlineId === null);
      const onlyCards = dragged.every((node) => node.data.node.kind === "item" && !node.data.node.pinned);
      // A group card is never dropped into anything: it moves with its cards. A stub only moves.
      if (dragged.some((node) => isGroupShape(node.data.node) || node.data.node.kind === "stub")) return null;
      let frame: FlowNode | null = null;
      for (const node of flow.getNodes()) {
        // The rows of a dragged outline move with it: they are no target.
        if (draggedIds.has(node.id) || (node.data.node.frameId !== null && draggedIds.has(node.data.node.frameId)) || !isInside(flow.getInternalNode(node.id)?.internals.positionAbsolute ?? node.position, node, point)) continue;
        const data = node.data.node;
        if (data.kind === "outline") {
          if (onlyFreeCards && !dragged.some((other) => other.data.node.outlineId === data.outlineId)) frame = node;
          continue;
        }
        // A radial core takes free cards (and cards of other groups): they join the radial. It is small: it wins.
        if (data.kind === "radial") {
          if (onlyCards && dragged.every((other) => other.data.node.outlineId !== data.outlineId)) return { node, kind: "radial" };
          continue;
        }
        // A calendar takes cards onto the day under the pointer (also its own cards: they move to that day).
        if (data.kind === "calendar") {
          if (onlyCards && dragged.every((other) => other.data.node.outlineId === null || other.data.node.outlineId === data.outlineId)) frame = node;
          continue;
        }
        if (data.kind !== "item" || data.isReference || isGroupShape(data)) continue;
        if (data.isBoard) return { node, kind: "board" };
        if (onlyScribbles) return { node, kind: "note" };
      }
      if (frame === null) return null;
      return { node: frame, kind: frame.data.node.kind === "calendar" ? "calendar" : "outline" };
    },
    [flow],
  );

  const overBench = useRef<0 | 1 | "bench" | null>(null);
  /**
   * A drag of group cards: the cards in their shapes (at the drag start) move with them. `members`: node ID ->
   * its position at the start. `start`: the position of the grabbed node at the start.
   */
  const groupDrag = useRef<{ start: Point; members: Map<string, Point> } | null>(null);
  const onNodeDragStart = useCallback(
    (_event: globalThis.MouseEvent | TouchEvent, grabbed: FlowNode, dragged: FlowNode[]) => {
      groupDrag.current = null;
      const groups = dragged.filter((node) => isGroupShape(node.data.node));
      if (groups.length === 0) return;
      const draggedIds = new Set(dragged.map((node) => node.id));
      // Free nodes only (an outline row moves with its frame; a frame in a group moves its rows).
      const others = flow
        .getNodes()
        // An attached object (pinned) stays at the side of its card: it follows the card, not the group.
        .filter((node) => node.parentId === undefined && node.data.node.kind !== "stub" && !node.data.node.pinned)
        .map((node) => ({ key: node.id, box: { x: node.data.node.x, y: node.data.node.y, w: node.data.node.w, h: node.data.node.h }, group: isGroupShape(node.data.node), node }));
      const members = new Map<string, Point>();
      // A group in a dragged group brings its own cards too.
      const queue = [...groups];
      const seen = new Set(queue.map((node) => node.id));
      while (queue.length > 0) {
        const group = queue.shift()!;
        const data = group.data.node;
        for (const member of membersOf({ key: group.id, box: { x: data.x, y: data.y, w: data.w, h: data.h }, shape: data.shape, shapePath: data.shapePath }, others)) {
          if (draggedIds.has(member.key) || members.has(member.key)) continue;
          members.set(member.key, { ...member.node.position });
          if (member.group && !seen.has(member.key)) {
            seen.add(member.key);
            queue.push(member.node);
          }
        }
      }
      if (members.size > 0) groupDrag.current = { start: { ...grabbed.position }, members };
    },
    [flow],
  );
  // A small item dragged out of a page lands on the board here (SPEC 1.1). Only on the board itself, not on a window.
  useEffect(
    () =>
      registerBoardDrop((clientX, clientY) => {
        const element = document.elementFromPoint(clientX, clientY);
        if (element?.closest(".react-flow") == null || element.closest(".text-page, .react-flow__node") !== null) return null;
        const point = flow.screenToFlowPosition({ x: clientX, y: clientY });
        return { boardId, x: roundBoard(point.x), y: roundBoard(point.y) };
      }),
    [flow, boardId],
  );
  // A picked bench slot: a press on a card here drags a ghost copy of its item to the bench.
  useEffect(
    () =>
      registerBenchSource((element) => {
        const nodeId = element.closest(".react-flow__node")?.getAttribute("data-id");
        const node = nodeId == null ? undefined : flow.getNode(nodeId);
        return node?.data.node.kind === "item" ? node.data.node.recordId : null;
      }),
    [flow],
  );

  const onNodeDrag = useCallback(
    (event: globalThis.MouseEvent | TouchEvent, _node: FlowNode, dragged: FlowNode[]) => {
      const { clientX, clientY } = pointerOf(event);
      // The cards in a dragged group follow it.
      const carry = groupDrag.current;
      if (carry !== null) {
        const dx = _node.position.x - carry.start.x;
        const dy = _node.position.y - carry.start.y;
        setNodes((current) => current.map((node) => {
          const start = carry.members.get(node.id);
          return start === undefined ? node : { ...node, position: { x: start.x + dx, y: start.y + dy } };
        }));
      }
      const target = dropTargetAt(clientX, clientY, dragged);
      setDropTargetId((current) => (current === (target?.node.id ?? null) ? current : (target?.node.id ?? null)));
      // Over the link bench: the bench shows the slot that takes the card.
      const benchSlot = benchSlotAt(clientX, clientY);
      if (benchSlot !== overBench.current) {
        overBench.current = benchSlot;
        hoverBench(benchSlot);
      }
    },
    [dropTargetAt],
  );

  const onNodeDragStop = useCallback(
    (event: globalThis.MouseEvent | TouchEvent, grabbed: FlowNode, dragged: FlowNode[]) => {
      setDropTargetId(null);
      // The cards that a dragged group carries are moved with it (in the last step, one command).
      const carried = groupDrag.current === null ? [] : flow.getNodes().filter((node) => groupDrag.current!.members.has(node.id));
      groupDrag.current = null;
      if (overBench.current !== null) hoverBench(null);
      overBench.current = null;
      const { clientX, clientY } = pointerOf(event);
      // A stub (a linked record on a different board): its place next to its card is kept (length and side of its line).
      const stubAnchor = grabbed.data.node.stubAnchor;
      if (grabbed.data.node.kind === "stub") {
        if (stubAnchor != null && session.store.has("links", stubAnchor.placeId)) {
          runCommand(setStubPlace(session.context, stubAnchor.placeId, grabbed.data.node.recordId, [grabbed.position.x - stubAnchor.x, grabbed.position.y - stubAnchor.y]));
        }
        setLayoutRefresh((count) => count + 1);
        return;
      }
      // A card dropped on the compare bench (lab) goes into a slot. The card does not move.
      const compareSlot = comparePlugin ? compareSlotAt(clientX, clientY) : null;
      if (compareSlot !== null && grabbed.data.node.kind === "item" && session.store.has("items", grabbed.data.node.recordId)) {
        sendToCompareBench({ itemId: grabbed.data.node.recordId }, compareSlot === "bench" ? undefined : compareSlot);
        setLayoutRefresh((count) => count + 1);
        return;
      }
      // A card dropped on the link bench goes into a slot. The card does not move.
      const benchSlot = benchSlotAt(clientX, clientY);
      if (benchSlot !== null && grabbed.data.node.kind === "item" && session.store.has("items", grabbed.data.node.recordId)) {
        sendToBench({ itemId: grabbed.data.node.recordId }, benchSlot === "bench" ? undefined : benchSlot);
        setLayoutRefresh((count) => count + 1);
        return;
      }
      // A small card dropped on an open page goes inside the page (SPEC 1.1). One undo step.
      const inPage = pagePointAt(clientX, clientY);
      const grabbedNode = grabbed.data.node;
      if (inPage !== null && !readOnly && grabbedNode.kind === "item" && grabbedNode.placeId !== null && !grabbedNode.isBoard && SMALL_KINDS.includes(grabbedNode.view) && inPage.pageId !== grabbedNode.recordId && isPageHome(session.store, session.graph, inPage.pageId)) {
        try {
          runCommand(moveIn(session.context, grabbedNode.placeId, inPage.pageId, inPage.at).command);
        } catch (problem) {
          console.error(problem);
        }
        setLayoutRefresh((count) => count + 1);
        return;
      }
      const target = dropTargetAt(clientX, clientY, dragged);
      const placeIds = [...new Set(dragged.flatMap((node) => (node.data.node.placeId === null ? [] : [node.data.node.placeId])))];
      if (target?.kind === "board") {
        // A dragged outline (or calendar) frame brings its whole tree; a row brings its child rows.
        const groupIds = dragged.flatMap((node) => (isGroupFrame(node.data.node) && node.data.node.outlineId !== null ? [node.data.node.outlineId] : []));
        setLayoutRefresh((count) => count + 1);
        runCommand(moveIntoBoard(session.context, placeIds, target.node.data.node.recordId, groupIds));
        return;
      }
      // A calendar: the cards go onto the day under the pointer.
      if (target?.kind === "calendar" && target.node.data.node.outlineId !== null) {
        const calendarId = target.node.data.node.outlineId;
        const calendar = session.store.get("outlines", calendarId);
        const frame = target.node.data.node;
        const pointer = flow.screenToFlowPosition({ x: clientX, y: clientY });
        // The week view: the time is where the top of the card is (as Google Calendar), the day is under the pointer.
        const top = flow.getInternalNode(grabbed.id)?.internals.positionAbsolute.y ?? pointer.y;
        const place = calendar === undefined ? null : calendarPointAt(calendar, frame.calendarView, frame.calendarDay, frame.calendarView === "week" ? { x: pointer.x, y: top + 2 } : pointer, frame.calendarLanes);
        const day = place?.day ?? null;
        setLayoutRefresh((count) => count + 1);
        if (frame.calendarView === "week") {
          if (day !== null) runCommand(snapToTime(session.context, placeIds, calendarId, addDays(day, -grabbed.data.node.spanOffset), place!.minutes));
          return;
        }
        // One card dropped on its own day: a new place in the order of the day (before the card under the pointer).
        const own = grabbed.data.node.placeId === null ? undefined : session.store.get("links", grabbed.data.node.placeId);
        if (day !== null && frame.calendarView === "month" && placeIds.length === 1 && own?.kind === "place" && own.outline === calendarId && own.day === day && own.until === undefined) {
          const point = flow.screenToFlowPosition({ x: clientX, y: clientY });
          const sameDay = flow
            .getNodes()
            .filter((node) => node.id !== grabbed.id && node.data.node.inCalendar && node.data.node.placeId !== null && (session.store.get("links", node.data.node.placeId) as PlaceLink | undefined)?.day === day && (session.store.get("links", node.data.node.placeId) as PlaceLink | undefined)?.outline === calendarId)
            .sort((left, right) => left.position.y - right.position.y);
          const before = sameDay.find((node) => node.position.y + (node.data.node.h ?? 0) / 2 > point.y);
          runCommand(reorderInDay(session.context, own.id, before?.data.node.placeId ?? null));
          return;
        }
        // A later week row of a card on more than one day: the card starts that many days before the drop day.
        if (day !== null) runCommand(snapToDay(session.context, placeIds, calendarId, addDays(day, -grabbed.data.node.spanOffset)));
        return;
      }
      // A radial core: the cards join the radial (they go around the core).
      if (target?.kind === "radial" && target.node.data.node.outlineId !== null) {
        setLayoutRefresh((count) => count + 1);
        runCommand(joinRadial(session.context, target.node.data.node.outlineId, placeIds));
        return;
      }
      // Outline rows: a drop in the frame reorders the row. A drop outside the frame takes the rows out there.
      // Cards of a radial: a drop in its ball keeps them in it, at the place of the drop (`offset`).
      const members = dragged.filter((node) => node.data.node.frameId !== null);
      if (members.length > 0 && members.length === dragged.length) {
        const frame = flow.getNode(members[0]!.data.node.frameId!);
        const point = flow.screenToFlowPosition({ x: clientX, y: clientY });
        // The rows go to their outline place again (also if the order did not change).
        setLayoutRefresh((count) => count + 1);
        if (frame !== undefined && frame.data.node.kind === "radial") {
          const core = frame.data.node;
          if (Math.hypot(point.x - (core.x + core.w / 2), point.y - (core.y + core.h / 2)) <= core.radialRadius + 60) {
            const centers = new Map<Id, { x: number; y: number }>();
            for (const node of members) {
              const absolute = flow.getInternalNode(node.id)?.internals.positionAbsolute ?? node.position;
              if (node.data.node.placeId !== null) centers.set(node.data.node.placeId, { x: absolute.x + node.data.node.w / 2, y: absolute.y + node.data.node.h / 2 });
            }
            if (core.outlineId !== null) runCommand(placeInRadial(session.context, core.outlineId, centers));
            return;
          }
        } else if (frame !== undefined && isInside(frame.position, frame, point)) {
          if (members.length === 1 && grabbed.data.node.placeId !== null) runCommand(reorderCommand(grabbed, point));
          return;
        }
        const positions = new Map<Id, { x: number; y: number }>();
        for (const node of members) {
          const absolute = flow.getInternalNode(node.id)?.internals.positionAbsolute ?? node.position;
          if (node.data.node.placeId !== null) positions.set(node.data.node.placeId, { x: roundBoard(absolute.x), y: roundBoard(absolute.y) });
        }
        runCommand(removeFromOutline(session.context, [...positions.keys()], heightOf, positions));
        return;
      }
      if (target?.kind === "note" && target.node.data.node.placeId !== null) {
        const notePlaceId = target.node.data.node.placeId;
        // Each scribble keeps its place on the screen: the drop position, inside the note bounds.
        const move = moveOfDrag(grabbed);
        const into = dragged.flatMap((node) => {
          const { placeId, x, y } = node.data.node;
          return placeId === null ? [] : [moveIntoNote(session.context, placeId, notePlaceId, { x: x + move.x, y: y + move.y })];
        });
        runCommand(mergeCommands(...into));
        return;
      }
      if (target?.kind === "outline" && target.node.data.node.outlineId !== null) {
        const member = session.graph.membersOf(target.node.data.node.outlineId)[0];
        if (member !== undefined) runCommand(createOutline(session.context, boardId, [member.id, ...placeIds]).command);
        return;
      }
      // One move for the whole group: the move of the grabbed node, rounded one time.
      // Each node gets its saved position plus this move. Thus the distances between
      // the nodes never change (rounding each node by itself could change them).
      const move = moveOfDrag(grabbed);
      if (move.x === 0 && move.y === 0) return;
      const rects = new Map<Id, Partial<Rect>>();
      const commands: Command[] = [];
      for (const node of [...dragged, ...carried]) {
        const { placeId, x, y, kind, outlineId } = node.data.node;
        // An outline frame moves its outline. The cards follow from the outline layout.
        if (kind === "outline" && outlineId !== null) {
          commands.push(moveOutline(session.context, outlineId, cleanNumber(x + OUTLINE_PADDING + move.x), cleanNumber(y + OUTLINE_PADDING + OUTLINE_BAR + move.y)));
        } else if (kind === "radial" && outlineId !== null) {
          // A radial is at the center of its core: its cards follow.
          commands.push(moveOutline(session.context, outlineId, cleanNumber(x + node.data.node.w / 2 + move.x), cleanNumber(y + node.data.node.h / 2 + move.y)));
        } else if (kind === "calendar" && outlineId !== null) {
          // A calendar frame is its record box: its days and cards follow.
          commands.push(moveOutline(session.context, outlineId, cleanNumber(x + move.x), cleanNumber(y + move.y)));
        } else if (placeId !== null && outlineId === null) {
          rects.set(placeId, { x: cleanNumber(x + move.x), y: cleanNumber(y + move.y) });
        }
      }
      runCommand(mergeCommands(setPlacementRects(session.context, rects), ...commands));
    },
    [runCommand, session, dropTargetAt, boardId, flow, heightOf, comparePlugin],
  );

  /** A row dropped at a board point: before or after the nearest other row of its outline. */
  const reorderCommand = (grabbed: FlowNode, point: Point): Command => {
    const placeId = grabbed.data.node.placeId!;
    const outlineId = grabbed.data.node.outlineId!;
    const horizontal = session.store.get("outlines", outlineId)?.direction === "horizontal";
    let best: { node: BoardNode; distance: number } | null = null;
    const heightOfNode = (node: BoardNode): number => {
      const place = node.placeId === null ? undefined : session.store.get("links", node.placeId);
      return place?.kind === "place" ? cardHeight(session.store, session.graph, place) : node.h;
    };
    for (const node of model.nodes) {
      if (node.outlineId !== outlineId || node.frameId === null || node.placeId === placeId) continue;
      const center = { x: node.x + node.w / 2, y: node.y + heightOfNode(node) / 2 };
      const distance = Math.hypot(center.x - point.x, center.y - point.y);
      if (best === null || distance < best.distance) best = { node, distance };
    }
    if (best === null || best.node.placeId === null) return { label: "Move row", ops: [] };
    const target = best.node;
    const place = session.store.get("links", target.placeId!);
    const height = heightOfNode(target);
    // Top rows of a horizontal outline are in a row: left or right. All other rows: above or below.
    const topRow = place?.kind === "place" && place.parent === undefined;
    const side = horizontal && topRow ? (point.x < target.x + target.w / 2 ? "before" : "after") : point.y < target.y + height / 2 ? "before" : "after";
    return moveRowTo(session.context, placeId, target.placeId!, side);
  };

  return { onNodeDragStart, onNodeDrag, onNodeDragStop };
}
