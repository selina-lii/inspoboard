// Linearization: sort all core data into one Markdown document. See docs/SPEC.md section 8.

import type { GraphIndex } from "./graph";
import { boardOrder } from "./outline";
import { groupTitle } from "./groups";

export { readingOrder } from "./outline";
import type { Store } from "./store";
import type { Id } from "./types";
import { ENGLISH, type Words } from "./words";

export type LinearizeOptions = {
  maxDepth?: number;
  /** The words of the document ("See: {0}", "Comment"): the UI language. Default: English. */
  words?: Words;
};

const MAX_HEADING_LEVEL = 6;

export function linearize(store: Store, graph: GraphIndex, rootId: Id, options: LinearizeOptions = {}): string {
  const maxDepth = options.maxDepth ?? 32;
  const words = options.words ?? ENGLISH;
  const written = new Set<Id>();
  const blocks: string[] = [];

  const nameOf = (id: Id): string => {
    const item = store.get("items", id);
    if (item !== undefined) return item.name === "" ? words("Untitled") : item.name;
    const stamp = store.get("stamps", id);
    if (stamp !== undefined) return words("[stamp: {0}]", stamp.alt);
    return words("(missing {0})", id);
  };

  /** `number` is the chapter number of the item ("2.1"), or "" if its outline has no numbers. `prefix`: a calendar day. */
  const visit = (id: Id, depth: number, number: string, prefix = ""): void => {
    const heading = "#".repeat(Math.min(depth + 1, MAX_HEADING_LEVEL));
    const stamp = store.get("stamps", id);
    if (stamp !== undefined) {
      blocks.push(words("[stamp: {0}]", stamp.alt));
      return;
    }
    if (written.has(id)) {
      blocks.push(words("See: {0}", nameOf(id)));
      return;
    }
    written.add(id);
    const body = store.get("texts", id)?.body ?? "";
    // A group card (a loose area) with no name and no text has nothing to export.
    if (graph.homeOf(id)?.view === "group" && store.get("items", id)?.name === "" && body.trim() === "") return;
    if (graph.homeOf(id)?.view === "quote") {
      // A quote card: a Markdown quote, with its source (if it has one) on the last line.
      const source = store.get("items", id)?.name ?? "";
      const lines = body.trimEnd().split("\n").map((line) => `> ${line}`);
      if (source !== "") lines.push(`> — ${source}`);
      blocks.push(lines.join("\n"));
    } else {
      blocks.push(`${heading} ${prefix}${number === "" ? "" : `${number} `}${nameOf(id)}`);
      if (body.trim() !== "") blocks.push(body.trimEnd());
    }
    // Attached objects and small items inside the item follow the text: links as a list, comments (and notes) as
    // quotes with their signature.
    const objects = [
      ...graph.attachedTo(id).map((object) => ({ object, quote: object.quote, note: false })),
      ...graph.insideOf(id).flatMap((link) => {
        const object = store.get("items", link.to);
        return object === undefined ? [] : [{ object, quote: link.quote, note: link.view !== "comment" && link.view !== "weblink" }];
      }),
    ];
    for (const { object, quote, note } of objects) {
      if (written.has(object.id)) continue;
      written.add(object.id);
      const text = (store.get("texts", object.id)?.body ?? "").trim();
      if (object.url !== undefined) blocks.push(`- [${object.name !== "" ? object.name : object.url}](${object.url})`);
      else {
        // A comment with its replies (one level deeper each). A resolved thread is marked.
        const lines: string[] = [];
        const quoteLines = (depth: number, value: string) => value.replace(/\n/g, `\n${"> ".repeat(depth)}`);
        lines.push(`> **${object.author ?? (note ? words("Note") : words("Comment"))}**${quote !== undefined ? ` ${words("on “{0}”", quote)}` : ""}${object.resolved === true ? ` ${words("(resolved)")}` : ""}: ${quoteLines(1, text)}`);
        const replies = (id: Id, depth: number) => {
          for (const reply of graph.attachedTo(id)) {
            if (written.has(reply.id)) continue;
            written.add(reply.id);
            lines.push(`${"> ".repeat(depth)}**${reply.author ?? words("Reply")}**: ${quoteLines(depth, (store.get("texts", reply.id)?.body ?? "").trim())}`);
            replies(reply.id, depth + 1);
          }
        };
        replies(object.id, 2);
        blocks.push(lines.join("\n"));
      }
    }

    const relations = graph.relationsFrom(id);
    if (relations.length > 0) {
      const lines = relations.map((link) => {
        const label = link.label === undefined ? "" : ` (${link.label})`;
        return `- → ${nameOf(link.to)}${label}`;
      });
      blocks.push(lines.join("\n"));
    }

    if (depth >= maxDepth) return;
    // A group (outline, calendar) is one level below its board: its name is a subtitle, its cards are under it.
    // Outline rows: deeper rows get deeper headings. Numbers come from a numbered outline. Calendar cards: their day first.
    let currentGroup: Id | null = null;
    for (const { place, row } of boardOrder(store, graph, id)) {
      // Attached objects show under their item (above), not as items of their own.
      const attachedTo = store.get("items", place.to)?.on;
      if (attachedTo !== undefined && store.has("items", attachedTo)) continue;
      const group = place.outline === undefined ? undefined : store.get("outlines", place.outline);
      if (group !== undefined && group.id !== currentGroup) blocks.push(`${"#".repeat(Math.min(depth + 2, MAX_HEADING_LEVEL))} ${groupTitle(group, words)}`);
      currentGroup = group?.id ?? null;
      const numbered = row !== null && /^\d/.test(row.marker);
      const level = depth + 1 + (group !== undefined ? 1 : 0) + (row?.depth ?? 0);
      visit(place.to, level, numbered ? row.marker : "", place.day !== undefined ? `${place.until !== undefined ? `${place.day} – ${place.until}` : place.time !== undefined ? `${place.day} ${place.time}` : place.day} · ` : "");
    }
  };

  visit(rootId, 0, "");
  return `${blocks.join("\n\n")}\n`;
}
