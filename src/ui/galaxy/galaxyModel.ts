// Galaxy model: what the 3D view shows for one board. Pure function of the store.
// See docs/SPEC.md section 7.3.
//
// - Depth 1: the children of the board, at their `p3` position.
// - Depth 2: the children of each child, as a small cluster around that child.
// - If `p3` is missing, the position comes from the 2D layout, centered on the board. The depth (z) is spread
//   in a fixed pseudo-random way from the place ID, so that many cards fill a volume, not a plane.
//   Cards in an outline or a calendar stay in the plane: their order is their meaning.

import type { GraphIndex } from "../../core/graph";
import type { Store } from "../../core/store";
import { DEFAULT_END_CAP, DEFAULT_START_CAP, type Id, type LinkCap, type PlaceLink, type Point3, type ViewStyle } from "../../core/types";
import { snippetOf } from "../board/boardModel";
import { boardGroupType, cardsByDay, groupTitle, isCalendar } from "../../core/groups";
import { outlineRows } from "../../core/outline";
import { t } from "../i18n/i18n";

/** 2D board units for one 3D unit. */
export const UNITS_PER_3D = 100;
/** Size of a cluster relative to its parent board. */
export const CLUSTER_SCALE = 0.25;
/** Distance of a satellite (a scribble in a note) from its note. */
export const SATELLITE_ORBIT = 0.45;
/** Depth of the spread of cards with no `p3`, relative to the larger side of their 2D area. */
export const DEPTH_SPREAD = 0.6;

export type GalaxyPointKind = "item" | "stamp" | "ghost" | "group";

/** A row of the tree list of an outline group (it shows on hover). */
export type TreeRow = { depth: number; label: string };

export type GalaxyPoint = {
  /** Unique key: the place link ID. */
  key: Id;
  placeId: Id;
  recordId: Id;
  depth: 1 | 2;
  kind: GalaxyPointKind;
  /** View style of the placement: note, page, or text. */
  view: ViewStyle;
  /** The name. Empty for a note with no name: then the view shows no label. */
  label: string;
  /** Text for the hover label: the name, or the start of the text. */
  hoverLabel: string;
  /** True if the item lives on a different board (a reference). */
  isReference: boolean;
  /** True for a scribble that a note holds: it orbits the note. */
  satellite: boolean;
  /** True if the label is a code that the app made. */
  codeName: boolean;
  childCount: number;
  /** True if the item is a board: it has children, or the user made it a board. */
  isBoard: boolean;
  /** World position. */
  position: Point3;
  /** For depth 2: the world position of the parent point. */
  parentPosition: Point3 | null;
  /** A group point (kind "group"), or a board that holds only one group: the group type. */
  groupType: "outline" | "calendar" | null;
  /** Outline group: its rows, for the tree list. */
  tree: TreeRow[];
  /** Calendar group: the number of days that have cards. The calendar is larger with more days. */
  days: number;
};

export type GalaxyLine = {
  key: string;
  from: Point3;
  to: Point3;
  /** The points at the ends. The view needs their size to put the arrowheads at the dot surface. */
  fromKey: Id;
  toKey: Id;
  kind: "relation" | "cluster";
  group?: string;
  start: LinkCap;
  end: LinkCap;
};

/** `center`: the board point at the middle of the 3D view (the middle of the cards). The 2D layout maps around it. */
/** `back`: the smallest z of the depth-1 points. The board background image lies behind it. */
export type GalaxyModel = { points: GalaxyPoint[]; lines: GalaxyLine[]; center: { x: number; y: number }; back: number };

/** A board point (2D) in the 3D view: the plane of the board, around its middle. */
export function boardToWorld(model: GalaxyModel, x: number, y: number): Point3 {
  return [(x - model.center.x) / UNITS_PER_3D, -(y - model.center.y) / UNITS_PER_3D, 0];
}

