// A rough time to listen to a text: words at a normal speaking speed, divided by the read-aloud speed.
// CJK characters count as part of a word each (the voice reads English; it spells or skips them).

import { wordParts } from "../../core/wordCount";

/** Words per minute of the voices at speed 1. */
export const WORDS_PER_MINUTE = 165;

/** The words of a text (Latin, digits, and the like), plus CJK characters as 0.6 of a word each. */
export function wordCount(text: string): number {
  const { words, characters } = wordParts(text);
  return words + characters * 0.6;
}

/** Seconds to listen to a text at a read-aloud speed (1 is normal). */
export function listenSeconds(text: string, rate: number): number {
  return wordsSeconds(wordCount(text), rate);
}

/** "about 40 s", "about 12 min", "about 1 h 20 min". */
export function formatListenTime(seconds: number): string {
  if (seconds < 50) return `about ${Math.max(5, Math.round(seconds / 5) * 5)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `about ${hours} h${rest === 0 ? "" : ` ${rest} min`}`;
}

/**
 * The words from each sentence to the end (`after[i]`: the words of sentences i, i + 1, …). Made one time for a
 * document; the time left is then one look-up, also with thousands of sentences.
 */
export function wordsToEnd(sentences: readonly { speech: string }[]): Float64Array {
  const after = new Float64Array(sentences.length + 1);
  for (let index = sentences.length - 1; index >= 0; index -= 1) after[index] = after[index + 1]! + wordCount(sentences[index]!.speech);
  return after;
}

/** Seconds to listen to a number of words at a read-aloud speed. */
export function wordsSeconds(words: number, rate: number): number {
  return (words / WORDS_PER_MINUTE) * 60 / Math.max(0.1, rate);
}
