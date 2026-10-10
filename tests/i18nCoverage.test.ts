// Each UI text of the app has a text in each language pack. See docs/SPEC.md section 7.9.
// A person who reads only the UI language must never meet English: a new UI text needs its translation in
// src/ui/i18n/zh-Hant.json (then: node scripts/i18n/make-hans.mjs). Code strings that look like text go in
// scripts/i18n/not-ui.json. To list the missing texts: node scripts/i18n/extract.mjs
import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain JavaScript module (the script is also a command-line tool).
import { extractAll, readPacks } from "../scripts/i18n/extract.mjs";

type Entry = { key: string; file: string; line: number };

describe("UI language packs", () => {
  const { keys, split } = extractAll() as { keys: Entry[]; split: Entry[] };
  const packs = readPacks() as Record<string, Record<string, string>>;

  it("finds the UI texts", () => {
    expect(keys.length).toBeGreaterThan(500);
  });

  it("has no sentence split into pieces by values or elements", () => {
    expect(split.map((entry) => `${entry.file}:${entry.line} ${entry.key}`)).toEqual([]);
  });

  for (const [name, pack] of Object.entries(packs)) {
    it(`${name} has a text for each UI text`, () => {
      const missing = keys.filter((entry) => pack[entry.key] === undefined).map((entry) => `${entry.file}:${entry.line} ${JSON.stringify(entry.key)}`);
      expect(missing).toEqual([]);
    });
  }

  it("the Simplified pack has the keys of the Traditional pack (made by make-hans.mjs)", () => {
    expect(Object.keys(packs.zh ?? {}).sort()).toEqual(Object.keys(packs["zh-Hant"] ?? {}).sort());
  });
});
