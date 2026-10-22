import { describe, expect, it } from "vitest";
import { encodeNotes, fileNameOfPath, isLocalPath, isPdfPath, withScheme, isWebUrl, normalizeUrl, pathOf, placeHighlight, readNotes, webKey } from "../src/ui/web/savedPages";
import { fileNameOf, multilingualMarkdown, translationsMarkdown } from "../src/ui/plugins/exportOverlay";
import type { Overlay } from "../src/ui/plugins/overlay";
import { IDEAS, loadTestContext, TOOL_RESEARCH } from "./helpers";

describe("saved web pages", () => {
  it("makes one key for an address, without its fragment", async () => {
    const key = await webKey("https://a.example/post?id=1#part");
    expect(key).toMatch(/^[0-9a-f]{24}$/);
    expect(await webKey(" https://a.example/post?id=1 ")).toBe(key);
    expect(await webKey("https://a.example/other")).not.toBe(key);
    expect(normalizeUrl("https://a.example/x#y")).toBe("https://a.example/x");
    expect(isWebUrl("https://a.example")).toBe(true);
    expect(isWebUrl("item:abc")).toBe(false);
    expect(isWebUrl("javascript:alert(1)")).toBe(false);
  });

  it("reads notes and drops bad parts; writes them again the same", () => {
    const notes = readNotes(
      JSON.stringify({
        version: 1,
        highlights: [
          { id: "h1", start: 4, end: 9, quote: "quick", color: "green" },
          { id: "h2", start: 9, end: 4, quote: "x" },
          { id: "h3", start: 0, end: 3, quote: "The", color: "purple" },
        ],
        scribbles: [
          { id: "s1", points: [[1, 2], [3, 4]], color: "blue", width: 3 },
          { id: "s2", points: [[1, 2]] },
          { id: "s3", points: [[1, "x"], [2, 2], [5, 5]], width: 900 },
        ],
      }),
    );
    expect(notes.highlights.map((highlight) => [highlight.id, highlight.color])).toEqual([["h1", "green"], ["h3", "yellow"]]);
    expect(notes.scribbles.map((scribble) => [scribble.id, scribble.points.length, scribble.width])).toEqual([["s1", 2, 3], ["s3", 2, 3]]);
    expect(readNotes(encodeNotes(notes))).toEqual(notes);
    expect(readNotes("{bad").highlights).toEqual([]);
    expect(readNotes(null).scribbles).toEqual([]);
    // Old files: no items, no margin, no width.
    expect(notes.items).toEqual([]);
    expect(notes.margin).toBeUndefined();
  });

  it("reads the margin and the page width, and keeps old items and unknown fields as they are", () => {
    const old = [
      { id: "c1", kind: "comment", x: -200, y: 40, w: 180, text: "Why?", color: "pink", author: "Me", created: "2026-10-08T10:00:00Z" },
      { id: "x1", kind: "shape", x: 0, y: 0, text: "" },
    ];
    const notes = readNotes(JSON.stringify({ version: 1, items: old, margin: 240, width: 9000, future: { a: 1 } }));
    // Format-1 entries that the migration could not read: the app does not show them, and a save keeps them.
    expect(notes.items).toEqual(old);
    expect(notes.margin).toBe(240);
    expect(notes.width).toBeUndefined();
    const saved = JSON.parse(encodeNotes(notes));
    expect(saved.items).toEqual(old);
    expect(saved.future).toEqual({ a: 1 });
    expect(readNotes(encodeNotes(notes))).toEqual(notes);
  });

  it("finds a highlight again after the page text moved", () => {
    const highlight = { id: "h", start: 4, end: 9, quote: "quick", color: "yellow" as const };
    expect(placeHighlight("The quick fox", highlight)).toEqual({ start: 4, end: 9 });
    expect(placeHighlight("A new line. The quick fox", highlight)).toEqual({ start: 16, end: 21 });
    expect(placeHighlight("The slow fox", highlight)).toBeNull();
    expect(pathOf([[0, 0], [1.25, 2]])).toBe("M0.0 0.0 L1.3 2.0");
  });
});

