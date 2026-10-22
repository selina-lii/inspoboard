// Search in a board and in all boards below it. See docs/SPEC.md section 7.4.

import type { GraphIndex } from "./graph";
import type { Store } from "./store";
import type { Id } from "./types";

/** "page": the text of the saved web page (or PDF) of a link object. */
export type SearchField = "name" | "subtitle" | "body" | "label" | "group" | "alt" | "page";

export type SearchHit = {
  /** The record that has the match: an item, a stamp, or a relation link. */
  recordId: Id;
  field: SearchField;
  /** Character offset of the match in the field. */
  start: number;
  end: number;
  /** The text that matches (for a regular expression, it is not the query). */
  match: string;
  /** The text near the match, for the result list. */
  excerpt: string;
  /** Item IDs from the search board to the board that shows the record. */
  path: Id[];
};

export type SearchOptions = {
  maxDepth?: number;
  maxHits?: number;
  caseSensitive?: boolean;
  /** Only whole words: no letter, digit or "_" right before or after the match. */
  wholeWord?: boolean;
  /** The query is a regular expression (JavaScript syntax). */
  regex?: boolean;
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
  const matcher = makeMatcher(query, options);
  const hits: SearchHit[] = [];
  if (matcher === null || typeof matcher === "string") return hits;

  const visited = new Set<Id>([boardId]);
  const queue: { id: Id; path: Id[] }[] = [{ id: boardId, path: [] }];
  const add = (recordId: Id, field: SearchField, text: string | undefined, path: Id[]): void => {
    if (text === undefined) return;
    for (const range of matcher(text)) {
      if (hits.length >= maxHits) return;
      hits.push({ recordId, field, ...range, match: text.slice(range.start, range.end), excerpt: excerptOf(text, range.start, range.end), path });
    }
  };

  // Breadth-first walk: hits near the search board come first.
  for (let index = 0; index < queue.length && hits.length < maxHits; index += 1) {
    const { id, path } = queue[index]!;
    const item = store.get("items", id);
    add(id, "name", item?.name, path);
    add(id, "subtitle", item?.subtitle, path);
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
export type Matcher = (text: string) => Range[];

/** A letter, a digit or "_": a match of "whole word" has none of these right before or after it. */
const WORD_CHARACTER = /[\p{L}\p{N}_]/u;

/**
 * The matcher of a query. Null: an empty query. A string: the regular expression is not correct (the error message).
 */
export function makeMatcher(query: string, options: Pick<SearchOptions, "caseSensitive" | "wholeWord" | "regex"> = {}): Matcher | string | null {
  if (query.length === 0) return null;
  // A plain query with special codes (^p, ^t, …) is a regular expression.
  ({ query, options } = withCodes(query, options));
  if (options.regex === true) {
    const pattern = regexOf(query, options);
    if (typeof pattern === "string") return pattern;
    return (text) => {
      const ranges: Range[] = [];
      pattern.lastIndex = 0;
      for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
        // An empty match finds nothing to show or replace: go on after it.
        if (match[0].length === 0) pattern.lastIndex += 1;
        else ranges.push({ start: match.index, end: match.index + match[0].length });
      }
      return ranges;
    };
  }
  const plain: Matcher =
    options.caseSensitive === true
      ? (text) => findAll(text, query).map((start) => ({ start, end: start + query.length }))
      : (() => {
          const needle = foldCase(query).folded;
          return (text: string) => {
            const { folded, origin } = foldCase(text);
            return findAll(folded, needle).map((start) => ({ start: origin[start]!, end: origin[start + needle.length]! }));
          };
        })();
  if (options.wholeWord !== true) return plain;
  return (text) => plain(text).filter((range) => !WORD_CHARACTER.test(text.slice(range.start - 1, range.start)) && !WORD_CHARACTER.test(text.slice(range.end, range.end + 1)));
}

/**
 * Special codes in a plain query (as in Microsoft Word): ^p a line break (one Enter; a blank line between Markdown
 * paragraphs is ^p^p), ^t a tab, ^^ a caret, ^? any character, ^# any digit, ^$ any letter. Another "^" is a caret.
 * The codes of the replacement text: see core/replace.ts.
 */
export const FIND_CODES: Readonly<Record<string, string>> = { p: "\\r?\\n", t: "\\t", "^": "\\^", "?": "[^\\n]", "#": "\\p{N}", $: "\\p{L}" };

/** A plain query with special codes, as a regular expression (the same matches). Other queries stay as they are. */
export function withCodes<T extends Pick<SearchOptions, "regex">>(query: string, options: T): { query: string; options: T } {
  if (options.regex === true || !/\^[pt^?#$]/.test(query)) return { query, options };
  let source = "";
  for (let index = 0; index < query.length; index += 1) {
    const code = query[index] === "^" ? FIND_CODES[query[index + 1] ?? ""] : undefined;
    if (code !== undefined) {
      source += code;
      index += 1;
    } else {
      source += query[index]!.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    }
  }
  return { query: source, options: { ...options, regex: true } };
}

/** The regular expression of a query (flags "g", "m" and "u"), or the error message. */
export function regexOf(query: string, options: Pick<SearchOptions, "caseSensitive" | "wholeWord"> = {}): RegExp | string {
  const source = options.wholeWord === true ? `(?<![\\p{L}\\p{N}_])(?:${query})(?![\\p{L}\\p{N}_])` : query;
  try {
    // "m": ^ and $ are the start and end of each line, as in text editors.
    return new RegExp(source, options.caseSensitive === true ? "gmu" : "gimu");
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
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
