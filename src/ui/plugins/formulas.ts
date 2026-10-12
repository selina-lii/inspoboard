// Formulas in a text, for read-aloud: a "math-text" plugin says them as words (for example "a over b").
// - Markdown has no math of its own. The usual extensions (GitHub, Pandoc, Obsidian): $…$ inline, $$…$$ as a block,
//   \(…\) and \[…\], and a code block with the language "math" (or "latex", "tex").
// - Not formulas: text in code, an escaped \$, and amounts such as "$5 and $10" (Pandoc rules: no space after the
//   opening $, no space before the closing $, and no digit right after the closing $).
// - Web pages give their formulas from the page (MathML, with the LaTeX source if the page has it). See webText.ts.

import type { Sentence } from "../../io/plugins";

export type Formula = { start: number; end: number; tex?: string; mathml?: string; display: boolean };

const MATH_FENCE = /^\s{0,3}(```+|~~~+)\s*(math|latex|tex)\s*$/i;
const FENCE = /^\s{0,3}(```+|~~~+)/;

/** The formulas of a Markdown text, in order. They do not overlap. */
export function findFormulas(text: string): Formula[] {
  const formulas: Formula[] = [];
  // Code: fenced blocks (a math block is a formula) and code spans. Formulas are not looked for inside code.
  const code: [number, number][] = [];
  let at = 0;
  let fence: { mark: string; start: number; math: boolean; bodyStart: number } | null = null;
  for (const line of text.split("\n")) {
    const end = at + line.length;
    if (fence === null) {
      const open = FENCE.exec(line);
      if (open !== null) fence = { mark: open[1]!, start: at, math: MATH_FENCE.test(line), bodyStart: Math.min(text.length, end + 1) };
    } else if (line.trim().startsWith(fence.mark[0]!.repeat(fence.mark.length)) && line.trim().replace(/[`~]/g, "") === "") {
      code.push([fence.start, end]);
      if (fence.math) formulas.push({ start: fence.start, end, tex: text.slice(fence.bodyStart, Math.max(fence.bodyStart, at - 1)).trim(), display: true });
      fence = null;
    }
    at = end + 1;
  }
  if (fence !== null) code.push([fence.start, text.length]);
  for (const match of text.matchAll(/(`+)[^`]*?\1/g)) code.push([match.index, match.index + match[0].length]);
  const inCode = (position: number) => code.some(([start, end]) => position >= start && position < end);
  const taken = (start: number, end: number) => formulas.some((formula) => start < formula.end && formula.start < end);
  const escaped = (position: number) => {
    let slashes = 0;
    for (let index = position - 1; index >= 0 && text[index] === "\\"; index -= 1) slashes += 1;
    return slashes % 2 === 1;
  };
  const add = (start: number, end: number, tex: string, display: boolean) => {
    if (tex.trim() === "" || inCode(start) || taken(start, end)) return;
    formulas.push({ start, end, tex: tex.trim(), display });
  };
  // Blocks first: $$…$$ and \[…\] (not across an empty line), then \(…\), then $…$.
  for (const match of text.matchAll(/\$\$((?:(?!\n\s*\n)[\s\S])+?)\$\$/g)) if (!escaped(match.index)) add(match.index, match.index + match[0].length, match[1]!, true);
  for (const match of text.matchAll(/\\\[((?:(?!\n\s*\n)[\s\S])+?)\\\]/g)) if (!escaped(match.index)) add(match.index, match.index + match[0].length, match[1]!, true);
  for (const match of text.matchAll(/\\\(((?:(?!\n\s*\n)[\s\S])+?)\\\)/g)) if (!escaped(match.index)) add(match.index, match.index + match[0].length, match[1]!, false);
  for (const match of text.matchAll(/\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g)) {
    const start = match.index;
    if (escaped(start) || text[start - 1] === "$" || text[start + match[0].length] === "$" || escaped(start + match[0].length - 1)) continue;
    add(start, start + match[0].length, match[1]!, false);
  }
  return formulas.sort((a, b) => a.start - b.start);
}

/** Formulas of a page, and formulas of its text: the page ones first. Formulas that overlap one of them are left out. */
export function mergeFormulas(first: readonly Formula[], second: readonly Formula[]): Formula[] {
  const out = [...first];
  for (const formula of second) if (!out.some((other) => formula.start < other.end && other.start < formula.end)) out.push(formula);
  return out.sort((a, b) => a.start - b.start);
}

/**
 * The sentences with each formula said as words:
 * - A sentence break inside a formula joins the sentences. A formula outside all sentences (for example a math code
 *   block, which a voice does not read) becomes a sentence of its own.
 * - The words of a sentence with formulas: its text, with each formula replaced by its words. The text gets the usual
 *   cleaning after this (Markdown marks, skip rules). A formula without words (an error) stays as it is.
 */
export function speakFormulas(text: string, sentences: readonly Sentence[], formulas: readonly Formula[], words: readonly string[]): Sentence[] {
  if (formulas.length === 0) return [...sentences];
  type Row = { start: number; end: number; speech: string; formulas: number[] };
  const rows: Row[] = sentences.map((sentence) => ({ ...sentence, formulas: [] }));
  formulas.forEach((formula, index) => {
    const touching = rows.filter((row) => formula.start < row.end && row.start < formula.end);
    if (touching.length === 0) {
      rows.push({ start: formula.start, end: formula.end, speech: "", formulas: [index] });
      rows.sort((a, b) => a.start - b.start);
      return;
    }
    const joined: Row = {
      start: Math.min(formula.start, ...touching.map((row) => row.start)),
      end: Math.max(formula.end, ...touching.map((row) => row.end)),
      speech: touching.map((row) => row.speech).join(" "),
      formulas: [...touching.flatMap((row) => row.formulas), index],
    };
    const first = rows.indexOf(touching[0]!);
    rows.splice(first, touching.length, joined);
  });
  return rows.map((row) => {
    if (row.formulas.length === 0) return { start: row.start, end: row.end, speech: row.speech };
    let speech = "";
    let at = row.start;
    for (const index of [...row.formulas].sort((a, b) => formulas[a]!.start - formulas[b]!.start)) {
      const formula = formulas[index]!;
      speech += text.slice(at, Math.max(at, formula.start));
      const said = words[index]?.trim() ?? "";
      speech += ` ${said !== "" ? said : (formula.tex ?? text.slice(formula.start, formula.end))} `;
      at = Math.max(at, formula.end);
    }
    speech += text.slice(at, row.end);
    return { start: row.start, end: row.end, speech: speech.replace(/\s+/g, " ").trim() };
  });
}
