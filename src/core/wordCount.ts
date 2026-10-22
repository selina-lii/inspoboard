// The word count of a text (the file details of an item: SPEC 1.1).
// A word of letters or digits (Latin, Cyrillic, and the like) counts as one. Each Chinese, Japanese or Korean
// character counts as one word, as in Chinese text editors.

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

/** The number of words of a text. */
export function countWords(text: string): number {
  const { words, characters } = wordParts(text);
  return words + characters;
}

/** The words (not CJK) and the CJK characters of a text, counted apart (the listening time weighs them apart). */
export function wordParts(text: string): { words: number; characters: number } {
  const characters = text.match(CJK)?.length ?? 0;
  const words = text.replace(CJK, " ").match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu)?.length ?? 0;
  return { words, characters };
}
