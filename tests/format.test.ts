import { describe, expect, it } from "vitest";
import { decodeVault, encodeVault, TABLE_FILES } from "../src/core/format";
import { DATA_INTEGRITY, readTestVault, ROOT } from "./helpers";

describe("vault format", () => {
  // Backwards compatibility (SPEC 3.1): the frozen format-1 vault must always load and write back unchanged.
  it("writes back the test vault byte for byte", () => {
    const files = readTestVault();
    const { store, meta, problems } = decodeVault(files);
    expect(problems.filter((problem) => problem.severity === "error")).toEqual([]);
    expect(meta?.root).toBe(ROOT);
    const encoded = encodeVault(store, meta!);
    for (const [path, text] of files) expect(encoded.get(path), path).toBe(text);
    expect([...encoded.keys()].sort()).toEqual([...files.keys()].sort());
  });

  it("keeps body text exactly, with CRLF and no final newline", () => {
    const files = readTestVault();
    files.set(`items/${DATA_INTEGRITY}.md`, "line one\r\nline two  ");
    const { store, meta } = decodeVault(files);
    expect(encodeVault(store, meta!).get(`items/${DATA_INTEGRITY}.md`)).toBe("line one\r\nline two  ");
  });

  it("keeps unknown fields", () => {
    const files = readTestVault();
    const line = `{"id":"zzzzzzzzzzzz","name":"Future","created":"2026-10-07T00:00:00.000Z","color":"red"}\n`;
    files.set(TABLE_FILES.items, files.get(TABLE_FILES.items)! + line);
    const { store, meta } = decodeVault(files);
    expect(encodeVault(store, meta!).get(TABLE_FILES.items)).toContain(line);
  });

  it("reports a bad line as an error and does not throw", () => {
    const files = readTestVault();
    files.set(TABLE_FILES.links, files.get(TABLE_FILES.links)! + "{not json\n");
    const { problems } = decodeVault(files);
    expect(problems).toContainEqual(expect.objectContaining({ severity: "error", code: "bad-json", path: TABLE_FILES.links, line: 7 }));
  });

  it("reports a record that fails the schema", () => {
    const files = readTestVault();
    files.set(TABLE_FILES.links, `{"id":"aaaaaaaaaaaa","kind":"place","from":"${ROOT}","to":"${ROOT}","view":"poster","x":0,"y":0,"w":1,"h":1}\n`);
    const { problems } = decodeVault(files);
    expect(problems).toContainEqual(expect.objectContaining({ code: "bad-record" }));
  });

  it("reports a duplicate ID", () => {
    const files = readTestVault();
    const first = files.get(TABLE_FILES.items)!.split("\n")[0]!;
    files.set(TABLE_FILES.items, `${files.get(TABLE_FILES.items)!}${first}\n`);
    expect(decodeVault(files).problems).toContainEqual(expect.objectContaining({ code: "duplicate-id" }));
  });

  it("reports a missing or too-new vault.json", () => {
    const files = readTestVault();
    files.delete("vault.json");
    expect(decodeVault(files).problems).toContainEqual(expect.objectContaining({ code: "meta-missing" }));
    files.set("vault.json", `{"format":99,"root":"${ROOT}"}`);
    expect(decodeVault(files).problems).toContainEqual(expect.objectContaining({ code: "format-too-new" }));
  });

  it("ignores and reports unknown files in items/", () => {
    const files = readTestVault();
    files.set("items/notes.txt", "hello");
    const { store, problems } = decodeVault(files);
    expect(problems).toContainEqual(expect.objectContaining({ code: "unknown-file", path: "items/notes.txt" }));
    expect(store.count("texts")).toBe(4);
  });
});
