// Replace the hits of a search (SPEC 7.4). One command: undo gives all texts back.
// - It changes item names, body texts, link labels, link groups and scribble alt text. Saved web pages do not change.
// - A hit changes only if the text there still matches (the text can change after the search).
// - Some hits never change, so that no link breaks:
//   - the target of a Markdown link or picture "](...)" (item:, link:, addresses, picture files);
//   - a passage that a link or a small item points to (its `quote`, `fromQuote`): the link finds it by its text.
// - A replacement before the passage of a small item moves its `at` with it.
// - Special codes in the replacement (there is no single standard; these are the two usual ones):
//   - a plain search (as in Microsoft Word): ^p a line break (one Enter), ^t a tab, ^^ a caret, ^& the found text;
//   - a regular expression (as in VS Code): \n a line break, \t a tab, \\ a backslash, $& the found text, $1…$99,
//     $<name> the groups, $$ a dollar sign.

import { emptyCommand, nameOrCode, withName, type ActionContext } from "./actions";
import { makeOp, type Command, type Op } from "./commands";
import { passageRange } from "./linkEnds";
import { makeMatcher, regexOf, withCodes, type SearchHit, type SearchOptions } from "./search";
import type { Id, InsideLink, ItemRecord, LinkRecord, StampRecord } from "./types";

export type ReplaceResult = {
  command: Command;
  /** The number of hits that changed. */
  replaced: number;
  /** The number of hits that did not change (a link target, a linked passage, a saved web page, or a changed text). */
  skipped: number;
};

type Range = { start: number; end: number };

/** Replaces the given hits of the query. The replacement can have special codes (see the top of this file). */
export function replaceHits(context: ActionContext, hits: readonly SearchHit[], query: string, replacement: string, options: SearchOptions = {}): ReplaceResult {
  const { store } = context;
  const matcher = makeMatcher(query, options);
  if (matcher === null || typeof matcher === "string") return { command: emptyCommand("Replace"), replaced: 0, skipped: hits.length };

  // The hits of each field of each record.
  const groups = new Map<string, { recordId: Id; field: SearchHit["field"]; ranges: Range[] }>();
  for (const hit of hits) {
    const key = `${hit.recordId}\u0000${hit.field}`;
    const group = groups.get(key) ?? { recordId: hit.recordId, field: hit.field, ranges: [] };
    group.ranges.push({ start: hit.start, end: hit.end });
    groups.set(key, group);
  }

  const items = new Map<Id, ItemRecord>();
  const texts = new Map<Id, string>();
  const links = new Map<Id, LinkRecord>();
  const stamps = new Map<Id, StampRecord>();
  let replaced = 0;
  let skipped = 0;

  /** The new text, with the hits replaced. `blocked`: ranges that must not change. */
  const rewrite = (text: string, wanted: Range[], blocked: Range[]): { text: string; changes: { at: number; delta: number }[] } => {
    const current = matcher(text);
    const ranges = wanted.filter((range) => {
      const ok = current.some((match) => match.start === range.start && match.end === range.end) && !blocked.some((block) => range.start < block.end && block.start < range.end);
      if (!ok) skipped += 1;
      return ok;
    });
    ranges.sort((a, b) => b.start - a.start);
    let out = text;
    const changes: { at: number; delta: number }[] = [];
    for (const range of ranges) {
      const words = replacementText(text, range, query, replacement, options);
      out = out.slice(0, range.start) + words + out.slice(range.end);
      changes.push({ at: range.start, delta: words.length - (range.end - range.start) });
      replaced += 1;
    }
    return { text: out, changes };
  };

  const insideMoves = new Map<Id, InsideLink>();
  for (const { recordId, field, ranges } of groups.values()) {
    if (field === "name") {
      const item = items.get(recordId) ?? store.get("items", recordId);
      if (item === undefined) {
        skipped += ranges.length;
        continue;
      }
      const { text } = rewrite(item.name, ranges, []);
      if (text !== item.name) items.set(recordId, { ...withName(item, nameOrCode(context, text)), modified: context.now() });
    } else if (field === "subtitle") {
      const item = items.get(recordId) ?? store.get("items", recordId);
      if (item?.subtitle === undefined) {
        skipped += ranges.length;
        continue;
      }
      const { text } = rewrite(item.subtitle, ranges, []);
      const after: ItemRecord = { ...item, modified: context.now() };
      if (text.trim() === "") delete after.subtitle;
      else after.subtitle = text;
      if (text !== item.subtitle) items.set(recordId, after);
    } else if (field === "body") {
      const record = store.get("texts", recordId);
      const item = items.get(recordId) ?? store.get("items", recordId);
      if (record === undefined || item === undefined) {
        skipped += ranges.length;
        continue;
      }
      const { text, changes } = rewrite(record.body, ranges, blockedRanges(context, recordId, record.body));
      if (text === record.body) continue;
      texts.set(recordId, text);
      items.set(recordId, { ...item, modified: context.now() });
      // A small item inside the page keeps the place of its passage.
      for (const link of store.all("links")) {
        if (link.kind !== "inside" || link.from !== recordId || link.at === undefined) continue;
        const delta = changes.filter((change) => change.at < link.at!).reduce((sum, change) => sum + change.delta, 0);
        if (delta !== 0) insideMoves.set(link.id, { ...link, at: link.at + delta });
      }
    } else if (field === "label" || field === "group") {
      const link = links.get(recordId) ?? store.get("links", recordId);
      const value = link !== undefined && link.kind === "link" ? link[field] : undefined;
      if (link === undefined || link.kind !== "link" || value === undefined) {
        skipped += ranges.length;
        continue;
      }
      const { text } = rewrite(value, ranges, []);
      if (text !== value) links.set(recordId, { ...link, [field]: text });
    } else if (field === "alt") {
      const stamp = stamps.get(recordId) ?? store.get("stamps", recordId);
      if (stamp === undefined || stamp.alt === undefined) {
        skipped += ranges.length;
        continue;
      }
      const { text } = rewrite(stamp.alt, ranges, []);
      if (text !== stamp.alt) stamps.set(recordId, { ...stamp, alt: text });
    } else {
      // A saved web page or PDF is a copy: it never changes.
      skipped += ranges.length;
    }
  }

  const ops: Op[] = [];
  for (const [id, body] of texts) ops.push(makeOp("texts", id, store.get("texts", id)!, { id, body }));
  for (const [id, item] of items) ops.push(makeOp("items", id, store.get("items", id)!, item));
  for (const [id, link] of links) ops.push(makeOp("links", id, store.get("links", id)!, link));
  for (const [id, link] of insideMoves) ops.push(makeOp("links", id, store.get("links", id)!, link));
  for (const [id, stamp] of stamps) ops.push(makeOp("stamps", id, store.get("stamps", id)!, stamp));
  return { command: { label: replaced === 1 ? "Replace" : "Replace all", ops }, replaced, skipped };
}

