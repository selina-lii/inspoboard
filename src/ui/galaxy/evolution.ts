// The evolution plot of the 3D view (SPEC 7.16, "Evolution plot"): items in generations. Pure: the store in, places out.
// - Nodes: the items that the board reaches (its cards, the cards in its boards, at any depth), the groups on those
//   boards, and the lineage of those items (the items they were made from, and the items made from them).
// - Generation: the longest chain from a node with no parent, over the chosen links: made from (`madeFrom`), nesting
//   (a board holds its cards; a group holds its members), or both.
// - Each generation is a loose cloud ("nebula") on its own plane: walls (generations from left to right) or floors
//   (upward). A node starts near its parents (short lines), then nodes push each other apart; a generation with more
//   nodes is wider. `nebula`: the thickness of each cloud (the space between the planes stays larger).

import { isOutdated, madeIndex } from "../../core/lineage";
import type { GraphIndex } from "../../core/graph";
import type { Store } from "../../core/store";
import type { Id, Point3 } from "../../core/types";

export type DepthBy = "made" | "nest" | "both";
export type EvolutionLayout = "walls" | "floors";
export type EvolutionKind = "board" | "map" | "group" | "note" | "page" | "link" | "small";

export type EvolutionNode = { id: Id; label: string; kind: EvolutionKind; generation: number; position: Point3; outdated: boolean; sources: number };
export type EvolutionEdge = { from: Id; to: Id; kind: "made" | "nest" };
export type EvolutionLayer = { generation: number; count: number; center: Point3; radius: number; anchor: Point3 };
export type Evolution = { nodes: EvolutionNode[]; edges: EvolutionEdge[]; layers: EvolutionLayer[]; parents: Map<Id, Id[]> };

/** The space between two generations (3D units). */
const GAP = 34;
/** At most this many nodes (a very large vault shows the first ones it reaches). */
const MAX_NODES = 2500;
const MIN_SPACE = 2.6;

/** The nodes and links of a board: what it reaches by nesting, and the lineage of those items. */
function collect(store: Store, graph: GraphIndex, boardId: Id) {
  const nodes = new Map<Id, { label: string; kind: EvolutionKind }>();
  const nest: EvolutionEdge[] = [];
  const kindOf = (id: Id, view?: string): EvolutionKind => {
    const item = store.get("items", id);
    if (item === undefined) return "group";
    if (item.detached === true || item.sources !== undefined) return "map";
    if (graph.isBoardItem(id)) return "board";
    if (item.url !== undefined && item.url !== "") return "link";
    if (item.on !== undefined || view === "comment" || view === "quote" || view === "flash") return "small";
    return view === "page" ? "page" : "note";
  };
  const add = (id: Id, view?: string) => {
    if (nodes.has(id) || nodes.size >= MAX_NODES) return nodes.has(id);
    const label = store.get("items", id)?.name ?? store.get("outlines", id)?.name ?? "";
    nodes.set(id, { label, kind: kindOf(id, view) });
    return true;
  };
  add(boardId);
  const queue = [boardId];
  for (let at = 0; at < queue.length; at += 1) {
    const board = queue[at]!;
    for (const group of graph.outlinesOn(board)) if (add(group.id)) nest.push({ from: board, to: group.id, kind: "nest" });
    for (const place of graph.childrenOf(board)) {
      if (!store.has("items", place.to) || place.view === "group") continue;
      const isNew = !nodes.has(place.to);
      if (!add(place.to, place.view)) continue;
      nest.push({ from: place.outline ?? board, to: place.to, kind: "nest" });
      if (isNew && graph.isBoardItem(place.to)) queue.push(place.to);
    }
  }
  // The lineage of the items reached: what they came from, and what was made from them.
  const index = madeIndex(store);
  const lineage = [...nodes.keys()];
  for (let at = 0; at < lineage.length; at += 1) {
    const id = lineage[at]!;
    const related = [...(store.get("items", id)?.madeFrom ?? []).map((source) => source.from), ...(index.get(id) ?? [])];
    for (const other of related) {
      if (nodes.has(other) || !store.has("items", other)) continue;
      if (add(other)) lineage.push(other);
    }
  }
  const made: EvolutionEdge[] = [];
  for (const id of nodes.keys()) for (const source of store.get("items", id)?.madeFrom ?? []) if (nodes.has(source.from)) made.push({ from: source.from, to: id, kind: "made" });
  return { nodes, nest: nest.filter((edge) => nodes.has(edge.from) && nodes.has(edge.to)), made };
}

/** A small seeded random source: the same board gives the same nebula. */
function seeded(seed: number) {
  let state = seed >>> 0 || 1;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
}

