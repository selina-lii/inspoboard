// Search in a board and in all boards below it. See docs/SPEC.md section 7.4.

import type { GraphIndex } from "./graph";
import type { Store } from "./store";
import type { Id } from "./types";

/** "page": the text of the saved web page (or PDF) of a link object. */
export type SearchField = "name" | "body" | "label" | "group" | "alt" | "page";

export type SearchHit = {
  /** The record that has the match: an item, a stamp, or a relation link. */
  recordId: Id;
  field: SearchField;
  /** Character offset of the match in the field. */
  start: number;
  end: number;
  /** The text near the match, for the result list. */
  excerpt: string;
  /** Item IDs from the search board to the board that shows the record. */
  path: Id[];
};

export type SearchOptions = {
  maxDepth?: number;
  maxHits?: number;
  caseSensitive?: boolean;
};

const EXCERPT_RADIUS = 30;

/**
 * Finds the query in all records below a board. The walk goes down the place links.
 * Each record is searched one time only, also if it is on many boards.
 * `pages`: the texts of saved web pages, by the ID of their link object (the app reads them; the core has no files).
 */
export function searchBoard(
  store: Store,
  graph: GraphIndex,
  boardId: Id,
  query: string,
  options: SearchOptions = {},
  pages: ReadonlyMap<Id, string> = new Map(),
): SearchHit[] {
  const maxDepth = options.maxDepth ?? 32;
  const maxHits = options.maxHits ?? 500;
  const matcher = makeMatcher(query, options.caseSensitive ?? false);
  const hits: SearchHit[] = [];
  if (matcher === null) return hits;

  const visited = new Set<Id>([boardId]);
  const queue: { id: Id; path: Id[] }[] = [{ id: boardId, path: [] }];
  const add = (recordId: Id, field: SearchField, text: string | undefined, path: Id[]): void => {
    if (text === undefined) return;
    for (const range of matcher(text)) {
      if (hits.length >= maxHits) return;
      hits.push({ recordId, field, ...range, excerpt: excerptOf(text, range.start, range.end), path });
    }
  };

  // Breadth-first walk: hits near the search board come first.
  for (let index = 0; index < queue.length && hits.length < maxHits; index += 1) {
    const { id, path } = queue[index]!;
    const item = store.get("items", id);
    add(id, "name", item?.name, path);
    add(id, "body", store.get("texts", id)?.body, path);
    add(id, "alt", store.get("stamps", id)?.alt, path);
    add(id, "page", pages.get(id), path);
    for (const relation of graph.relationsFrom(id)) {
      add(relation.id, "label", relation.label, path);
      add(relation.id, "group", relation.group, path);
    }
    if (path.length >= maxDepth) continue;
    for (const place of graph.childrenOf(id)) {
      if (visited.has(place.to)) continue;
      visited.add(place.to);
      queue.push({ id: place.to, path: [...path, id] });
    }
  }
  return hits;
}

type Range = { start: number; end: number };
type Matcher = (text: string) => Range[];

function makeMatcher(query: string, caseSensitive: boolean): Matcher | null {
  if (query.length === 0) return null;
  if (caseSensitive) {
    return (text) => findAll(text, query).map((start) => ({ start, end: start + query.length }));
  }
  const needle = foldCase(query).folded;
  return (text) => {
    const { folded, origin } = foldCase(text);
    return findAll(folded, needle).map((start) => ({ start: origin[start]!, end: origin[start + needle.length]! }));
  };
}

function findAll(haystack: string, needle: string): number[] {
  const starts: number[] = [];
  let from = 0;
  for (;;) {
    const start = haystack.indexOf(needle, from);
    if (start === -1) return starts;
    starts.push(start);
    from = start + needle.length;
  }
}

/**
 * Lower-case text for a search that ignores case. Some characters change length in lower case
 * (for example Turkish "İ" becomes two code units). `origin[i]` is the offset in the original text
 * for offset i in the folded text. Thus a match marks the correct characters in the original text.
 */
export function foldCase(text: string): { folded: string; origin: number[] } {
  let folded = "";
  const origin: number[] = [];
  let offset = 0;
  for (const char of text) {
    const lower = char.toLocaleLowerCase();
    for (let unit = 0; unit < lower.length; unit += 1) origin.push(offset);
    folded += lower;
    offset += char.length;
  }
  origin.push(offset);
  return { folded, origin };
}

function excerptOf(text: string, start: number, end: number): string {
  const from = Math.max(0, start - EXCERPT_RADIUS);
  const to = Math.min(text.length, end + EXCERPT_RADIUS);
  const prefix = from > 0 ? "…" : "";
  const suffix = to < text.length ? "…" : "";
  return prefix + text.slice(from, to).replace(/\s+/g, " ") + suffix;
}
