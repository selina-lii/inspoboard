// A rough time to listen to a text: words at a normal speaking speed, divided by the read-aloud speed.
// CJK characters count as part of a word each (the voice reads English; it spells or skips them).

/** Words per minute of the voices at speed 1. */
export const WORDS_PER_MINUTE = 165;

/** The words of a text (Latin, digits, and the like), plus CJK characters as 0.6 of a word each. */
export function wordCount(text: string): number {
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu)?.filter((word) => !/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(word)).length ?? 0;
  const cjk = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
  return words + cjk * 0.6;
}

/** Seconds to listen to a text at a read-aloud speed (1 is normal). */
export function listenSeconds(text: string, rate: number): number {
  return (wordCount(text) / WORDS_PER_MINUTE) * 60 / Math.max(0.1, rate);
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
