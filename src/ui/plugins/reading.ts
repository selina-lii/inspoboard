// Read-aloud text rules, in the app (not in a voice plugin): parts that are not said, and the reference list.
// The plugin splits the text into sentences. These rules change only the words to say, never the ranges.
// Thus the highlight stays on the full sentence.

import type { Sentence } from "../../io/plugins";
import type { SpeechMarkdown, SpeechSkip } from "../../io/settings";

/** A heading line of a reference list: Markdown ("## References") or a line alone ("Bibliography"). */
const REFERENCE_HEADING = /^\s*(#{1,6}\s*)?(references|reference list|bibliography|works cited|literature cited|sources|citations|notes and references)\s*:?\s*$/i;
const MARKDOWN_HEADING = /^\s*#{1,6}\s/;

/** The ranges of reference lists in a text, without the heading line. It ends at the next Markdown heading, or at the end. */
export function referenceRanges(text: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let open: number | null = null;
  let at = 0;
  for (const line of text.split("\n")) {
    const lineEnd = at + line.length;
    if (REFERENCE_HEADING.test(line)) {
      if (open !== null) ranges.push({ start: open, end: at });
      open = lineEnd + 1;
    } else if (open !== null && MARKDOWN_HEADING.test(line)) {
      ranges.push({ start: open, end: at });
      open = null;
    }
    at = lineEnd + 1;
  }
  if (open !== null && open < text.length) ranges.push({ start: open, end: text.length });
  return ranges.filter((range) => range.end > range.start);
}

// Citation patterns. A name: a capital word, with optional particles ("van Dijk") and hyphens.
const NAME = String.raw`(?:(?:van|von|de|der|den|da|di|du|le|la|al|el)\s+)?\p{Lu}[\p{L}'’\-]+`;
const NAMES = String.raw`${NAME}(?:\s+${NAME})*`;
const AUTHORS = String.raw`${NAMES}(?:(?:\s*,\s*|\s+)(?:&|and)\s+${NAMES}|\s*,\s*${NAMES})*(?:\s+et\s+al\.?)?`;
const PREFIX = String.raw`(?:(?:see also|see|e\.g\.,?|cf\.|i\.e\.,?)\s+)?`;
const YEAR = String.raw`(?:1[5-9]\d\d|20\d\d)[a-z]?|n\.d\.`;
const LOCATOR = String.raw`(?:\s*,\s*(?:pp?\.|para\.|ch\.|chap\.|sec\.)\s*[\d–—\-]+)`;
const DATE_PART = String.raw`${PREFIX}(?:${AUTHORS},?\s+)?(?:${YEAR})(?:\s*,\s*(?:${YEAR}))*${LOCATOR}?`;
export const AUTHOR_DATE = new RegExp(String.raw`\s?\(\s*${DATE_PART}(?:\s*;\s*${DATE_PART})*\s*\)`, "gu");
const PAGE_PART = String.raw`${PREFIX}${AUTHORS}(?:,\s*["“][^"”]+["”])?\s+\d+(?:\s*[–—\-]\s*\d+)?`;
export const AUTHOR_PAGE = new RegExp(String.raw`\s?\(\s*${PAGE_PART}(?:\s*;\s*${PAGE_PART})*\s*\)`, "gu");
const NUMBER_LIST = String.raw`\d+(?:\s*[–—,\-]\s*\d+)*`;
export const NUMBERED = new RegExp(String.raw`\s?(?:\[\s*${NUMBER_LIST}\s*\]|\(\s*${NUMBER_LIST}\s*\)(?=\s*[.,;:]|\s*$))`, "gu");
/** A citation number right after a word or a mark, as from a superscript: "growth.12 The". */
export const SUPERSCRIPT = /(?<=[\p{L}.,;:)\]])\d{1,3}(?:[,–-]\d{1,3})*(?=\s|$)/gu;

/** True if a text looks like Markdown: headings, emphasis, links, lists, quotes, code, or tables. */
export function looksLikeMarkdown(text: string): boolean {
  return /^\s{0,3}#{1,6}\s|\*\*[^*\n]+\*\*|__[^_\n]+__|!?\[[^\]\n]*\]\([^)\n]*\)|^\s*[-*+]\s+\S|^\s*\d+[.)]\s+\S|^\s{0,3}>\s|`[^`\n]+`|^\s*\|.*\|\s*$|^\s*```/m.test(text);
}

/**
 * The words of a Markdown sentence without its marks: heading marks, emphasis, code marks, link targets
 * (the label stays), images (the alt text stays), list and quote marks, task boxes, table bars, HTML tags,
 * footnote marks, and escapes.
 */
