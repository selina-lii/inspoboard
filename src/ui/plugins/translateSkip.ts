// "Do not translate": the same parts as "Do not read" of read-aloud (reading.ts), but they stay in the result as they
// are (in the original language) instead of being left out.
// - Before the plugin call, each skipped part becomes a marker "⟦n⟧". A plugin keeps markers (they have no letters;
//   a line of markers only is not translated at all). After the call, the markers become the parts again.
// - A marker that the plugin lost: its part goes at the end of the text.

import type { SpeechSkip } from "../../io/settings";
import { AUTHOR_DATE, AUTHOR_PAGE, NUMBERED, referenceRanges, SUPERSCRIPT, withoutAuthors } from "./reading";

export type Protected = { text: string; parts: string[] };

type Span = { start: number; end: number };

const marker = (index: number) => `⟦${index}⟧`;

/** True if any part is skipped. */
export function skipsAny(skip: SpeechSkip): boolean {
  return Object.values(skip).some((value) => value === true);
}

/** The text with the skipped parts as markers, and the parts. */
export function protectText(text: string, skip: SpeechSkip): Protected {
  if (!skipsAny(skip)) return { text, parts: [] };
  const spans: Span[] = [];
  const references = referenceRanges(text);
  const inReferences = (at: number) => references.some((range) => at >= range.start && at < range.end);
  // The reference list: each entry line whole, or its parts.
  for (const range of references) {
    let at = range.start;
    for (const line of text.slice(range.start, range.end).split("\n")) {
      const start = at + (line.length - line.trimStart().length);
      const end = at + line.trimEnd().length;
      if (end > start) {
        if (skip.referenceList) spans.push({ start, end });
        else spans.push(...referenceParts(text.slice(start, end), skip).map((span) => ({ start: start + span.start, end: start + span.end })));
      }
      at += line.length + 1;
    }
  }
  // The text: citations and groups.
  const patterns: RegExp[] = [];
  if (skip.authorDate) patterns.push(AUTHOR_DATE);
  if (skip.authorPage) patterns.push(AUTHOR_PAGE);
  if (skip.numbered) patterns.push(NUMBERED, SUPERSCRIPT);
  if (skip.parentheses) patterns.push(/(?<!\])\([^()\n]*\)/gu);
  if (skip.brackets) patterns.push(/\[[^[\]\n]*\](?!\()/gu);
  for (const pattern of patterns) {
    for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags))) {
      // A leading space stays outside the marker.
      const lead = match[0].length - match[0].trimStart().length;
      const start = match.index + lead;
      if (!inReferences(start)) spans.push({ start, end: match.index + match[0].length });
    }
  }
  return replaceSpans(text, spans);
}

/** The text with the markers replaced by their parts again. */
export function restoreText(text: string, parts: readonly string[]): string {
  if (parts.length === 0) return text;
  const used = new Set<number>();
  // Plugins can change the marker a little: spaces in it, or other brackets.
  const out = text.replace(/[⟦［【[]{1,2}\s*(\d{1,4})\s*[⟧］】\]]{1,2}/g, (found, digits: string) => {
    const index = Number(digits);
    if (index < 1 || index > parts.length) return found;
    used.add(index);
    return parts[index - 1]!;
  });
  const lost = parts.filter((_, index) => !used.has(index + 1));
  return lost.length === 0 ? out : `${out} ${lost.join(" ")}`;
}

/** The parts of one reference entry to keep: authors, dates, pages, links (as set). */
function referenceParts(entry: string, skip: SpeechSkip): Span[] {
  const spans: Span[] = [];
  const add = (pattern: RegExp) => {
    for (const match of entry.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))) {
      spans.push({ start: match.index, end: match.index + match[0].length });
    }
  };
  if (skip.referenceLinks) add(/\b(?:https?:\/\/|www\.)\S+|\bdoi:\s*\S+/gi);
  if (skip.referenceDates) {
    add(/\(\s*(?:(?:1[5-9]\d\d|20\d\d)[a-z]?|n\.d\.)(?:,\s*[\p{L} \d]+)?\s*\)/gu);
    add(/\b(?:1[5-9]\d\d|20\d\d)[a-z]?\b/g);
  }
  if (skip.referencePages) add(/\b(?:pp?\.|pages?)\s*\d+(?:\s*[–—\-]\s*\d+)?|\b\d+\s*[–—\-]\s*\d+\b/gi);
  if (skip.referenceAuthors) {
    const marker = /^\s*(?:[-*+]\s+|\d+[.)]\s+|\[\d+\]\s*)/.exec(entry)?.[0].length ?? 0;
    const rest = withoutAuthors(entry.slice(marker));
    const end = entry.length - rest.length;
    if (end > marker) spans.push({ start: marker, end: entry.slice(0, end).trimEnd().length });
  }
  return spans;
}

/** Replaces spans (overlapping ones join) with markers. */
function replaceSpans(text: string, spans: Span[]): Protected {
  const sorted = spans.filter((span) => span.end > span.start).sort((a, b) => a.start - b.start || b.end - a.end);
  const joined: Span[] = [];
  for (const span of sorted) {
    const last = joined[joined.length - 1];
    if (last !== undefined && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else joined.push({ ...span });
  }
  const parts: string[] = [];
  let out = "";
  let at = 0;
  for (const span of joined) {
    out += text.slice(at, span.start);
    parts.push(text.slice(span.start, span.end));
    out += marker(parts.length);
    at = span.end;
  }
  return { text: out + text.slice(at), parts };
}
