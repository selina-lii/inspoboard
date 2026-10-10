// Saves plugin results (translations) as Markdown files that the user selects. The vault does not change.
// - Multilingual version: each item with its original text and, after each line, the translated line.
// - All translations of this session: each translated item, with its translated name and text.

import type { Store } from "../../core/store";
import type { Id } from "../../core/types";
import type { OverlayMap } from "./overlay";

function nameOf(store: Store, id: Id): string {
  const item = store.get("items", id);
  return item === undefined || item.codeName === true ? "" : item.name.trim();
}

/**
 * Original and translation, line by line. A translation keeps the lines of the original, so line N of the
 * translation follows line N of the original. Lines that did not change (code, empty lines) show one time.
 */
export function multilingualMarkdown(store: Store, ids: readonly Id[], overlay: OverlayMap): string {
  const parts: string[] = [];
  for (const id of new Set(ids)) {
    if (!store.has("items", id)) continue;
    const result = overlay.get(id);
    const name = nameOf(store, id);
    const translatedName = result?.title?.trim() ?? "";
    const heading = [name, translatedName].filter((text, index, all) => text !== "" && all.indexOf(text) === index).join(" · ");
    const body = store.get("texts", id)?.body ?? "";
    const lines = body.split("\n");
    const translated = result?.body?.split("\n") ?? null;
    const out: string[] = [];
    lines.forEach((line, index) => {
      out.push(line);
      const other = translated === null || translated.length !== lines.length ? undefined : translated[index];
      if (other !== undefined && other.trim() !== "" && other !== line) out.push(other);
    });
    // Line counts that do not match: the translation follows as one block.
    if (translated !== null && translated.length !== lines.length) out.push("", ...translated);
    parts.push([heading === "" ? null : `# ${heading}`, out.join("\n").trim()].filter((part) => part !== null && part !== "").join("\n\n"));
  }
  return `${parts.filter((part) => part !== "").join("\n\n---\n\n")}\n`;
}

/** Each item with a result (shown or hidden), in the order of the results: the translated name and text. */
export function translationsMarkdown(store: Store, overlay: OverlayMap): string {
  const parts: string[] = [];
  for (const [id, result] of overlay) {
    if (result.title === null && result.body === null) continue;
    const name = result.title?.trim() || nameOf(store, id);
    const original = nameOf(store, id);
    const heading = name === "" ? "# (untitled)" : `# ${name}`;
    const source = original !== "" && original !== name ? `\n\n*${original}*` : "";
    parts.push(`${heading}${source}\n\n${(result.body ?? store.get("texts", id)?.body ?? "").trim()}`);
  }
  return `${parts.join("\n\n---\n\n")}\n`;
}

/** A file name from a title: simple characters only. */
export function fileNameOf(title: string, suffix: string): string {
  const base = title.replace(/[\\/:*?"<>|\n\r\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Inspoboard";
  return `${base} ${suffix}.md`;
}
