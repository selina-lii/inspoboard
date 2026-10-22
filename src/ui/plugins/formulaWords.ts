// The words of formulas, from a "math-text" plugin (for the formula notes: SPEC 7.10). Each formula is asked for once
// per app session and style (a memory cache). Without the plugin there are no words.

import { useEffect, useState } from "react";
import { readTexts } from "../../io/plugins";
import { usePluginHost, usePlugins } from "./pluginsContext";

export type FormulaSource = { tex?: string; mathml?: string; display: boolean };

/** The words of one formula: for speech, and for the screen (no sound spellings). */
type Words = { speech: string; display: string };
const cache = new Map<string, Words>();
/** Formulas asked for now: a second asker waits for the same reply. */
const asking = new Map<string, Promise<void>>();
const keyOf = (style: string, formula: FormulaSource) => `${style}\u0000${formula.display ? 1 : 0}\u0000${formula.tex ?? ""}\u0000${formula.mathml ?? ""}`;

type MathPlugin = { call(plugin: string, method: string, params: unknown): Promise<unknown> };

/**
 * The words of formulas, from the cache or from the plugin (only the missing ones, in one call). The formula notes
 * and read aloud use the same words: a formula is asked for once.
 */
export async function formulaWords(host: MathPlugin, plugin: string, options: Record<string, string>, formulas: readonly FormulaSource[]): Promise<Words[]> {
  const style = JSON.stringify(options);
  const keys = formulas.map((formula) => keyOf(style, formula));
  const missing = formulas.filter((formula, at) => !cache.has(keys[at]!) && !asking.has(keys[at]!) && (formula.tex ?? formula.mathml ?? "") !== "");
  if (missing.length > 0) {
    const request = host.call(plugin, "math", { formulas: missing.map(({ tex, mathml, display }) => ({ tex, mathml, display })), options }).then((reply) => {
      const speech = readTexts(reply, missing.length);
      // `display`: the words for the screen (optional; else the words for speech).
      const shown = (reply as { display?: unknown } | null)?.display;
      const display = Array.isArray(shown) && shown.length === missing.length && shown.every((text) => typeof text === "string") ? (shown as string[]) : speech;
      missing.forEach((formula, index) => cache.set(keyOf(style, formula), { speech: speech[index]!, display: display[index]! }));
    });
    const done = request.catch(() => undefined).finally(() => missing.forEach((formula) => asking.delete(keyOf(style, formula))));
    missing.forEach((formula) => asking.set(keyOf(style, formula), done));
  }
  await Promise.all(keys.map((key) => asking.get(key)));
  return keys.map((key) => cache.get(key) ?? { speech: "", display: "" });
}

/** The words of each formula for the screen (an empty string while it waits, or with no words). Null: no math-text plugin. */
export function useFormulaWords(formulas: readonly FormulaSource[] | null): string[] | null {
  const plugins = usePlugins();
  const hostValue = usePluginHost();
  const math = plugins.plugins.find((entry) => entry.details !== null && entry.capabilities.includes("math-text")) ?? null;
  const options = math === null ? {} : plugins.optionsOf(math.name);
  const style = JSON.stringify(options);
  const [, setRevision] = useState(0);
  const listKey = formulas === null ? "" : formulas.map((formula) => keyOf(style, formula)).join("\u0001");
  useEffect(() => {
    if (math === null || hostValue === null || formulas === null) return;
    if (formulas.every((formula) => cache.has(keyOf(style, formula)))) return;
    let cancelled = false;
    void formulaWords(hostValue.host, math.name, options, formulas).then(() => !cancelled && setRevision((count) => count + 1));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [math?.name, hostValue, listKey]);
  if (math === null || formulas === null) return null;
  return formulas.map((formula) => cache.get(keyOf(style, formula))?.display ?? "");
}