export function buildGalaxyModel(store: Store, graph: GraphIndex, boardId: Id): GalaxyModel {
  const points: GalaxyPoint[] = [];
  const lines: GalaxyLine[] = [];
  /** Record ID -> the first point that shows it. Lines use it. */
  const pointOfRecord = new Map<Id, GalaxyPoint>();

  const top = graph.childrenOf(boardId);
  const topCenter = centroid(top);
  const inGroup = new Set(graph.outlinesOn(boardId).flatMap((group) => graph.membersOf(group.id).map((place) => place.id)));
  const depth = DEPTH_SPREAD * largerSide(top);
  for (const place of top) {
    const local = localPosition(place, topCenter);
    if (place.p3 === undefined && !inGroup.has(place.id)) local[2] = (unitHash(place.id) - 0.5) * depth;
    const point = makePoint(store, graph, place, 1, local, null);
    points.push(point);
    if (!pointOfRecord.has(place.to)) pointOfRecord.set(place.to, point);
  }

  for (const parent of points.slice()) {
    if (parent.kind === "stamp" || parent.recordId === boardId) continue;
    const children = graph.childrenOf(parent.recordId);
    const center = centroid(children);
    // A card that is not a board holds only scribbles: they orbit it as satellites.
    const satellites = !parent.isBoard;
    children.forEach((place, index) => {
      if (place.to === boardId) return;
      const local = localPosition(place, center);
      const angle = (index / Math.max(1, children.length)) * Math.PI * 2;
      const world: Point3 =
        satellites && place.p3 === undefined
          ? [parent.position[0] + Math.cos(angle) * SATELLITE_ORBIT, parent.position[1] + Math.sin(angle) * SATELLITE_ORBIT, parent.position[2] + 0.15]
          : [parent.position[0] + local[0] * CLUSTER_SCALE, parent.position[1] + local[1] * CLUSTER_SCALE, parent.position[2] + local[2] * CLUSTER_SCALE];
      const point = makePoint(store, graph, place, 2, world, parent.position);
      point.satellite = satellites;
      points.push(point);
      if (!pointOfRecord.has(place.to)) pointOfRecord.set(place.to, point);
      lines.push({ key: `cluster:${place.id}`, from: parent.position, to: world, fromKey: parent.key, toKey: point.key, kind: "cluster", start: "none", end: "none" });
    });
  }

  // Groups: one point above the middle of their cards, with a line to each card.
  for (const group of graph.outlinesOn(boardId)) {
    const members = points.filter((point) => point.depth === 1 && graph.membersOf(group.id).some((place) => place.id === point.placeId));
    const middle: Point3 =
      members.length === 0
        ? localPosition({ x: group.x, y: group.y, w: 0, h: 0 } as PlaceLink, topCenter)
        : [0, 1, 2].map((axis) => members.reduce((sum, point) => sum + point.position[axis]!, 0) / members.length) as Point3;
    const position: Point3 = [middle[0], middle[1] + (members.length === 0 ? 0 : 0.9), middle[2] + 0.4];
    const calendar = isCalendar(group);
    const point: GalaxyPoint = {
      key: `group:${group.id}`,
      placeId: "",
      recordId: group.id,
      depth: 1,
      kind: "group",
      view: "note",
      label: groupTitle(group, t),
      hoverLabel: groupTitle(group, t),
      isReference: false,
      satellite: false,
      codeName: false,
      childCount: members.length,
      isBoard: false,
      position,
      parentPosition: null,
      groupType: calendar ? "calendar" : "outline",
      tree: calendar ? [] : outlineRows(store, graph, group.id).map((row) => ({ depth: row.depth, label: `${row.marker !== "" ? `${row.marker} ` : ""}${titleOfRecord(store, row.recordId)}` })),
      days: calendar ? cardsByDay(store, graph, group.id).size : 0,
    };
    points.push(point);
    for (const member of members) lines.push({ key: `group:${group.id}:${member.key}`, from: position, to: member.position, fromKey: point.key, toKey: member.key, kind: "cluster", start: "none", end: "none" });
  }

  // Relation links only. Inline references in text draw no line (as on the 2D board).
  const seen = new Set<Id>();
  for (const [recordId, point] of pointOfRecord) {
    for (const link of graph.relationsFrom(recordId)) {
      const target = pointOfRecord.get(link.to);
      if (target === undefined || seen.has(link.id)) continue;
      seen.add(link.id);
      const line: GalaxyLine = {
        key: link.id,
        from: point.position,
        to: target.position,
        fromKey: point.key,
        toKey: target.key,
        kind: "relation",
        start: link.start ?? DEFAULT_START_CAP,
        end: link.end ?? DEFAULT_END_CAP,
      };
      if (link.group !== undefined) line.group = link.group;
      lines.push(line);
    }
  }
  const back = Math.min(0, ...points.filter((point) => point.depth === 1 && point.kind !== "group").map((point) => point.position[2]));
  return { points, lines, center: topCenter, back };
}

