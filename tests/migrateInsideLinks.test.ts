import { describe, expect, it } from "vitest";
import { planInsideMigration, storeOf, type WebFolder } from "../src/core/migrate/insideLinks";
import { decodeVault } from "../src/core/format";
import { GraphIndex } from "../src/core/graph";
import { insideEntries } from "../src/core/inside";
import { counterIds, readTestVault, ROOT, TOOL_RESEARCH } from "./helpers";

const NOW = "2026-10-11T12:00:00.000Z";
const URL_A = "https://example.com/post#top";

/** The fixture vault with older data: a page comment (with a reply), and two link objects with one address. */
function oldVault() {
  const files = readTestVault();
  const add = (path: string, lines: object[]) => files.set(path, `${files.get(path) ?? ""}${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  add("table/items.jsonl", [
    { id: "cmt000000001", name: "", created: "2026-10-08T00:00:00.000Z", author: "Ann", on: TOOL_RESEARCH, quote: "Tool", pageAt: [12, 34] },
    { id: "rep000000001", name: "", created: "2026-10-08T01:00:00.000Z", author: "Bo", on: "cmt000000001" },
    { id: "web000000001", name: "Post", created: "2026-10-01T00:00:00.000Z", url: URL_A },
    { id: "web000000002", name: "Post again", created: "2026-10-05T00:00:00.000Z", url: "https://example.com/post" },
  ]);
  add("table/links.jsonl", [
    { id: "pcm000000001", kind: "place", from: ROOT, to: "cmt000000001", view: "comment", x: 260, y: 0, w: 220, h: 96, expanded: true },
    { id: "pwb000000001", kind: "place", from: ROOT, to: "web000000001", view: "weblink", x: 0, y: 400, w: 200, h: 36 },
    { id: "pwb000000002", kind: "place", from: ROOT, to: "web000000002", view: "weblink", x: 0, y: 500, w: 200, h: 36 },
  ]);
  files.set("items/cmt000000001.md", "Check this");
  files.set("items/rep000000001.md", "Done");
  return files;
}

function webFolder(files: Record<string, string>): WebFolder {
  return { names: Object.keys(files), readText: (name) => files[name] ?? null };
}

describe("migration to inside links", () => {
  it("changes old page comments, splits shared copies, and moves web comments into the vault", async () => {
    const notes = { version: 1, highlights: [{ id: "h1", start: 0, end: 4, quote: "Post", color: "yellow" }], scribbles: [], items: [{ id: "m1", kind: "note", x: -100, y: 40, w: 170, text: "Margin note", color: "pink", created: "2026-10-02T00:00:00.000Z" }, { id: "bad", kind: "sticker" }], margin: 300, extra: "kept" };
    // The key of the old shared copy: the hash of the address (without its fragment).
    const realKey = await (async () => {
      const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("https://example.com/post")));
      return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 24);
    })();
    const named = webFolder({ [`${realKey}.html`]: "<html>post</html>", [`${realKey}.notes.json`]: JSON.stringify(notes) });
    const plan = await planInsideMigration(oldVault(), named, async () => null, NOW, counterIds());
    expect(plan.ok).toBe(true);
    expect(plan.counts).toMatchObject({ pageItems: 1, copies: 2, notesFiles: 1, webItems: 1 });
    const decoded = decodeVault(plan.files);
    expect(decoded.problems.filter((problem) => problem.severity === "error")).toEqual([]);
    const store = decoded.store;
    const graph = new GraphIndex(store);
    // The page comment: an inside link with its place and passage; the card went; the reply stays in its thread.
    const comment = store.get("items", "cmt000000001")!;
    expect(comment.on).toBeUndefined();
    expect(comment.pageAt).toBeUndefined();
    expect(graph.parentsOf("cmt000000001")).toEqual([]);
    expect(graph.insideHomeOf("cmt000000001")).toMatchObject({ from: TOOL_RESEARCH, view: "comment", x: 12, y: 34, quote: "Tool", expanded: true });
    expect(store.get("items", "rep000000001")?.on).toBe("cmt000000001");
    expect(store.get("texts", "cmt000000001")?.body).toBe("Check this");
    // Each link object gets its own copy. The old notes go to the oldest one, without the moved items.
    expect(plan.web).toContainEqual({ op: "copy", from: `${realKey}.html`, to: "web000000001.html" });
    expect(plan.web).toContainEqual({ op: "copy", from: `${realKey}.html`, to: "web000000002.html" });
    const written = plan.web.find((step) => step.op === "write");
    expect(written).toMatchObject({ op: "write", name: "web000000001.notes.json" });
    const next = JSON.parse(written!.op === "write" ? written!.content : "{}");
    expect(next).toEqual({ ...notes, items: [{ id: "bad", kind: "sticker" }] });
    // The margin note: a vault item inside the oldest link object, with its text, place, size, and paper color.
    const [entry] = insideEntries(store, graph, "web000000001");
    expect(entry).toMatchObject({ view: "note", at: [-100, 40], w: 170, color: "#ffd9e2" });
    expect(store.get("texts", entry!.item.id)?.body).toBe("Margin note");
    expect(plan.report.join("\n")).toContain("2 link objects");
  });

  it("a second run has nothing to do", async () => {
    const plan = await planInsideMigration(oldVault(), webFolder({}), async () => null, NOW, counterIds());
    const again = await planInsideMigration(plan.files, webFolder({}), async () => null, NOW, counterIds());
    expect([...again.files].filter(([path, content]) => plan.files.get(path) !== content)).toEqual([]);
    expect(again.web).toEqual([]);
    expect(again.counts).toMatchObject({ pageItems: 0, copies: 0, notesFiles: 0, webItems: 0 });
  });

  it("does nothing for a vault with errors", async () => {
    const files = oldVault();
    files.set("table/links.jsonl", `${files.get("table/links.jsonl")}{"id":"broken"}\n`);
    const plan = await planInsideMigration(files, webFolder({}), async () => null, NOW, counterIds());
    expect(plan.ok).toBe(false);
    expect(plan.files).toBe(files);
    expect(storeOf(plan.files).count("items")).toBeGreaterThan(0);
  });
});