describe("saving translations to a file", () => {
  const result = (title: string | null, body: string | null): Overlay => ({ plugin: "t", optionsKey: "", title, body, titleSource: null, bodySource: null, shown: true });

  it("writes the original with the translation after each line, and all translations", () => {
    const context = loadTestContext();
    const body = context.store.get("texts", TOOL_RESEARCH)?.body ?? "";
    const lines = body.split("\n");
    const translated = lines.map((line) => (line.trim() === "" ? line : `ZH ${line}`)).join("\n");
    const overlay = new Map([[TOOL_RESEARCH, result("工具研究", translated)]]);
    const multilingual = multilingualMarkdown(context.store, [TOOL_RESEARCH, IDEAS], overlay);
    expect(multilingual).toContain("# Tool research · 工具研究");
    const firstLine = lines.find((line) => line.trim() !== "")!;
    expect(multilingual).toContain(`${firstLine}\nZH ${firstLine}`);
    expect(multilingual).toContain("# Ideas");
    const all = translationsMarkdown(context.store, overlay);
    expect(all).toContain("# 工具研究\n\n*Tool research*");
    expect(all).not.toContain("# Ideas");
    expect(fileNameOf("A/B: c", "(multilingual)")).toBe("A B c (multilingual).md");
  });

  it("knows local file links", () => {
    expect(isLocalPath("file:///Users/a/x.pdf")).toBe(true);
    expect(isLocalPath("~/Documents/notes.txt")).toBe(true);
    expect(isLocalPath("/Users/a/report.PDF")).toBe(true);
    expect(isLocalPath("C:\\Users\\a\\x.docx")).toBe(true);
    expect(isLocalPath("//cdn.example.com/x")).toBe(false);
    expect(isLocalPath("https://example.com/x.pdf")).toBe(false);
    expect(isPdfPath("/Users/a/report.PDF")).toBe(true);
    expect(isPdfPath("~/a/notes.txt")).toBe(false);
    expect(fileNameOfPath("file:///Users/a/My%20Report.pdf")).toBe("My Report.pdf");
    expect(withScheme("~/a/x.pdf")).toBe("~/a/x.pdf");
    expect(withScheme("example.com")).toBe("https://example.com");
  });
});

describe("addresses of link objects", () => {
  it("are the same file with or without file:// and URL escapes, and the same web page without its fragment", async () => {
    const { sameAddress } = await import("../src/ui/web/webHomes");
    expect(sameAddress("file:///Users/me/A%20paper.pdf", "/Users/me/A paper.pdf")).toBe(true);
    expect(sameAddress(" /Users/me/a.pdf", "/Users/me/a.pdf")).toBe(true);
    expect(sameAddress("/Users/me/a.pdf", "/Users/me/b.pdf")).toBe(false);
    expect(sameAddress("https://x.org/p#intro", "https://x.org/p")).toBe(true);
  });
});

describe("PDF highlights keep their place on the pages", () => {
  it("reads and writes the page boxes of a highlight, and keeps fields it does not know", async () => {
    const { encodeNotes, readNotes } = await import("../src/ui/web/savedPages");
    const file = JSON.stringify({ version: 1, highlights: [{ id: "h1", start: 0, end: 4, quote: "Text", color: "pink", boxes: [[2, 10.5, 20, 30, 12], ["bad"]], future: { a: 1 } }], scribbles: [], items: [] });
    const notes = readNotes(file);
    expect(notes.highlights[0]).toMatchObject({ boxes: [[2, 10.5, 20, 30, 12]], rest: { future: { a: 1 } } });
    const again = JSON.parse(encodeNotes(notes)).highlights[0];
    expect(again).toEqual({ id: "h1", start: 0, end: 4, quote: "Text", color: "pink", boxes: [[2, 10.5, 20, 30, 12]], future: { a: 1 } });
    // An old highlight (no boxes) stays as it was.
    expect(JSON.parse(encodeNotes(readNotes(JSON.stringify({ highlights: [{ id: "h", start: 1, end: 2, quote: "x", color: "yellow" }] })))).highlights[0]).toEqual({ id: "h", start: 1, end: 2, quote: "x", color: "yellow" });
  });

});