/** Converts a world position back to the `p3` value of the point's place link. */
export function worldToPlacement(point: GalaxyPoint, world: Point3): Point3 {
  if (point.parentPosition === null) return roundPoint(world);
  const parent = point.parentPosition;
  return roundPoint([
    (world[0] - parent[0]) / CLUSTER_SCALE,
    (world[1] - parent[1]) / CLUSTER_SCALE,
    (world[2] - parent[2]) / CLUSTER_SCALE,
  ]);
}

function makePoint(
  store: Store,
  graph: GraphIndex,
  place: PlaceLink,
  depth: 1 | 2,
  position: Point3,
  parentPosition: Point3 | null,
): GalaxyPoint {
  const item = store.get("items", place.to);
  const stamp = store.get("stamps", place.to);
  const kind: GalaxyPointKind = item !== undefined ? "item" : stamp !== undefined ? "stamp" : "ghost";
  // A note with no name has no label. Other items with no name show "Untitled".
  const label = item !== undefined ? (item.name !== "" || place.view === "note" ? item.name : "Untitled") : stamp !== undefined ? stamp.alt : "Missing item";
  const hoverLabel = item !== undefined && item.name === "" ? snippetOf(store.get("texts", place.to)?.body ?? "") || "Empty note" : label;
  return {
    key: place.id,
    placeId: place.id,
    recordId: place.to,
    depth,
    kind,
    view: place.view,
    label,
    hoverLabel,
    isReference: item !== undefined && graph.isReference(place),
    satellite: false,
    codeName: item?.codeName === true,
    childCount: graph.childrenOf(place.to).filter((child) => !store.has("stamps", child.to)).length,
    isBoard: item !== undefined && graph.isBoardItem(place.to),
    position,
    parentPosition,
    groupType: item !== undefined && graph.isBoardItem(place.to) ? boardGroupType(store, graph, place.to) : null,
    tree: [],
    days: 0,
  };
}

function titleOfRecord(store: Store, id: Id): string {
  const item = store.get("items", id);
  if (item === undefined) return "Missing item";
  return item.name !== "" ? item.name : snippetOf(store.get("texts", id)?.body ?? "") || "Untitled";
}

/** The saved `p3`, or a position from the 2D layout relative to the board center. */
function localPosition(place: PlaceLink, center: { x: number; y: number }): Point3 {
  if (place.p3 !== undefined) return place.p3;
  const x = place.x + place.w / 2;
  const y = place.y + place.h / 2;
  return [(x - center.x) / UNITS_PER_3D, -(y - center.y) / UNITS_PER_3D, 0];
}

/** The larger side of the 2D area of the places, in 3D units. */
function largerSide(places: readonly PlaceLink[]): number {
  if (places.length < 2) return 0;
  const xs = places.map((place) => place.x + place.w / 2);
  const ys = places.map((place) => place.y + place.h / 2);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / UNITS_PER_3D;
}

/** A fixed number from 0 to 1 for a text (FNV-1a hash). The same ID always gives the same depth. */
function unitHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0xffffffff;
}

function centroid(places: readonly PlaceLink[]): { x: number; y: number } {
  if (places.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const place of places) {
    x += place.x + place.w / 2;
    y += place.y + place.h / 2;
  }
  return { x: x / places.length, y: y / places.length };
}

function roundPoint(point: Point3): Point3 {
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return [round(point[0]), round(point[1]), round(point[2])];
}
