// The board model (boardModel.ts) as React Flow nodes and edges, and small helpers for node geometry and drags.
// No React state: BoardView.tsx calls these.

import { type Edge, type NodeChange } from "@xyflow/react";
import { DEFAULT_SIZE } from "../../core/actions";
import type { Command } from "../../core/commands";
import { type Id, type ViewStyle } from "../../core/types";
import { groupColor } from "../app/colors";
import { type Point } from "../tools/stroke";
import { SUBTITLE_HEIGHT, type BoardEdge, type BoardModel, type BoardNode } from "./boardModel";
import { COLLAPSED_HEIGHT, isCollapsed, isFullLink, isNote, type FlowNode, type InlineEdit } from "./nodes";
import { roundBoard } from "../../core/stamps";

/** The node ID of the first week row of a calendar card ("<place ID>~<n>" → "<place ID>"). */
function spanBase(nodeId: string): string {
  const mark = nodeId.indexOf("~");
  return mark === -1 ? nodeId : nodeId.slice(0, mark);
}

/** One node for each place: the week rows of a calendar card on more than one day count one time. */
export function onePerPlace(nodes: readonly FlowNode[]): FlowNode[] {
  const seen = new Set<string>();
  return nodes.filter((node) => {
    const key = node.data.node.placeId ?? node.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A card on more than one day has one node for each week row. Selecting one row selects all its rows. */
export function withSpanParts(changes: NodeChange<FlowNode>[], nodes: readonly FlowNode[]): NodeChange<FlowNode>[] {
  if (!nodes.some((node) => node.id.includes("~"))) return changes;
  const rows = new Map<string, string[]>();
  for (const node of nodes) rows.set(spanBase(node.id), [...(rows.get(spanBase(node.id)) ?? []), node.id]);
  const result: NodeChange<FlowNode>[] = [];
  const done = new Set<string>();
  for (const change of changes) {
    if (change.type !== "select") {
      result.push(change);
      continue;
    }
    for (const id of rows.get(spanBase(change.id)) ?? [change.id]) {
      if (done.has(id)) continue;
      done.add(id);
      result.push({ ...change, id });
    }
  }
  return result;
}

/**
 * A note is never larger than a sticky note (DEFAULT_SIZE.note). A larger saved size shows at that size; the data stays.
 * A flashcard always has the sticky note size. A calendar gives its cards their size.
 */
function noteCap(node: BoardNode): { w: number; h: number } {
  if (node.inCalendar) return { w: node.w, h: node.h };
  if (node.kind === "item" && node.view === "flashcard" && !node.isBoard) return { ...DEFAULT_SIZE.note };
  if (!isNote(node)) return { w: node.w, h: node.h };
  return { w: Math.min(node.w, DEFAULT_SIZE.note.w), h: Math.min(node.h, DEFAULT_SIZE.note.h) };
}

/** An open note (not in a calendar): its card fits all its text (SPEC 7.1). */
function growingNote(node: BoardNode): boolean {
  return isNote(node) && !isCollapsed(node) && !node.inCalendar;
}

export function toFlowNodes(
  model: BoardModel,
  selected: Set<string>,
  link: { linkMode: boolean; linkSourceId: string | null },
  readOnly: boolean,
  editing: { nodeId: string; edit: InlineEdit } | null,
  dropTargetId: string | null,
): FlowNode[] {
  const frames = new Map(model.nodes.filter(isGroupFrame).map((node) => [node.id, node]));
  return model.nodes.map((node) => {
    // A card in an outline is a child node of the frame: React Flow moves it with the frame.
    const frame = node.frameId === null ? undefined : frames.get(node.frameId);
    return {
    id: node.id,
    type: node.kind === "stamp" ? "stamp" : node.kind === "stub" ? "stub" : node.kind === "outline" ? "outline" : node.kind === "calendar" ? "calendar" : node.kind === "radial" ? "radial" : "card",
    position: frame === undefined ? { x: node.x, y: node.y } : { x: node.x - frame.x, y: node.y - frame.y },
    ...(frame === undefined ? {} : { parentId: frame.id }),
    // A collapsed card has no fixed width: it fits its name. React Flow measures it.
    // In an outline or a calendar, it keeps its width: the rows line up.
    width: isCollapsed(node) && !node.inCalendar && node.outlineId === null ? undefined : noteCap(node).w,
    // A link object shows its full name: its height follows the lines of the name.
    // An open note shows all its text: it is at least its own height, and taller if its text needs it.
    height: isFullLink(node) || growingNote(node) ? undefined : isCollapsed(node) && !node.inCalendar ? COLLAPSED_HEIGHT + (node.subtitle !== "" || (editing?.nodeId === node.id && editing.edit === "subtitle") ? SUBTITLE_HEIGHT : 0) : noteCap(node).h,
    ...(growingNote(node) ? { style: { minHeight: noteCap(node).h } } : {}),
    selected: selected.has(node.id),
    // Drag the frame to move the outline. Drag a row to reorder it, or out of the frame to take it out.
    // An attached object (comment, link) stays at the side of its card: "Detach" frees it.
    // A stub can be dragged (its line gets shorter or longer); it has no other move.
    draggable: (node.kind !== "stub" || node.stubAnchor != null) && !node.pinned && !readOnly && editing?.nodeId !== node.id,
    selectable: node.kind !== "stub",
    // An opened card in a full calendar day lies over its neighbors.
    // A group card (a loose area) lies behind all: behind outline and calendar frames too.
    zIndex: isGroupShape(node) ? -2 : node.kind === "outline" || node.kind === "calendar" ? -1 : node.calendarPopped ? 20 : undefined,
    // "nopan": a mouse press on a stub must not start a board pan. Then the click reaches the stub.
    // A card that is being edited does not pan either: a drag in it selects text.
    // A group card takes the pointer only at its edge and name (the node box lets clicks through to the board).
    className: [node.kind === "stub" || editing?.nodeId === node.id ? "nopan" : "", isGroupShape(node) ? "group-shape-node" : ""].filter(Boolean).join(" ") || undefined,
    data: {
      node,
      linkMode: link.linkMode,
      linkSource: link.linkSourceId === node.id,
      dropTarget: dropTargetId === node.id,
      editing: editing?.nodeId === node.id ? editing.edit : null,
    },
  };
  });
}

export function toFlowEdges(model: BoardModel, selected: Set<string>): Edge[] {
  return model.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    selected: selected.has(edge.id),
    selectable: edge.kind === "relation",
    deletable: edge.kind === "relation",
    type: "center",
    className: `edge-${edge.kind}${edge.passage === true ? " edge-passage" : ""}`,
    style: edgeStyle(edge),
    data: {
      linkId: edge.linkId,
      color: edgeStyle(edge).stroke ?? (edge.kind === "attach" ? "#ff2bd6" : edge.kind !== "relation" ? "var(--accent)" : undefined),
      start: edge.start,
      end: edge.end,
      offset: edge.offset,
    },
  }));
}