export function markdownSpeech(text: string): string {
  return text
    .replace(/<[^>\n]+>/g, " ")
    .replace(/!\[([^\]\n|]*)(?:\|[^\]\n]*)?\]\([^)\n]*\)/g, "$1")
    .replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
    .replace(/\[([^\]\n]+)\]\[[^\]\n]*\]/g, "$1")
    .replace(/\[\^[^\]\n]+\]/g, "")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/\s#{1,6}\s*$/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, "")
    .replace(/^\s*[-*_]{3,}\s*$/gm, "")
    .replace(/^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*:?-*:?\s*$/gm, "")
    .replace(/\s*\|\s*/g, ", ")
    .replace(/(\*\*|__|\*|_|~~|==|`+)(?=\S)([^\n]*?\S)\1/g, "$2")
    .replace(/[*`~]+/g, "")
    .replace(/\\([\\`*_{}[\]()#+\-.!|>])/g, "$1")
    .replace(/^[,\s]+|[,\s]+$/g, "")
    .replace(/\s{2,}/g, " ");
}

/** The mode for a text: "auto" finds it (a reference list: paper; Markdown marks: markdown; else plain). */
export function readingMode(text: string, mode: SpeechMarkdown): "markdown" | "paper" | "plain" {
  if (mode !== "auto") return mode;
  if (referenceRanges(text).length > 0) return "paper";
  return looksLikeMarkdown(text) ? "markdown" : "plain";
}

/** The words to say for a sentence outside a reference list. */
export function filterSpeech(speech: string, skip: SpeechSkip): string {
  let out = speech;
  if (skip.authorDate) out = out.replace(AUTHOR_DATE, "");
  if (skip.authorPage) out = out.replace(AUTHOR_PAGE, "");
  if (skip.numbered) out = out.replace(NUMBERED, "").replace(SUPERSCRIPT, "");
  if (skip.parentheses) out = removeGroups(out, "(", ")");
  if (skip.brackets) out = removeGroups(out, "[", "]");
  return tidy(out);
}

/** The words to say for one entry of a reference list. */
export function filterReference(entry: string, skip: SpeechSkip): string {
  let out = plainMarkdown(entry).replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+|\[\d+\]\s*)/, "");
  if (skip.referenceLinks) out = out.replace(/\b(?:https?:\/\/|www\.)\S+|\bdoi:\s*\S+|\b(?:Retrieved from|Available at:?)\s*/gi, "");
  if (skip.referenceAuthors) out = withoutAuthors(out);
  if (skip.referenceDates) out = out.replace(/\(\s*(?:(?:1[5-9]\d\d|20\d\d)[a-z]?|n\.d\.)(?:,\s*[\p{L} \d]+)?\s*\)\.?/gu, "").replace(/(^|\.\s+)(?:1[5-9]\d\d|20\d\d)[a-z]?\.(?=\s|$)/g, "$1")
      // "Penguin, 2019." and "vol. 3, Mar. 2020." at the end; "2020;12" (Vancouver).
      .replace(/,\s*(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+)?(?:1[5-9]\d\d|20\d\d)[a-z]?(?=\s*\.?\s*$)/, "")
      .replace(/\b(?:1[5-9]\d\d|20\d\d)(?=;\d)/g, "");
  if (skip.referencePages) out = out.replace(/,?\s*\b(?:pp?\.|pages?)\s*\d+(?:\s*[–—\-]\s*\d+)?/gi, "").replace(/,\s*\d+\s*[–—\-]\s*\d+(?=\s*[.;]|\s*$)/g, "").replace(/(?<=\d):\s*\d+(?:\s*[–—\-]\s*\d+)?(?=\s*[.;]|\s*$)/g, "");
  return tidy(out);
}

/** The entry without its authors: before an APA date "(2020)", before a quoted title (IEEE), or before the first ". ". */
export function withoutAuthors(entry: string): string {
  const date = /\(\s*(?:(?:1[5-9]\d\d|20\d\d)[a-z]?|n\.d\.)[^)]*\)/u.exec(entry);
  if (date !== null && date.index > 0) return entry.slice(date.index);
  const quote = /[“"]/.exec(entry);
  if (quote !== null && quote.index > 0 && quote.index < 200) return entry.slice(quote.index);
  const end = /\.\s/.exec(entry);
  if (end !== null && end.index < 200 && !/\d/.test(entry.slice(0, end.index))) return entry.slice(end.index + 2);
  return entry;
}

function removeGroups(text: string, open: string, close: string): string {
  let out = "";
  let depth = 0;
  for (const char of text) {
    if (char === open) depth += 1;
    else if (char === close && depth > 0) depth -= 1;
    else if (depth === 0) out += char;
  }
  // A group without its end: keep the text (it was not a group).
  return depth > 0 ? text : out;
}

/** Spaces and marks that stay after a removal: "word ." → "word.", two spaces → one. */
function tidy(text: string): string {
  return text
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/([,;:])(?=[.,;:])/g, "")
    .replace(/^[\s,;:.]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Link labels in place of links. Emphasis and code marks go away. */
function plainMarkdown(text: string): string {
  return text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`~#<>]/g, "");
}

/**
 * The sentences to read, with the skip rules applied:
 * - Outside reference lists: each sentence, without the skipped parts.
 * - In a reference list: one sentence for each entry (line), or none if the list is skipped (always in paper mode).
 * Sentences with no words left are not read.
 */
export function prepareSentences(text: string, sentences: readonly Sentence[], skip: SpeechSkip, mode: SpeechMarkdown = "auto"): Sentence[] {
  const ranges = referenceRanges(text);
  const resolved = readingMode(text, mode);
  const clean = resolved !== "plain";
  // A paper: the reference list is not read.
  if (resolved === "paper") skip = { ...skip, referenceList: true };
  const words = (speech: string) => (clean ? markdownSpeech(speech) : speech);
  const inReferences = (sentence: Sentence) => ranges.some((range) => sentence.start >= range.start && sentence.start < range.end);
  const result: Sentence[] = [];
  for (const sentence of sentences) {
    if (inReferences(sentence)) continue;
    // A sentence in parts (formulas): each text part is cleaned; the words of a formula stay as they are.
    if (sentence.parts !== undefined) {
      const parts = sentence.parts.map((part) => ({ ...part, text: part.formula ? part.text : filterSpeech(words(part.text), skip).trim() })).filter((part) => part.text !== "");
      const speech = parts.map((part) => part.text).join(" ");
      if (/[\p{L}\p{N}]/u.test(speech)) result.push({ ...sentence, speech, parts });
      continue;
    }
    const speech = filterSpeech(words(sentence.speech), skip);
    if (/[\p{L}\p{N}]/u.test(speech)) result.push({ ...sentence, speech });
  }
  if (!skip.referenceList) {
    for (const range of ranges) {
      let at = range.start;
      for (const line of text.slice(range.start, range.end).split("\n")) {
        const lead = line.length - line.trimStart().length;
        const body = line.trim();
        const speech = body === "" ? "" : filterReference(clean ? markdownSpeech(body) : body, skip);
        if (/[\p{L}\p{N}]/u.test(speech)) result.push({ start: at + lead, end: at + lead + body.length, speech });
        at += line.length + 1;
      }
    }
  }
  // Math letters and other styled forms (𝑃, 𝑿, ², ｆ) become their plain letters: a voice reads 𝑃 as "P", not as a
  // code like "letter 1D443" (PDFs keep formulas as such letters).
  return result
    .map((sentence) => ({ ...sentence, speech: plainLetters(sentence.speech), ...(sentence.parts === undefined ? {} : { parts: sentence.parts.map((part) => ({ ...part, text: plainLetters(part.text) })) }) }))
    .sort((a, b) => a.start - b.start);
}

/**
 * The cleaning of one sentence, as `prepareSentences` does it (Markdown marks, skip rules, plain letters), for a text:
 * read aloud uses it for a sentence that it makes again just before it is said (with the words of its formulas).
 */
export function speechCleaner(text: string, skip: SpeechSkip, mode: SpeechMarkdown = "auto"): (speech: string) => string {
  const clean = readingMode(text, mode) !== "plain";
  return (speech) => plainLetters(filterSpeech(clean ? markdownSpeech(speech) : speech, skip));
}

/** The plain forms of styled letters and digits (Unicode NFKC), and a space for invisible math operators. */
export function plainLetters(text: string): string {
  return text.normalize("NFKC").replace(/[\u2061-\u2064]/g, " ");
}

/** The part of letters that are Latin (A–Z): about 1 for English, about 0 for Chinese. */
export function latinShare(text: string): number {
  let letters = 0;
  let latin = 0;
  for (const char of text.slice(0, 4000)) {
    if (!/\p{L}/u.test(char)) continue;
    letters += 1;
    if (/[A-Za-z]/.test(char)) latin += 1;
  }
  return letters === 0 ? 0 : latin / letters;
}

/** The line number (from 0) of a string index. */
export function lineAt(text: string, offset: number): number {
  let line = 0;
  for (let index = 0; index < Math.min(offset, text.length); index += 1) if (text.charCodeAt(index) === 10) line += 1;
  return line;
}

/** The string index of the start of a line (from 0). */
export function lineStart(text: string, line: number): number {
  let at = 0;
  for (let count = 0; count < line; count += 1) {
    const next = text.indexOf("\n", at);
    if (next === -1) return text.length;
    at = next + 1;
  }
  return at;
}

/**
 * The line in a second text that matches a line of the first text. A translation keeps the lines,
 * so the index is the same. If the line counts are different, the position in proportion.
 */
export function matchingLine(line: number, fromLines: number, toLines: number): number {
  if (fromLines === toLines || fromLines <= 1) return Math.min(line, toLines - 1);
  return Math.min(toLines - 1, Math.round((line * (toLines - 1)) / (fromLines - 1)));
}

/** The words before the text of a page with a subtitle: "<title>. <subtitle>." Undefined: no subtitle. */
export function leadOf(item: { name: string; subtitle?: string } | undefined): string | undefined {
  const subtitle = item?.subtitle?.trim() ?? "";
  if (subtitle === "") return undefined;
  const end = (words: string) => (/[.!?。！？:：]$/.test(words) ? words : `${words}.`);
  const name = item!.name.trim();
  return name === "" ? end(subtitle) : `${end(name)} ${end(subtitle)}`;
}
