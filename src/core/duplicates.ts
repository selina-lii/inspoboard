// Duplicate check: a light test for a text that is a copy of a different item.
// The first sentence of the text (at least MIN_LENGTH characters) is searched in the texts of all other items.
// An exact match is a probable duplicate. It is only a warning: nothing changes.

import type { Store } from "./store";
import type { Id } from "./types";

/** A shorter first sentence is too common to mean a copy. CJK text has more meaning in each character. */
const MIN_LENGTH = 24;
const MIN_LENGTH_CJK = 10;

/** The first sentence of a text, without Markdown line marks. Null if it is too short to compare. */
export function firstSentence(body: string): string | null {
  for (const raw of body.split("\n")) {
    const line = raw.replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/, "").trim();
    if (line === "") continue;
    const end = line.search(/[.!?。！？](\s|$)|[。！？]/);
    const sentence = (end === -1 ? line : line.slice(0, end + 1)).trim();
    const cjk = /[㐀-鿿぀-ヿ가-힯]/.test(sentence);
    return sentence.length >= (cjk ? MIN_LENGTH_CJK : MIN_LENGTH) ? sentence : null;
  }
  return null;
}

/** Other items whose text has the first sentence of this text. */
export function findDuplicates(store: Store, itemId: Id, body: string): Id[] {
  const sentence = firstSentence(body);
  if (sentence === null) return [];
  const result: Id[] = [];
  for (const text of store.all("texts")) {
    if (text.id !== itemId && store.has("items", text.id) && text.body.includes(sentence)) result.push(text.id);
  }
  return result;
}