/** The parts of a body that a replacement must not change: link targets, and the passages that links point to. */
function blockedRanges(context: ActionContext, itemId: Id, body: string): Range[] {
  const blocked: Range[] = [];
  for (const match of body.matchAll(/\]\(([^)\n]*)\)/g)) blocked.push({ start: match.index + 1, end: match.index + match[0].length });
  for (const link of context.store.all("links")) {
    const quotes: { quote: string; at?: number }[] = [];
    if (link.kind === "link" && link.to === itemId && link.quote !== undefined) quotes.push({ quote: link.quote });
    if (link.kind === "link" && link.from === itemId && link.fromQuote !== undefined) quotes.push({ quote: link.fromQuote });
    if (link.kind === "inside" && link.from === itemId && link.quote !== undefined) quotes.push({ quote: link.quote, at: link.at });
    for (const { quote, at } of quotes) {
      const range = passageRange(body, { itemId, quote, range: at === undefined ? undefined : { from: at, to: at + quote.length } });
      if (range !== null) blocked.push({ start: range.from, end: range.to });
      // The passage is in the text more than one time: keep all of them (the link can point to any one).
      else for (let at = body.indexOf(quote); quote !== "" && at !== -1; at = body.indexOf(quote, at + 1)) blocked.push({ start: at, end: at + quote.length });
    }
  }
  return blocked;
}

/** Plain-search codes of the replacement (as in Microsoft Word). "^&": the found text. */
export const REPLACE_CODES: Readonly<Record<string, string>> = { p: "\n", t: "\t", "^": "^" };
/** Regular-expression codes of the replacement (with $&, $1…, $<name>, $$). */
const ESCAPES: Readonly<Record<string, string>> = { n: "\n", t: "\t", "\\": "\\" };

/** The new text for one match at `range` of `text`. */
export function replacementText(text: string, range: Range, query: string, replacement: string, options: SearchOptions = {}): string {
  const found = text.slice(range.start, range.end);
  if (options.regex !== true) return replacement.replace(/\^([pt^&])/g, (_whole, code: string) => (code === "&" ? found : REPLACE_CODES[code]!));
  const pattern = regexOf(withCodes(query, options).query, options);
  if (typeof pattern === "string") return replacement;
  const sticky = new RegExp(pattern.source, pattern.flags.replace("g", "") + "y");
  sticky.lastIndex = range.start;
  const match: { [index: number]: string | undefined; length: number; groups?: Record<string, string> } = sticky.exec(text) ?? { 0: found, length: 1 };
  return replacement.replace(/\\([nt\\])|\$(\$|&|<([^>]+)>|(\d{1,2}))/g, (whole, escape?: string, token?: string, name?: string, digits?: string) => {
    if (escape !== undefined) return ESCAPES[escape]!;
    if (token === "$") return "$";
    if (token === "&") return found;
    if (name !== undefined) return match.groups?.[name] ?? "";
    const index = Number(digits);
    if (index >= 1 && index < match.length) return match[index] ?? "";
    // "$12" with one group: group 1, then "2".
    if (digits!.length === 2 && Number(digits![0]) >= 1 && Number(digits![0]) < match.length) return (match[Number(digits![0])] ?? "") + digits![1];
    return whole;
  });
}
