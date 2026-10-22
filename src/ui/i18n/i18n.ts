// UI language. See docs/SPEC.md section 7.9.
// - The source text of the UI is English. A language pack maps English text to the text of its language.
// - The packs are part of the app (src/ui/i18n/<language>.json). They are not plugins.
// - A key can have places for values: "Undo {0} (⌘Z)". In the text of the pack, "{0}" puts the value as it is,
//   "{t0}" puts the value after translation (for a UI word, for example a command name). User text uses "{0}".
// - Text that is not in the pack stays English.

import zh from "./zh.json";
import zhHant from "./zh-Hant.json";

export type UiLanguage = "en" | "zh" | "zh-Hant";

/** The UI languages, with their names in their own language. */
export const UI_LANGUAGES: readonly { id: UiLanguage; name: string }[] = [
  { id: "en", name: "English" },
  { id: "zh", name: "中文（简体）" },
  { id: "zh-Hant", name: "中文（繁體）" },
];

/** The locale of dates and numbers, and the lang attribute of the page (CJK fonts pick the right glyphs). */
const LOCALES: Record<UiLanguage, string> = { en: "en", zh: "zh-Hans", "zh-Hant": "zh-Hant" };

const PACKS: Record<UiLanguage, Readonly<Record<string, string>>> = { en: {}, zh, "zh-Hant": zhHant };

export function isUiLanguage(value: unknown): value is UiLanguage {
  return UI_LANGUAGES.some((language) => language.id === value);
}

type Pattern = { match: RegExp; text: string };
type Compiled = { exact: Map<string, string>; patterns: Pattern[]; cache: Map<string, string> };

/** The largest number of texts that the cache keeps. */
const CACHE_SIZE = 5000;

function compile(pack: Readonly<Record<string, string>>): Compiled {
  const exact = new Map<string, string>();
  const patterns: Pattern[] = [];
  for (const [key, text] of Object.entries(pack)) {
    // A key with places is also exact: t("Undo {0}", name) finds it.
    exact.set(key, text);
    if (!/\{\d\}/.test(key)) continue;
    const source = key
      .split(/(\{\d\})/)
      .map((part) => (/^\{\d\}$/.test(part) ? "(.+?)" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
      .join("");
    patterns.push({ match: new RegExp(`^${source}$`, "s"), text });
  }
  // A longer key is more exact: it goes first.
  patterns.sort((a, b) => b.match.source.length - a.match.source.length);
  return { exact, patterns, cache: new Map() };
}

let language: UiLanguage = "en";
let compiled: Compiled = compile(PACKS.en);

export function uiLanguage(): UiLanguage {
  return language;
}

export function setUiLanguage(next: UiLanguage): void {
  if (next === language) return;
  language = next;
  compiled = compile(PACKS[next]);
  if (typeof document !== "undefined") document.documentElement.lang = LOCALES[next];
}

/** The locale for dates and numbers in the UI language ("zh-Hant"). */
export function uiLocale(): string {
  return LOCALES[language];
}

/** The text in the UI language. `values` fill the places "{0}", "{1}", … of the key. */
export function t(text: string, ...values: (string | number)[]): string {
  const out = translate(text);
  return values.length === 0 ? out : out.replace(/\{(t?)(\d)\}/g, (whole, translated: string, index: string) => {
    const value = values[Number(index)];
    if (value === undefined) return whole;
    return translated === "t" ? translate(String(value)) : String(value);
  });
}

/** The text in the UI language. Space at the start and the end stays. Unknown text stays as it is. */
export function translate(text: string): string {
  if (language === "en") return text;
  const cached = compiled.cache.get(text);
  if (cached !== undefined) return cached;
  const core = text.trim();
  let out = text;
  if (core !== "") {
    const found = lookup(core);
    if (found !== null) out = text.slice(0, text.indexOf(core)) + found + text.slice(text.indexOf(core) + core.length);
  }
  if (compiled.cache.size >= CACHE_SIZE) compiled.cache.clear();
  compiled.cache.set(text, out);
  return out;
}

function lookup(text: string): string | null {
  const exact = compiled.exact.get(text);
  if (exact !== undefined) return exact;
  for (const pattern of compiled.patterns) {
    const match = pattern.match.exec(text);
    if (match === null) continue;
    return pattern.text.replace(/\{(t?)(\d)\}/g, (whole, translated: string, index: string) => {
      const value = match[Number(index) + 1];
      if (value === undefined) return whole;
      return translated === "t" ? (lookup(value) ?? value) : value;
    });
  }
  return null;
}

let uiTexts: Set<string> | null = null;

/**
 * True if a text on the screen is a UI text: a key of a language pack (English) or its text in a language. Texts
 * with values ("Undo {0}") are not in it. Buzzies mode leaves UI texts as they are (SPEC 7.13).
 */
export function isUiText(text: string): boolean {
  uiTexts ??= new Set(
    Object.values(PACKS)
      .flatMap((pack) => [...Object.keys(pack), ...Object.values(pack)])
      .filter((entry) => !/\{t?\d\}/.test(entry)),
  );
  return uiTexts.has(text.trim());
}
