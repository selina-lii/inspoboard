// Edges from center to center. The edge layer is below the cards, so each card hides
// the part of the line inside it. The end shapes (caps) sit where the line meets the card edge.

import { BaseEdge, EdgeLabelRenderer, useInternalNode, type Edge, type EdgeProps, type InternalNode } from "@xyflow/react";
import type { LinkCap } from "../../core/types";
import type { BoardNode } from "./boardModel";
import { isCollapsed } from "./nodes";

export type CenterEdgeData = { linkId: string | null; color?: string; start: LinkCap; end: LinkCap; offset: number };
export type CenterEdgeType = Edge<CenterEdgeData, "center">;

const CAP_SIZE = 9;
/** Space between the card edge and the cap. */
const CAP_GAP = 2;

type Box = { cx: number; cy: number; halfW: number; halfH: number };
type Point = { x: number; y: number };

export function CenterEdge({ id, source, target, label, selected, data, style }: EdgeProps<CenterEdgeType>) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  if (sourceNode === undefined || targetNode === undefined) return null;
  // Side offset for parallel lines. Its direction comes from the lower node ID to the higher node ID.
  const offset = data?.offset ?? 0;
  const [low, high] = source < target ? [sourceNode, targetNode] : [targetNode, sourceNode];
  const lowBox = boxOf(low);
  const highBox = boxOf(high);
  const baseLength = Math.hypot(highBox.cx - lowBox.cx, highBox.cy - lowBox.cy) || 1;
  const shift = { x: (-(highBox.cy - lowBox.cy) / baseLength) * offset, y: ((highBox.cx - lowBox.cx) / baseLength) * offset };
  const from = moveBox(boxOf(sourceNode), shift);
  const to = moveBox(boxOf(targetNode), shift);
  const fromCenter = { x: from.cx, y: from.cy };
  const toCenter = { x: to.cx, y: to.cy };
  const middle = { x: (from.cx + to.cx) / 2, y: (from.cy + to.cy) / 2 };
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  const length = Math.hypot(dx, dy);
  const color = selected ? "var(--accent)" : (data?.color ?? "var(--edge)");

  // The caps point out of the line: the end cap points to the target, the start cap to the source.
  const caps =
    length === 0 || data === undefined ? null : (
      <g className="center-edge-caps" style={{ color }}>
        {capShape(data.end, borderPoint(to, -dx / length, -dy / length), Math.atan2(dy, dx))}
        {capShape(data.start, borderPoint(from, dx / length, dy / length), Math.atan2(-dy, -dx))}
      </g>
    );

  return (
    <>
      <BaseEdge id={id} path={`M${fromCenter.x},${fromCenter.y}L${toCenter.x},${toCenter.y}`} style={style} interactionWidth={14} />
      {caps}
      {label !== undefined && label !== "" && (
        <EdgeLabelRenderer>
          <div
            className={`center-edge-label${selected ? " selected" : ""}`}
            style={{ transform: `translate(-50%, -50%) translate(${middle.x}px, ${middle.y}px)` }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

function boxOf(node: InternalNode): Box {
  const { x, y } = node.internals.positionAbsolute;
  const width = node.measured.width ?? node.width ?? 0;
  const height = node.measured.height ?? node.height ?? 0;
  // A row of an outline is as wide as the outline, but a row that shows only its name uses only its left part
  // (marker and name). The line goes to that part, not to the middle of the row.
  const used = usedWidth(node);
  const shown = used === null ? width : Math.min(width, used);
  return { cx: x + shown / 2, cy: y + height / 2, halfW: shown / 2, halfH: height / 2 };
}

/** Space around the marker and the name of a card (padding, gap, type icon). */
const ROW_SPACE = 44;
let measure: CanvasRenderingContext2D | null = null;

/** The width that the marker and the name of a folded outline row use (board units), or null for other cards. */
function usedWidth(node: InternalNode): number | null {
  const card = (node.data as { node?: BoardNode } | undefined)?.node;
  if (card === undefined || card.kind !== "item" || card.outlineId === null || !isCollapsed(card)) return null;
  measure ??= document.createElement("canvas").getContext("2d");
  if (measure === null) return null;
  measure.font = `600 13px ${getComputedStyle(document.body).fontFamily}`;
  const name = card.title !== "" ? card.title : (card.preview.split("\n").find((line) => line.trim() !== "")?.trim() ?? "Untitled");
  return Math.ceil(measure.measureText(`${card.marker} ${name}`).width) + ROW_SPACE;
}

/** The same box, moved. The exit point of a moved line stays near the card edge for small moves. */
function moveBox(box: Box, shift: Point): Box {
  return { ...box, cx: box.cx + shift.x, cy: box.cy + shift.y };
}

/** The point where a line from the box center in direction (ux, uy) leaves the box, plus a small gap. */
function borderPoint(box: Box, ux: number, uy: number): Point {
  const tx = ux === 0 ? Infinity : box.halfW / Math.abs(ux);
  const ty = uy === 0 ? Infinity : box.halfH / Math.abs(uy);
  const t = Math.min(tx, ty) + CAP_GAP;
  return { x: box.cx + ux * t, y: box.cy + uy * t };
}

/**
 * Draws one cap. `tip` is the point at the card edge. `angle` points from the line into the card.
 * The cap lies on the line, behind the tip.
 */
function capShape(cap: LinkCap, tip: Point, angle: number) {
  if (cap === "none") return null;
  const s = CAP_SIZE;
  const transform = `translate(${tip.x} ${tip.y}) rotate(${(angle * 180) / Math.PI})`;
  const filled = { fill: "currentColor", stroke: "currentColor", strokeWidth: 1 };
  const open = { fill: "var(--bg-board)", stroke: "currentColor", strokeWidth: 1.5 };
  switch (cap) {
    case "arrow":
      return <path transform={transform} d={`M0,0L${-s},${-s * 0.55}L${-s},${s * 0.55}Z`} {...filled} />;
    case "open-arrow":
      return <path transform={transform} d={`M${-s},${-s * 0.6}L0,0L${-s},${s * 0.6}`} fill="none" stroke="currentColor" strokeWidth={1.5} />;
    case "circle":
    case "filled-circle":
      return <circle transform={transform} cx={-s * 0.45} cy={0} r={s * 0.42} {...(cap === "circle" ? open : filled)} />;
    case "square":
    case "filled-square":
      return <rect transform={transform} x={-s * 0.8} y={-s * 0.4} width={s * 0.8} height={s * 0.8} {...(cap === "square" ? open : filled)} />;
    case "diamond":
    case "filled-diamond":
      return (
        <path
          transform={transform}
          d={`M0,0L${-s * 0.5},${-s * 0.45}L${-s},0L${-s * 0.5},${s * 0.45}Z`}
          {...(cap === "diamond" ? open : filled)}
        />
      );
  }
}

export const EDGE_TYPES = { center: CenterEdge };
