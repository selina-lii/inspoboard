import { describe, expect, it } from "vitest";
import { removeFromOutline, outlineRows } from "../src/core/outline";
import { coreSize, createRadial, deleteRadial, joinRadial, placeInRadial, RADIAL, radialMembers, radialOffsets, setRadialRadius, spreadAgain } from "../src/core/radial";
import type { PlaceLink } from "../src/core/types";
import { schemaErrors } from "../src/core/validate";
import { groupDocument } from "../src/core/groups";
import { loadTestContext, ROOT } from "./helpers";

/** A radial on the root board with all free item cards of the root board in it. */
function withRadial() {
  const context = loadTestContext();
  const { command, radialId } = createRadial(context, ROOT, 500, 400, "Trip");
  context.history.run(command);
  const cards = context.graph.childrenOf(ROOT).filter((place) => place.outline === undefined && context.store.has("items", place.to) && place.to !== ROOT);
  context.history.run(joinRadial(context, radialId, cards.map((place) => place.id)));
  return { context, radialId, cards };
}

describe("radial graphs", () => {
  it("on the board a card never covers the core; a card put in place by hand keeps its place, until it leaves", () => {
    const { context, radialId, cards } = withRadial();
    // A small ball: many cards would be near the core.
    context.history.run(setRadialRadius(context, radialId, RADIAL.radiusRange.min));
    let radial = context.store.get("outlines", radialId)!;
    for (const [placeId, [x, y]] of radialOffsets(context.store, context.graph, radial)) {
      const place = context.store.get("links", placeId) as PlaceLink;
      expect(Math.hypot(x, y)).toBeGreaterThanOrEqual(coreSize("Trip") / 2 + Math.hypot(place.w, place.h) / 2 + RADIAL.clearance - 1);
    }
    const card = cards[0]!;
    const z = radialOffsets(context.store, context.graph, radial).get(card.id)![2];
    context.history.run(placeInRadial(context, radialId, new Map([[card.id, { x: radial.x + 300, y: radial.y - 40 }]])));
    expect((context.store.get("links", card.id) as PlaceLink).offset).toEqual([300, -40, z]);
    expect(schemaErrors("links", context.store.get("links", card.id)!)).toEqual([]);
    // A new spread keeps it; the others move.
    context.history.run(spreadAgain(context, radialId));
    radial = context.store.get("outlines", radialId)!;
    expect(radialOffsets(context.store, context.graph, radial).get(card.id)).toEqual([300, -40, z]);
    // Out of the radial: the offset goes too.
    context.history.run(removeFromOutline(context, [card.id], () => 100, new Map([[card.id, { x: 0, y: 0 }]])));
    expect((context.store.get("links", card.id) as PlaceLink).offset).toBeUndefined();
  });

  it("makes a radial record that the schema accepts", () => {
    const { context, radialId } = withRadial();
    const radial = context.store.get("outlines", radialId)!;
    expect(radial).toMatchObject({ type: "radial", name: "Trip", x: 500, y: 400 });
    expect(schemaErrors("outlines", { ...radial, radius: 300, seed: 4 })).toEqual([]);
    expect(schemaErrors("outlines", { ...radial, type: "wheel" })).not.toEqual([]);
  });

  it("puts each card in the ball: between 55 % and 100 % of the radius, and the same spread each time", () => {
    const { context, radialId, cards } = withRadial();
    const radial = context.store.get("outlines", radialId)!;
    const offsets = radialOffsets(context.store, context.graph, radial);
    expect(offsets.size).toBe(cards.length);
    for (const [x, y, z] of offsets.values()) {
      const distance = Math.hypot(x, y, z);
      expect(distance).toBeGreaterThanOrEqual(RADIAL.radius * RADIAL.inner - 2);
      expect(distance).toBeLessThanOrEqual(RADIAL.radius + 2);
    }
    expect(radialOffsets(context.store, context.graph, radial)).toEqual(offsets);
    // A radial has no outline rows (its cards are not a list).
    expect(outlineRows(context.store, context.graph, radialId)).toEqual([]);
  });

  it("spreads again with a new seed, and changes its radius in the allowed range", () => {
    const { context, radialId } = withRadial();
    const before = radialOffsets(context.store, context.graph, context.store.get("outlines", radialId)!);
    context.history.run(spreadAgain(context, radialId));
    expect(radialOffsets(context.store, context.graph, context.store.get("outlines", radialId)!)).not.toEqual(before);
    context.history.run(setRadialRadius(context, radialId, 5000));
    expect(context.store.get("outlines", radialId)!.radius).toBe(RADIAL.radiusRange.max);
    context.history.run(setRadialRadius(context, radialId, RADIAL.radius));
    expect("radius" in context.store.get("outlines", radialId)!).toBe(false);
  });

  it("takes cards out at the given places, and a deleted radial leaves its cards on the board", () => {
    const { context, radialId, cards } = withRadial();
    const first = cards[0]!;
    context.history.run(removeFromOutline(context, [first.id], () => 100, new Map([[first.id, { x: 11, y: 22 }]])));
    expect(context.store.get("links", first.id)).toMatchObject({ x: 11, y: 22 });
    expect("outline" in context.store.get("links", first.id)!).toBe(false);
    // The radial stays when cards leave (a core alone).
    expect(context.store.has("outlines", radialId)).toBe(true);
    context.history.run(deleteRadial(context, radialId));
    expect(context.store.has("outlines", radialId)).toBe(false);
    for (const card of cards) expect((context.store.get("links", card.id) as PlaceLink).outline).toBeUndefined();
  });

  it("exports its cards in one document, and the core grows with its text", () => {
    const { context, radialId } = withRadial();
    expect(groupDocument(context.store, context.graph, radialId)).toMatch(/^# Trip\n/);
    expect(radialMembers(context.store, context.graph, radialId).length).toBeGreaterThan(0);
    expect(coreSize("Hi")).toBe(RADIAL.coreMin);
    expect(coreSize("A long text for the core of a radial graph")).toBeLessThanOrEqual(RADIAL.coreMax);
  });
});

describe("radial on the board", () => {
  it("draws the core, each card at core + offset, and a line from the core to each card", async () => {
    const { buildBoardModel } = await import("../src/ui/board/boardModel");
    const { context, radialId, cards } = withRadial();
    const radial = context.store.get("outlines", radialId)!;
    const model = buildBoardModel(context.store, context.graph, ROOT);
    const core = model.nodes.find((node) => node.kind === "radial")!;
    expect(core.x + core.w / 2).toBe(radial.x);
    const offsets = radialOffsets(context.store, context.graph, radial);
    for (const card of cards) {
      const node = model.nodes.find((candidate) => candidate.placeId === card.id)!;
      expect(node.frameId).toBe(core.id);
      expect(node.x + card.w / 2).toBe(radial.x + offsets.get(card.id)![0]);
    }
    expect(model.edges.filter((edge) => edge.kind === "radial")).toHaveLength(cards.length);
  });
});
