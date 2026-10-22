import { describe, expect, it } from "vitest";
import { createItemOnBoard, writeText } from "../src/core/actions";
import { exportBundle, importBundle, readBundle } from "../src/core/bundle";
import { createMediaItem, setMedia } from "../src/core/media";
import { encodeVault } from "../src/core/format";
import { referenceProblems } from "../src/core/validate";
import { DATA_INTEGRITY, IDEAS, loadTestContext, ROOT, TOOL_RESEARCH } from "./helpers";

describe("board bundles", () => {
  it("exports a board (with its inner boards) as Markdown and board data, and imports it as new records only", () => {
    const context = loadTestContext();
    // A comment, a text link inside the board, a text link to outside, and an image.
    const comment = createItemOnBoard(context, { boardId: ROOT, view: "comment", x: 0, y: 0, on: IDEAS, author: "Ada" });
    context.history.run(comment.command);
    writeText(context.store, IDEAS, `See [data](item:${DATA_INTEGRITY}) and [tools](item:${TOOL_RESEARCH}).\n![sky](images/sky-1.png)`);
    const before = encodeVault(context.store, { format: 2, root: ROOT });

    const bundle = exportBundle(context.store, context.graph, IDEAS);
    expect(bundle.markdown).toContain("Ideas");
    expect(bundle.images).toEqual(["images/sky-1.png"]);
    expect([...bundle.files.keys()]).toContain("vault.json");
    // Ideas holds Data integrity (inner card), its comment, and a link to Tool research (outside the bundle).
    const read = readBundle(bundle.files);
    if ("problem" in read) throw new Error(read.problem);
    expect(read.root).toBe(IDEAS);
    expect(read.store.has("items", DATA_INTEGRITY)).toBe(true);
    expect(read.store.has("items", TOOL_RESEARCH)).toBe(false);
    expect(read.store.get("texts", IDEAS)!.body).toContain(`[data](item:${DATA_INTEGRITY}) and tools.`);
    // Exporting does not change the vault.
    expect(encodeVault(context.store, { format: 2, root: ROOT })).toEqual(before);

    const imported = importBundle(context, read, { boardId: ROOT, x: 900, y: 0 }, new Map([["images/sky-1.png", "images/sky-1-ab.png"]]));
    // Only new records: no op replaces or changes an existing record.
    expect(imported.command.ops.every((op) => op.before === null && !context.store.has(op.table, op.id))).toBe(true);
    context.history.run(imported.command);
    const copy = imported.rootId;
    expect(context.store.get("items", copy)!.name).toBe(context.store.get("items", IDEAS)!.name);
    const body = context.store.get("texts", copy)!.body;
    expect(body).not.toContain(DATA_INTEGRITY);
    expect(body).toContain("images/sky-1-ab.png");
    expect(context.graph.childrenOf(copy).length).toBe(context.graph.childrenOf(IDEAS).length);
    expect(context.graph.attachedTo(copy).map((item) => item.author)).toEqual(["Ada"]);
    expect(referenceProblems(context.store, context.graph, ROOT).filter((problem) => problem.severity === "error")).toEqual([]);
    // The records that were there stay byte for byte the same; undo removes the whole import.
    const after = encodeVault(context.store, { format: 2, root: ROOT });
    for (const [path, text] of before) if (path.startsWith("items/")) expect(after.get(path)).toBe(text);
    context.history.undo();
    expect(encodeVault(context.store, { format: 2, root: ROOT })).toEqual(before);
  });

  it("takes the cover and the picture of media items along (and gives them their new paths)", () => {
    const context = loadTestContext();
    const song = createMediaItem(context, { boardId: IDEAS, x: 0, y: 0, kind: "audio", url: "https://open.spotify.com/track/1" });
    context.history.run(song.command);
    context.history.run(setMedia(context, song.itemId, { kind: "audio", url: "https://open.spotify.com/track/1", cover: "images/cover.jpg" }));
    context.history.run(createMediaItem(context, { boardId: IDEAS, x: 300, y: 0, kind: "image", file: "images/photo.png" }).command);

    const bundle = exportBundle(context.store, context.graph, IDEAS);
    expect(bundle.images).toEqual(expect.arrayContaining(["images/cover.jpg", "images/photo.png"]));
    const read = readBundle(bundle.files);
    if ("problem" in read) throw new Error(read.problem);
    const paths = new Map([["images/cover.jpg", "images/cover-1.jpg"], ["images/photo.png", "images/photo-1.png"]]);
    const imported = importBundle(context, read, { boardId: ROOT, x: 900, y: 0 }, paths);
    const media = imported.command.ops.flatMap((op) => (op.table === "items" && op.after !== null && "media" in op.after && op.after.media !== undefined ? [op.after.media] : []));
    expect(media.map((entry) => entry.cover ?? entry.file).sort()).toEqual(["images/cover-1.jpg", "images/photo-1.png"]);
  });

  it("refuses a folder that is not a bundle", () => {
    expect(readBundle(new Map([["notes.md", "hello"]]))).toHaveProperty("problem");
  });
});
