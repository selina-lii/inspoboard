// Buzzies mode (built-in plugin, SPEC 7.13): the glyph rules. Pure functions, no DOM.
// - Each word becomes symbols (!@#$%^&*()) or blocks of letter-like heights. Spaces and line ends stay.
// - The glyphs come from the word itself: the same word gives the same glyphs everywhere (a board card, the
//   outline, the page editor, the galaxy, a web page), each time.
// - Wide characters (Chinese, Japanese, Korean, full-width signs such as 「」) have no spaces between words: a run of
//   them is cut into short pieces (2 to 4 characters, from the text itself), and each piece is a word. So a Chinese
//   sentence is a mixture of symbols and blocks too. Wide symbols stay wide; blocks get different heights.
// - Any language: Latin letters give blocks of their letter shape (tall, low, middle). Letters of other scripts have
//   no such rule here: they give blocks of a height from the hash. A long run with no spaces (Thai, Lao, Khmer,
//   Burmese, a long URL) is cut into pieces of 3 to 7 characters too. Combining marks (vowel signs, accents) give
//   no glyph of their own.
// - Each other character gives one glyph.

const SYMBOLS = [..."!@#$%^&*()"];
const WIDE_SYMBOLS = [..."！＠＃＄％＾＆＊（）"];
const TALL = [..."▆▇█"];
const MID = [..."▄▅"];
const LOW = [..."▂▃"];
const EMPTY = [..."▯▭"];
const WIDE_NOISE = [...WIDE_SYMBOLS, ...TALL, ...MID, ...LOW];
const HEIGHTS = [...TALL, ...MID, ...LOW];
const NOISE = [...SYMBOLS, ...HEIGHTS];
const ASCENDERS = /[A-Zbdfhklt0-9]/;
const DESCENDERS = /[gjpqy]/;
const VOWELS = /[aeiouAEIOU]/;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const LATIN_OR_DIGIT = /[\p{Script=Latin}0-9]/u;
const MARK = /\p{M}/u;
/** A run longer than this (no spaces) is cut into pieces. */
const LONG_RUN = 12;
const WIDE = /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}　-〿＀-｠]/u;
const WIDE_OR_NOT = /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}　-〿＀-｠]+|[^\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}　-〿＀-｠]+/gu;

/** A 32-bit hash (FNV-1a, then a mix). */
export function hashOf(text: string, salt = 0): number {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

const pick = (set: readonly string[], n: number) => set[n % set.length]!;

/** Words already buzzed: the same word comes back often (each card, each editor widget). */
const known = new Map<string, string>();

/** The buzzed form of one word (a run of non-space characters). */
export function buzzWord(word: string): string {
  let buzzed = known.get(word);
  if (buzzed === undefined) {
    if (known.size > 50_000) known.clear();
    buzzed = makeBuzzWord(word);
    known.set(word, buzzed);
  }
  return buzzed;
}

function makeBuzzWord(word: string): string {
  const seed = hashOf(word);
  // Mixed: about one word in three is symbols, the others are blocks.
  const symbols = seed % 3 === 0;
  return [...word]
    .map((ch, at) => {
      const n = hashOf(word, at + 1);
      const wide = WIDE.test(ch);
      if (symbols) return pick(wide ? WIDE_SYMBOLS : SYMBOLS, n);
      // A wide character has no letter shape: a block of a height from the hash (an empty one sometimes).
      if (wide) return n % 7 === 0 ? pick(EMPTY, n >>> 3) : pick(HEIGHTS, n >>> 3);
      if (MARK.test(ch)) return "";
      if (!LETTER_OR_DIGIT.test(ch)) return pick(SYMBOLS, n);
      // A letter of a script other than Latin: a block of a height from the hash.
      if (!LATIN_OR_DIGIT.test(ch)) return n % 7 === 0 ? pick(EMPTY, n >>> 3) : pick(HEIGHTS, n >>> 3);
      if (VOWELS.test(ch) && n % 4 === 0) return pick(EMPTY, n);
      if (ASCENDERS.test(ch)) return pick(TALL, n);
      if (DESCENDERS.test(ch)) return pick(LOW, n);
      return pick(MID, n);
    })
    .join("");
}

/** The buzzed form of a text: each word buzzed, spaces and line ends as they are. */
export function buzzText(text: string): string {
  return text.replace(/\S+/gu, buzzRun);
}

/** A run of non-space characters: runs of wide characters are cut into short words (they have no spaces). */
function buzzRun(run: string): string {
  if (!WIDE.test(run) && [...run].length <= LONG_RUN) return buzzWord(run);
  let out = "";
  for (const part of run.match(WIDE_OR_NOT)!) {
    const wide = WIDE.test(part);
    const chars = [...part];
    if (!wide && chars.length <= LONG_RUN) {
      out += buzzWord(part);
      continue;
    }
    // Pieces of 2 to 4 wide characters, or 3 to 7 others. The length comes from the characters here: the same
    // text is cut the same way each time.
    const [shortest, choices] = wide ? [2, 3] : [3, 5];
    for (let at = 0; at < chars.length; ) {
      const length = shortest + (hashOf(chars.slice(at, at + 2).join("")) % choices);
      out += buzzWord(chars.slice(at, at + length).join(""));
      at += length;
    }
  }
  return out;
}

/** A random-looking glyph for the animation (step `n`), as wide as `ch`. */
export function noiseGlyph(ch: string, n: number): string {
  if (/\s/.test(ch)) return ch;
  return WIDE.test(ch) ? pick(WIDE_NOISE, n) : pick(NOISE, n);
}