/** A link made from text, on the board: a dashed gray line (SPEC 7.11). */
const PASSAGE_EDGE = "var(--text-faint)";

/** The line of an edge: its own color, else the color of its group. Dashed: a link made from text, or a dashed link. */
function edgeStyle(edge: BoardEdge): { stroke?: string; strokeDasharray?: string } {
  if (edge.passage === true) return { stroke: edge.color ?? PASSAGE_EDGE, strokeDasharray: DASHES };
  const stroke = edge.color ?? (edge.group === undefined ? undefined : groupColor(edge.group));
  return { ...(stroke === undefined ? {} : { stroke }), ...(edge.dashed === true ? { strokeDasharray: DASHES } : {}) };
}

const DASHES = "6 4";

export function linkIdOf(edge: Edge): Id[] {
  const linkId = (edge.data as { linkId?: Id | null } | undefined)?.linkId;
  return linkId === null || linkId === undefined ? [] : [linkId];
}

export function recordOfNode(model: BoardModel, nodeId: string): Id | null {
  return model.nodes.find((node) => node.id === nodeId)?.recordId ?? null;
}

export function pointerOf(event: globalThis.MouseEvent | TouchEvent): { clientX: number; clientY: number } {
  if ("clientX" in event) return { clientX: event.clientX, clientY: event.clientY };
  const touch = event.changedTouches[0] ?? event.touches[0];
  return { clientX: touch?.clientX ?? 0, clientY: touch?.clientY ?? 0 };
}

/** The move of a dragged node from its saved position, rounded to the board precision. */
export function moveOfDrag(node: { position: Point; data: { node: { x: number; y: number } } }): Point {
  return {
    x: roundBoard(node.position.x - node.data.node.x),
    y: roundBoard(node.position.y - node.data.node.y),
  };
}

export function centerOf(node: FlowNode): Point {
  const w = node.measured?.width ?? node.width ?? node.data.node.w;
  const h = node.measured?.height ?? node.height ?? node.data.node.h;
  return { x: node.position.x + w / 2, y: node.position.y + h / 2 };
}

/** True if a board point is inside a node box (absolute position). */
export function isInside(position: Point, node: FlowNode, point: Point): boolean {
  const width = node.measured?.width ?? node.width ?? 0;
  const height = node.measured?.height ?? node.height ?? 0;
  return point.x >= position.x && point.x <= position.x + width && point.y >= position.y && point.y <= position.y + height;
}

/** True if a board point is inside a card of the model. */
export function containsPoint(node: BoardNode, point: Point): boolean {
  return point.x >= node.x && point.x <= node.x + node.w && point.y >= node.y && point.y <= node.y + node.h;
}

export function mergeCommands(...commands: Command[]): Command {
  const ops = commands.flatMap((command) => command.ops);
  const labels = commands.filter((command) => command.ops.length > 0).map((command) => command.label);
  return { label: labels.join(" + ") || "Delete", ops };
}

/** The field that a new card opens for typing. */
export function firstEdit(view: ViewStyle): InlineEdit {
  if (view === "text" || view === "comment" || view === "todo" || view === "quote") return "body";
  if (view === "weblink") return "url";
  return "title";
}


/** Where the cards of a calendar go when they leave it: in a column at its right side. */
export function calendarExitPositions(frame: BoardNode, placeIds: readonly Id[]): Map<Id, { x: number; y: number }> {
  return new Map(placeIds.map((placeId, index) => [placeId, { x: roundBoard(frame.x + frame.w + 40), y: roundBoard(frame.y + index * (COLLAPSED_HEIGHT + 12)) }]));
}

/** True for a group card (a loose area of the board, view "group"). */
/** True for the frame of a group: an outline, a calendar, or the core of a radial. Its cards are its child nodes. */
export function isGroupFrame(node: BoardNode): boolean {
  return node.kind === "outline" || node.kind === "calendar" || node.kind === "radial";
}

export function isGroupShape(node: BoardNode): boolean {
  return node.kind === "item" && node.view === "group" && !node.isBoard;
}