export function buildEvolution(store: Store, graph: GraphIndex, boardId: Id, depthBy: DepthBy, layout: EvolutionLayout, nebula: number): Evolution {
  const { nodes, nest, made } = collect(store, graph, boardId);
  const edges = [...(depthBy === "nest" ? [] : made), ...(depthBy === "made" ? [] : nest)];
  const parents = new Map<Id, Id[]>([...nodes.keys()].map((id) => [id, []]));
  for (const edge of edges) parents.get(edge.to)!.push(edge.from);

  // The generation: the longest chain from a root (a ring counts once).
  const generation = new Map<Id, number>();
  const visit = (id: Id, stack: Set<Id>): number => {
    const known = generation.get(id);
    if (known !== undefined) return known;
    if (stack.has(id)) return 0;
    stack.add(id);
    const value = parents.get(id)!.reduce((max, parent) => Math.max(max, visit(parent, stack) + 1), 0);
    stack.delete(id);
    generation.set(id, value);
    return value;
  };
  for (const id of nodes.keys()) visit(id, new Set());

  const layers: Id[][] = [];
  for (const [id, value] of generation) (layers[value] ??= []).push(id);
  const random = seeded(7);
  const flat = new Map<Id, [number, number, number]>();
  layers.forEach((layer) => {
    const spread = 3 + Math.sqrt(layer.length) * 2.2;
    layer.forEach((id, k) => {
      const above = parents.get(id)!.map((parent) => flat.get(parent)).filter((point) => point !== undefined);
      let u: number;
      let v: number;
      if (above.length > 0) {
        u = above.reduce((sum, point) => sum + point[0], 0) / above.length;
        v = above.reduce((sum, point) => sum + point[1], 0) / above.length;
        const angle = random() * Math.PI * 2;
        const distance = 1.5 + random() * 3;
        u += Math.cos(angle) * distance;
        v += Math.sin(angle) * distance;
      } else {
        // A sunflower spiral for nodes with no parent in a lower generation.
        const angle = k * 2.39996;
        const distance = spread * Math.sqrt((k + 0.5) / layer.length);
        u = Math.cos(angle) * distance;
        v = Math.sin(angle) * distance;
      }
      flat.set(id, [u, v, (random() + random() + random() - 1.5) * nebula]);
    });
    // Push apart nodes closer than MIN_SPACE; a little pull to the middle keeps the cloud round.
    const points = layer.map((id) => flat.get(id)!);
    const steps = points.length > 600 ? 15 : 60;
    for (let step = 0; step < steps; step += 1) {
      for (let i = 0; i < points.length; i += 1) {
        const a = points[i]!;
        for (let j = i + 1; j < points.length; j += 1) {
          const b = points[j]!;
          const du = a[0] - b[0];
          const dv = a[1] - b[1];
          if (Math.abs(du) > MIN_SPACE || Math.abs(dv) > MIN_SPACE) continue;
          const distance = Math.hypot(du, dv) || 0.01;
          if (distance >= MIN_SPACE) continue;
          const push = (MIN_SPACE - distance) / 2 / distance;
          a[0] += du * push;
          a[1] += dv * push;
          b[0] -= du * push;
          b[1] -= dv * push;
        }
        a[0] *= 0.995;
        a[1] *= 0.995;
      }
    }
  });

  const place = (g: number, [u, v, t]: [number, number, number]): Point3 => (layout === "walls" ? [g * GAP + t, v, u] : [u, g * GAP * 0.8 + t, v]);
  const result: EvolutionNode[] = [...nodes].map(([id, node]) => ({
    id,
    label: node.label,
    kind: node.kind,
    generation: generation.get(id)!,
    position: place(generation.get(id)!, flat.get(id)!),
    outdated: store.has("items", id) && isOutdated(store, id),
    sources: store.get("items", id)?.madeFrom?.length ?? 0,
  }));
  const byId = new Map(result.map((node) => [node.id, node]));
  const layerInfo: EvolutionLayer[] = layers.map((layer, g) => {
    const points = layer.map((id) => byId.get(id)!.position);
    const center = points.reduce<Point3>((sum, point) => [sum[0] + point[0] / points.length, sum[1] + point[1] / points.length, sum[2] + point[2] / points.length], [0, 0, 0]);
    const radius = Math.max(4, ...points.map((point) => Math.hypot(point[0] - center[0], point[1] - center[1], point[2] - center[2]))) + 2;
    const anchor: Point3 = layout === "walls" ? [center[0], center[1] + radius, center[2]] : [center[0], center[1], center[2] - radius];
    return { generation: g, count: layer.length, center, radius, anchor };
  });
  return { nodes: result, edges, layers: layerInfo, parents };
}

/** The lineage of a node over the shown links: the node, its ancestors, and its descendants. */
export function lineageOf(evolution: Evolution, id: Id): Set<Id> {
  const children = new Map<Id, Id[]>();
  for (const edge of evolution.edges) children.set(edge.from, [...(children.get(edge.from) ?? []), edge.to]);
  const found = new Set<Id>([id]);
  const walk = (start: Id, next: (node: Id) => readonly Id[]) => {
    const queue = [start];
    for (let at = 0; at < queue.length; at += 1) {
      for (const other of next(queue[at]!)) {
        if (found.has(other)) continue;
        found.add(other);
        queue.push(other);
      }
    }
  };
  walk(id, (node) => evolution.parents.get(node) ?? []);
  walk(id, (node) => children.get(node) ?? []);
  return found;
}
