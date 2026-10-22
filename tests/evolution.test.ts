import { describe, expect, it } from "vitest";
import { addSources } from "../src/core/lineage";
import type { PlaceLink } from "../src/core/types";
import { buildEvolution, lineageOf } from "../src/ui/galaxy/evolution";
import { copyBeside, detachMap } from "../src/ui/plugins/tray/processing";
import { createSortingMap, pullFromTray } from "../src/ui/plugins/tray/tray";
import { loadTestContext, ROOT } from "./helpers";

/** A processing map with copies: a copy of an original, and a summary made from that copy and a second original. */
function withLineage() {
  const context = loadTestContext();
  const made = createSortingMap(context, { boardId: ROOT, x: 0, y: 0, sourceId: ROOT });
  context.history.run(made.command);
  context.history.run(detachMap(context, made.mapId, "edit").command);
  const pulled = pullFromTray(context, made.mapId, 50, { x: 0, y: 0 }, () => 0.5);
  context.history.run(pulled.command);
  const cards = pulled.placeIds.map((id) => context.store.get("links", id) as PlaceLink).filter((place) => context.store.get("items", place.to)?.board !== true);
  const copy = copyBeside(context, cards[0]!.id);
  context.history.run(copy.command);
  const summary = copyBeside(context, cards[1]!.id);
  context.history.run(summary.command);
  context.history.run(addSources(context, summary.copyId!, [copy.copyId!]));
  return { context, original: cards[0]!.to, copyId: copy.copyId!, summaryId: summary.copyId! };
}

describe("evolution plot", () => {
  it("made from: originals are generation 0, a copy 1, an item made from a copy 2", () => {
    const { context, original, copyId, summaryId } = withLineage();
    const evolution = buildEvolution(context.store, context.graph, ROOT, "made", "walls", 0);
    const generation = (id: string) => evolution.nodes.find((node) => node.id === id)!.generation;
    expect(generation(original)).toBe(0);
    expect(generation(copyId)).toBe(1);
    expect(generation(summaryId)).toBe(2);
    // Walls: one plane for each generation (x = generation × gap, with no nebula depth).
    const x = (id: string) => evolution.nodes.find((node) => node.id === id)!.position[0];
    expect(x(copyId)).toBeGreaterThan(x(original));
    expect(x(summaryId)).toBeGreaterThan(x(copyId));
    expect(evolution.layers.map((layer) => layer.generation)).toEqual(evolution.layers.map((_, index) => index));
  });

  it("nesting and both: the board is the root; both counts the longest chain over the two kinds of links", () => {
    const { context, copyId, summaryId } = withLineage();
    const nest = buildEvolution(context.store, context.graph, ROOT, "nest", "floors", 4);
    expect(nest.nodes.find((node) => node.id === ROOT)!.generation).toBe(0);
    expect(nest.edges.every((edge) => edge.kind === "nest")).toBe(true);
    const both = buildEvolution(context.store, context.graph, ROOT, "both", "floors", 4);
    const generation = (id: string) => both.nodes.find((node) => node.id === id)!.generation;
    expect(generation(summaryId)).toBeGreaterThan(generation(copyId));
    // Floors: generations go up (y).
    const y = (id: string) => both.nodes.find((node) => node.id === id)!.position[1];
    expect(y(summaryId)).toBeGreaterThan(y(ROOT));
  });

  it("the lineage of a node: its ancestors and descendants over the shown links", () => {
    const { context, original, copyId, summaryId } = withLineage();
    const evolution = buildEvolution(context.store, context.graph, ROOT, "made", "walls", 4);
    expect(lineageOf(evolution, copyId)).toEqual(new Set([original, copyId, summaryId]));
  });
});
