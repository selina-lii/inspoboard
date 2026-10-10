import { describe, expect, it } from "vitest";
import { placeRecord, writeText } from "../src/core/actions";
import { searchBoard } from "../src/core/search";
import { DATA_INTEGRITY, IDEAS, loadTestContext, RELATION, ROOT } from "./helpers";

describe("search", () => {
  it("finds names, body text, and link labels below a board", () => {
    const context = loadTestContext();
    const hits = searchBoard(context.store, context.graph, ROOT, "depends");
    expect(hits).toContainEqual(expect.objectContaining({ recordId: RELATION, field: "label" }));
    const integrity = searchBoard(context.store, context.graph, ROOT, "never lose");
    expect(integrity[0]).toMatchObject({ recordId: DATA_INTEGRITY, field: "body", path: [ROOT] });
  });

  it("searches only below the given board", () => {
    const context = loadTestContext();
    expect(searchBoard(context.store, context.graph, IDEAS, "Tool research", { caseSensitive: true })).toEqual([]);
  });

  it("finds stamp alt text", () => {
    const context = loadTestContext();
    expect(searchBoard(context.store, context.graph, ROOT, "star")).toContainEqual(
      expect.objectContaining({ field: "alt" }),
    );
  });

  it("stops in a cycle and searches each record one time", () => {
    const context = loadTestContext();
    context.history.run(placeRecord(context, { boardId: DATA_INTEGRITY, recordId: ROOT, view: "note", x: 0, y: 0, w: 1, h: 1 }).command);
    const hits = searchBoard(context.store, context.graph, ROOT, "Data integrity");
    expect(hits.filter((hit) => hit.recordId === DATA_INTEGRITY && hit.field === "name")).toHaveLength(1);
  });

  it("returns nothing for an empty query", () => {
    const context = loadTestContext();
    expect(searchBoard(context.store, context.graph, ROOT, "")).toEqual([]);
  });
});

describe("search in all languages", () => {
  it("marks the correct characters when lower case changes the length", async () => {
    const { foldCase } = await import("../src/core/search");
    const { folded, origin } = foldCase("İstanbul");
    expect(folded.length).toBe(9);
    expect(origin[folded.indexOf("s")]).toBe(1);
  });

  it("finds Chinese, Arabic, and emoji text with exact offsets", () => {
    const context = loadTestContext();
    writeText(context.store, IDEAS, "İİ 猫团 مرحبا 🐈 end");
    for (const query of ["猫团", "مرحبا", "🐈", "END"]) {
      const hit = searchBoard(context.store, context.graph, ROOT, query).find((candidate) => candidate.recordId === IDEAS);
      const body = context.store.get("texts", IDEAS)!.body;
      expect(hit, query).toBeDefined();
      expect(body.slice(hit!.start, hit!.end).toLowerCase()).toBe(query.toLowerCase());
    }
  });

  it("finds text in the saved page of a link object", () => {
    const context = loadTestContext();
    const pages = new Map([[IDEAS, "Saved page about phase separation in cells."]]);
    const hits = searchBoard(context.store, context.graph, ROOT, "phase separation", {}, pages);
    expect(hits).toContainEqual(expect.objectContaining({ recordId: IDEAS, field: "page", start: 17, end: 33 }));
    expect(searchBoard(context.store, context.graph, ROOT, "phase separation")).toEqual([]);
  });
});
