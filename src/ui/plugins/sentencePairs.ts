// The sentence of a translation that matches a sentence of the text (for read aloud).
// - The text and its translation have the same paragraphs (a web page) or lines (an item).
// - In a paragraph, the sentence with the same number matches. If the two paragraphs have a different number of
//   sentences, the sentence at the same place (in proportion) matches.

import { matchingLine } from "./reading";

export type Range = { start: number; end: number };

/** Sentence ends: . ! ? … before a space (Latin), and 。！？； (CJK, no space). Closing quotes and brackets stay with the sentence. */
const SENTENCE_END = /[.!?…]+["'”’)\]]*(?=\s|$)|[。！？；]+["'”’」』）]*/gu;

/** The sentences of a text (without the space between them). */
export function sentenceRanges(text: string): Range[] {
  const ranges: Range[] = [];
  let start = 0;
  const push = (end: number) => {
    const from = start + (text.slice(start, end).length - text.slice(start, end).trimStart().length);
    const to = from + text.slice(from, end).trimEnd().length;
    if (to > from) ranges.push({ start: from, end: to });
    start = end;
  };
  for (const match of text.matchAll(SENTENCE_END)) push(match.index + match[0].length);
  push(text.length);
  return ranges;
}

/** The sentence of `target` that matches the sentence at `offset` in `source`, or null if `target` has no sentence. */
export function matchingSentence(source: string, offset: number, target: string): Range | null {
  const from = sentenceRanges(source);
  const to = sentenceRanges(target);
  if (to.length === 0) return null;
  let index = from.findIndex((range) => range.end > offset);
  if (index === -1) index = Math.max(0, from.length - 1);
  if (from.length === to.length) return to[index]!;
  return to[Math.min(to.length - 1, Math.floor((index * to.length) / Math.max(1, from.length)))]!;
}

/** For a web page: the paragraph of `offset`, and the matching sentence in its translation (null: not translated yet). */
export function pageCounterpart(paragraphs: readonly { start: number; end: number; text: string }[], texts: readonly (string | null)[], offset: number): { paragraph: number; range: Range } | null {
  let paragraph = paragraphs.findIndex((candidate) => candidate.end > offset);
  if (paragraph === -1) paragraph = paragraphs.length - 1;
  const source = paragraphs[paragraph];
  const target = texts[paragraph];
  if (source === undefined || target == null) return null;
  const range = matchingSentence(source.text, Math.max(0, offset - source.start), target);
  return range === null ? null : { paragraph, range };
}

/** For an item: the text in `target` that matches the sentence at `offset` in `source` (line by line). */
export function textCounterpart(source: string, offset: number, target: string): string | null {
  const sourceLines = source.split("\n");
  const targetLines = target.split("\n");
  let line = 0;
  let at = 0;
  while (line < sourceLines.length - 1 && at + sourceLines[line]!.length < offset) {
    at += sourceLines[line]!.length + 1;
    line += 1;
  }
  const targetLine = targetLines[matchingLine(line, sourceLines.length, targetLines.length)] ?? "";
  const range = matchingSentence(sourceLines[line]!, Math.max(0, offset - at), targetLine);
  return range === null ? null : targetLine.slice(range.start, range.end);
}
