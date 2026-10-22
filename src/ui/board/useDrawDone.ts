// The end of a drawing gesture on the board (SPEC 7.2): lasso selection, group shapes (rectangle, ellipse, free shape),
// scribble strokes (one scribble per session and color; a stroke in a note goes into the note), and the eraser.

import type { Edge, ReactFlowInstance } from "@xyflow/react";
import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { Command } from "../../core/commands";
import type { Session } from "../../io/session";
import { createStampOnBoard, eraseStrokes, joinStamps, readStrokesOfPlacement, strokeOnBoard, DEFAULT_SIZE } from "../../core/actions";
import type { Id } from "../../core/types";
import type { Tool, ToolId } from "../tools/registry";
import { pointInPolygon, strokeHit, strokeToStamp, type Point } from "../tools/stroke";
import type { BoardModel } from "./boardModel";
import type { FlowNode, InlineEdit } from "./nodes";
import { cleanNumber } from "../../core/stamps";
import { blobFromPoints, boxFromDrag, createGroupShape } from "../../core/groupShapes";
import { centerOf, containsPoint, isGroupShape } from "./flowAdapter";

const ERASER_RADIUS_PX = 6;

type DrawEnv = {
  tool: Tool;
  nodes: FlowNode[];
  setNodes: Dispatch<SetStateAction<FlowNode[]>>;
  onToolChange(tool: ToolId): void;
  sticky: boolean;
  readOnly: boolean;
  runCommand(command: Command): boolean;
  session: Session;
  boardId: Id;
  flow: ReactFlowInstance<FlowNode, Edge>;
  model: BoardModel;
  scribbleColor: string | null;
  pendingSelection: MutableRefObject<Set<string> | null>;
  setEditing(editing: { nodeId: string; edit: InlineEdit } | null): void;
  /** The scribble that the strokes of this scribble session join. */
  scribbleTarget: MutableRefObject<Id | null>;
};

/** The handler for a finished drawing gesture (board points). */
export function useDrawDone({ tool, nodes, setNodes, onToolChange, sticky, readOnly, runCommand, session, boardId, flow, model, scribbleColor, pendingSelection, setEditing, scribbleTarget }: DrawEnv): (points: Point[]) => void {
  return useCallback(
    (points: Point[]) => {
      if (tool.overlay === "lasso") {
        const inside = new Set(
          nodes
            .filter((node) => node.data.node.kind !== "stub")
            .filter((node) => pointInPolygon(centerOf(node), points))
            .map((node) => node.id),
        );
        setNodes((current) => current.map((node) => ({ ...node, selected: inside.has(node.id) })));
        if (!sticky) onToolChange("select");
        return;
      }
      if (readOnly) return;
      // Group tools: a rectangle or an ellipse from corner to corner, or a free shape. A click (no drag) makes a
      // rectangle or ellipse of the default size there.
      if (tool.createsShape !== undefined) {
        const shape = tool.createsShape;
        const blob = shape === "blob" ? blobFromPoints(points) : null;
        if (shape === "blob" && blob === null) return;
        const start = points[0];
        if (start === undefined) return;
        const box = blob?.box ?? boxFromDrag(points) ?? { x: Math.round(start.x), y: Math.round(start.y), w: DEFAULT_SIZE.group.w, h: DEFAULT_SIZE.group.h };
        const { command, placeId } = createGroupShape(session.context, { boardId, box, shape, shapePath: blob?.path });
        if (runCommand(command)) {
          pendingSelection.current = new Set([placeId]);
          // A new group opens its name for typing.
          setEditing({ nodeId: placeId, edit: "title" });
        }
        if (!sticky) onToolChange("select");
        return;
      }
      if (tool.overlay === "scribble") {
        const board = strokeToStamp(points);
        if (board === null) return;
        // A stroke that starts and ends in a card that is not a board goes into that card (a note holds it).
        const host = model.nodes.find((node) => node.kind === "item" && !node.isBoard && !node.isReference && !isGroupShape(node) && containsPoint(node, points[0]!) && containsPoint(node, points.at(-1)!));
        const holder = host === undefined ? boardId : host.recordId;
        const shape = host === undefined ? board : { ...board, x: cleanNumber(board.x - host.x), y: cleanNumber(board.y - host.y) };
        // All strokes of one scribble session (in the same holder) go into one scribble.
        const target = scribbleTarget.current;
        const targetPlace = target === null ? undefined : session.store.get("links", target);
        const ink = scribbleColor;
        // A new pen color starts a new scribble (one scribble has one color).
        if (targetPlace?.kind === "place" && targetPlace.from === holder && (targetPlace.color ?? null) === ink) {
          const stroke = strokeOnBoard(shape);
          if (stroke !== null) runCommand(joinStamps(session.context, [targetPlace.id], stroke));
          return;
        }
        const { command, placeId } = createStampOnBoard(session.context, { boardId: holder, ...shape, color: ink });
        if (runCommand(command)) scribbleTarget.current = placeId;
        return;
      }
      if (tool.overlay === "erase") {
        const radius = ERASER_RADIUS_PX / flow.getZoom();
        const hits = new Map<Id, Set<number>>();
        // Scribbles on the board, and scribbles inside cards (in card coordinates).
        const holders: { id: Id; dx: number; dy: number }[] = [
          { id: boardId, dx: 0, dy: 0 },
          ...model.nodes.filter((node) => node.innerStamps.length > 0).map((node) => ({ id: node.recordId, dx: node.x, dy: node.y })),
        ];
        for (const holder of holders) {
          const local = points.map((point) => ({ x: point.x - holder.dx, y: point.y - holder.dy }));
          for (const place of session.graph.childrenOf(holder.id)) {
            if (!session.store.has("stamps", place.to)) continue;
            // A stamp that the app cannot read is not erased. It stays as it is.
            (readStrokesOfPlacement(session.context, place) ?? []).forEach((stroke, index) => {
              if (!strokeHit(stroke, local, radius)) return;
              const set = hits.get(place.id) ?? new Set<number>();
              set.add(index);
              hits.set(place.id, set);
            });
          }
        }
        if (hits.size > 0) runCommand(eraseStrokes(session.context, hits));
      }
    },
    [tool, nodes, onToolChange, readOnly, runCommand, session, boardId, flow, model, sticky, scribbleColor],
  );
}
