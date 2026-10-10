// Inline references in Markdown body text. See docs/SPEC.md section 2.3.
// Syntax: [label](item:<id>). The text is the single source of these references.

import type { Id } from "./types";

export const ITEM_URL_PREFIX = "item:";
/** A text link: [label](link:<relation link ID>). The relation link holds the target and the target location. */
export const LINK_URL_PREFIX = "link:";

export type InlineRef = {
  /** Target item ID. */
  to: Id;
  label: string;
  /** Character offset of the reference in the body text. */
  start: number;
  end: number;
};

const REF_PATTERN = /\[([^\]\n]*)\]\(item:([0-9a-z]{12})\)/g;
const FENCE_PATTERN = /^ {0,3}(```|~~~)/;

/** Returns all inline references. References in code blocks and code spans are ignored. */
export function findInlineRefs(body: string): InlineRef[] {
  const refs: InlineRef[] = [];
  for (const segment of proseSegments(body)) {
    for (const match of segment.text.matchAll(REF_PATTERN)) {
      const start = segment.offset + match.index;
      refs.push({ to: match[2]!, label: match[1]!, start, end: start + match[0].length });
    }
  }
  return refs;
}

export function itemUrl(id: Id): string {
  return `${ITEM_URL_PREFIX}${id}`;
}

export function inlineRefMarkdown(label: string, id: Id): string {
  return `[${label}](${itemUrl(id)})`;
}

/** Markdown for a text link to a relation link record. */
export function textLinkMarkdown(label: string, linkId: Id): string {
  return `[${label}](${LINK_URL_PREFIX}${linkId})`;
}

/**
 * Replaces the text at [from, to) with a text link, if the text there is still `label`.
 * Returns null if the text changed (then nothing is replaced).
 */
export function withTextLink(body: string, from: number, to: number, label: string, linkId: Id): string | null {
  if (body.slice(from, to) !== label) return null;
  return body.slice(0, from) + textLinkMarkdown(label, linkId) + body.slice(to);
}

type Segment = { text: string; offset: number };

/** Splits the text into parts that are not code. Each part keeps its offset in the full text. */
function proseSegments(body: string): Segment[] {
  const segments: Segment[] = [];
  let offset = 0;
  let fence: string | null = null;
  for (const line of body.split(/(?<=\n)/)) {
    const fenceMatch = FENCE_PATTERN.exec(line);
    if (fence === null && fenceMatch) {
      fence = fenceMatch[1]!;
    } else if (fence !== null && fenceMatch && fenceMatch[1] === fence) {
      fence = null;
    } else if (fence === null) {
      segments.push(...withoutCodeSpans(line, offset));
    }
    offset += line.length;
  }
  return segments;
}

function withoutCodeSpans(line: string, offset: number): Segment[] {
  const segments: Segment[] = [];
  const spanPattern = /(`+)[^`]*?\1/g;
  let cursor = 0;
  for (const match of line.matchAll(spanPattern)) {
    segments.push({ text: line.slice(cursor, match.index), offset: offset + cursor });
    cursor = match.index + match[0].length;
  }
  segments.push({ text: line.slice(cursor), offset: offset + cursor });
  return segments;
}
