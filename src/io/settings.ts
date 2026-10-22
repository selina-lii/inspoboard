// Vault settings. App state, not core data: they are in .inspoboard/settings.json.
// To add a setting, add a field and its default. A true-or-false setting needs nothing more; a choice or a number
// gets a line in CHOICES or NUMBERS; other kinds get a check in readSettings().

import { isBackground } from "../core/validate";
import { DEFAULT_MEDIA_SOURCES, normalizeHost, type MediaSource } from "../core/media";
import { MEDIA_KINDS, VIEW_STYLES } from "../core/types";
import type { ItemKind } from "../core/byKind";

export type Settings = {
  /** The weight of the UI font (CSS font-weight, 300 light to 700 bold). Text in cards and pages keeps its own. */
  uiFontWeight: number;
  /** Light or dark mode: "system" follows the computer. See src/ui/app/theme.tsx. */
  theme: ThemeSetting;
  /** The language of the UI ("en", "zh"). An unknown language shows English. See src/ui/i18n. */
  uiLanguage: string;
  /** Show the item name above its text, in editor windows and on the text page. */
  showItemTitle: boolean;
  /** Show created, modified, opened, and the user date under the item title. */
  showItemDates: boolean;
  /** Read-aloud speed: 1 is normal. */
  speechRate: number;
  /** Read aloud: formulas are said slower than the reading by this much (0 to 1; speed units). */
  speechFormulaSlower: number;
  /** Read-aloud volume: 0 to 1. */
  speechVolume: number;
  /** Read-aloud view: highlight the sentence in the text, or also show it as a large subtitle. */
  speechMode: SpeechMode;
  /** The subtitle floats above all apps in its own window (true), or shows in the app window (false). */
  subtitleFloating: boolean;
  /** The subtitle also shows the translation of the sentence (or the original, when the translation is read). */
  subtitleBoth: boolean;
  /** Web pages and PDFs show with inverted colors (light text on a dark page). Separate from the app theme. */
  readerInvert: boolean;
  /** Inverted colors also invert the pictures of a web page (off: pictures keep their colors). PDF pictures always invert. */
  readerInvertImages: boolean;
  /** Formula notes: the words of each formula, in the left margin of a page, a saved web page, or a PDF (view only). */
  formulaNotes: boolean;
  /** Built-in plugin "Buzzies mode" (SPEC 7.13): its entry shows in the More menu. On by default. */
  buzzies: boolean;
  /** Buzzies mode: how it hides the text. "glyphs": symbols and blocks; "blur": an even blur. */
  buzzStyle: "glyphs" | "blur";
  /** Read-aloud lock: a click on the text does not move the reading. */
  speechLock: boolean;
  /** Read aloud shows a cursor at the end of the audio that is ready ahead (the "ready" cursor). */
  speechShowReady: boolean;
  /** The width of the translation column at the right of a web page or PDF (page units). The user drags its edge. */
  translationWidth: number;
  /**
   * How far read-aloud makes audio ahead: "window" (up to 100 sentences ahead), "end" (to the end of the text, while it plays),
   * or "all" (all the audio first, then it plays).
   */
  speechAhead: "window" | "end" | "all";
  /** Parts of the text that read-aloud does not say. */
  speechSkip: SpeechSkip;
  /** Parts of the text that a translation keeps as they are ("Do not translate"): the same choices as speechSkip. */
  translateSkip: SpeechSkip;
  /** Not used now (Ctrl, ⌘, and Option all change the speed). Kept so that old settings files stay valid. */
  speechSpeedKey: "ctrl" | "alt";
  /**
   * How read-aloud reads a text: "markdown" (without Markdown marks), "paper" (also without the reference list),
   * or "auto" (paper if the text has a reference list, Markdown if it looks like Markdown, else as it is).
   */
  speechMarkdown: SpeechMarkdown;
  /** A plugin result (for example a translation): in place of the text, or in a panel at the right of the text. */
  transformLayout: TransformLayout;
  /** Side-by-side layout: the part of the width for the text (left). The panel gets the remainder. */
  transformSplit: number;
  /** Background of boards that have none of their own: a color or an image path. Null: the theme color. */
  defaultBackground: string | null;
  /** The default background image (on all boards without their own): it stays still (true), or it lies on the board and moves and zooms with the cards (false). */
  defaultBackgroundFixed: boolean;
  /** The signature on new comments. Only a name: it is not an account. */
  userName: string;
  /** Zen mode: the IDs of the buttons that show (see src/ui/app/zen.ts). Unknown IDs are ignored. */
  zenButtons: string[];
  /** The buttons of the "More" menu (⋯) that show in the top bar always (see FOLDED_BUTTONS in src/ui/app/zen.ts). */
  topBarButtons: string[];
  /** The ink of new board scribbles ("#rrggbb"), or null for the theme ink (black or white). */
  scribbleColor: string | null;
  /** 3D view: true hides the labels of the dots (a label shows only for the dot under the pointer). */
  galaxyHideLabels: boolean;
  /** Built-in plugin "Sorting tray" (SPEC 7.16): sorting maps show their tray, and cards get the tray entries. On by default. */
  tray: boolean;
  /** Sorting tray: how many items each "Pull" takes out of the tray. */
  trayCount: number;
  /** Processing maps (SPEC 7.16): when a card becomes a copy. "edit": at the first change; "all": all at detach; "new": new pulls only. */
  detachCopies: DetachCopies;
  /** The width of the text on a text page (px). The user drags an edge of the text, or types it in Settings. */
  pageWidth: number;
  /** The width of the comment column at the side of a text page (px). The user drags its edge. */
  commentWidth: number;
  /** "Back up" warns when one backup is larger than this (megabytes). */
  backupAlertMB: number;
  /** The option values of each plugin, for example {"translate": {"target": "zh"}}. */
  pluginOptions: Record<string, Record<string, string>>;
  /** Media sources (SPEC 7.14): the sites whose links become media items when pasted on a board. The user edits the list. */
  mediaSources: MediaSource[];
  /** "Items by type" (top bar): the type it lists, a card kind or "media". It stays until the user picks another. */
  listKind: ListKind;
};

/** The types of "Items by type": the card kinds, and media items. */
export type ListKind = ItemKind;
export const LIST_KINDS: readonly ListKind[] = [...VIEW_STYLES, "media"];
export type DetachCopies = "edit" | "all" | "new";
export type SpeechMode = "highlight" | "subtitle";
export type ThemeSetting = "system" | "dark" | "light";
export type TransformLayout = "replace" | "side";
export type SpeechMarkdown = "auto" | "markdown" | "paper";
export const SPEECH_RATE_RANGE = { min: 0.5, max: 3 } as const;
/** The width of the comment column (px). */
export const COMMENT_WIDTH_RANGE = { min: 160, max: 640 };
/** The width of the text on a text page (px). */
export const PAGE_WIDTH_RANGE = { min: 360, max: 2400 };
/** Sorting tray: the items that one "Pull" takes. */
export const TRAY_COUNT_RANGE = { min: 1, max: 50 };
/** The weight of the UI font. */
export const UI_FONT_WEIGHT_RANGE = { min: 300, max: 700 };
/** The width of the translation column of a web page or PDF (page units). */
export const TRANSLATION_WIDTH_RANGE = { min: 240, max: 1600 };
export const TRANSFORM_SPLIT_RANGE = { min: 0.2, max: 0.8 } as const;

/** Each field: true skips that part. See src/ui/plugins/reading.ts. */
export type SpeechSkip = {
  /** Text in round brackets: "(like this)". */
  parentheses: boolean;
  /** Text in square brackets: "[like this]". */
  brackets: boolean;
  /** Author–date citations (APA, Harvard, Chicago): "(Smith, 2020)", "(Lee & Park, 2019, p. 4)", "Smith (2020)". */
  authorDate: boolean;
  /** Author–page citations (MLA): "(Smith 23)", "(Lee and Park 4–6)". */
  authorPage: boolean;
  /** Numbered citations (IEEE, Vancouver): "[1]", "[2, 5–7]", "(3)", "text.12". */
  numbered: boolean;
  /** The whole reference list (after a heading such as "References" or "Bibliography"). */
  referenceList: boolean;
  /** In the reference list: the authors. */
  referenceAuthors: boolean;
  /** In the reference list: the year or date. */
  referenceDates: boolean;
  /** In the reference list: page numbers ("pp. 45–67"). */
  referencePages: boolean;
  /** In the reference list: links and DOIs. */
  referenceLinks: boolean;
};

export const NO_SKIP: SpeechSkip = {
  parentheses: false,
  brackets: false,
  authorDate: false,
  authorPage: false,
  numbered: false,
  referenceList: false,
  referenceAuthors: false,
  referenceDates: false,
  referencePages: false,
  referenceLinks: false,
};

export const DEFAULT_SETTINGS: Settings = {
  uiLanguage: "en",
  theme: "dark",
  uiFontWeight: 400,
  showItemTitle: true,
  showItemDates: false,
  speechRate: 1,
  speechFormulaSlower: 0.5,
  speechVolume: 1,
  speechMode: "highlight",
  subtitleFloating: true,
  subtitleBoth: false,
  readerInvert: false,
  readerInvertImages: false,
  formulaNotes: false,
  buzzies: true,
  buzzStyle: "glyphs",
  speechLock: false,
  speechShowReady: false,
  speechAhead: "window",
  translationWidth: 660,
  speechSkip: NO_SKIP,
  translateSkip: NO_SKIP,
  speechMarkdown: "auto",
  speechSpeedKey: "ctrl",
  transformLayout: "replace",
  transformSplit: 0.5,
  defaultBackground: null,
  defaultBackgroundFixed: false,
  userName: "",
  backupAlertMB: 1024,
  zenButtons: ["back", "undo", "redo", "select", "scribble", "eraser", "text"],
  topBarButtons: [],
  scribbleColor: null,
  galaxyHideLabels: false,
  tray: true,
  trayCount: 5,
  detachCopies: "edit",
  commentWidth: 250,
  pageWidth: 760,
  pluginOptions: {},
  mediaSources: DEFAULT_MEDIA_SOURCES.map((source) => ({ ...source })),
  listKind: "todo",
};
export const BACKUP_ALERT_RANGE = { min: 1, max: 10_000_000 } as const;

/** Settings with a few allowed values. (A true-or-false setting needs no entry: its default tells its type.) */
const CHOICES: { [K in keyof Settings]?: readonly Settings[K][] } = {
  theme: ["system", "dark", "light"],
  speechMode: ["highlight", "subtitle"],
  speechAhead: ["window", "end", "all"],
  speechMarkdown: ["auto", "markdown", "paper"],
  speechSpeedKey: ["ctrl", "alt"],
  transformLayout: ["replace", "side"],
  listKind: LIST_KINDS,
  detachCopies: ["edit", "all", "new"],
  buzzStyle: ["glyphs", "blur"],
};

/** Number settings: the allowed range, and `round` for whole numbers. */
const NUMBERS: { [K in keyof Settings]?: { min: number; max: number; round?: boolean } } = {
  uiFontWeight: { ...UI_FONT_WEIGHT_RANGE, round: true },
  speechRate: SPEECH_RATE_RANGE,
  speechFormulaSlower: { min: 0, max: 1 },
  speechVolume: { min: 0, max: 1 },
  translationWidth: TRANSLATION_WIDTH_RANGE,
  transformSplit: TRANSFORM_SPLIT_RANGE,
  backupAlertMB: BACKUP_ALERT_RANGE,
  commentWidth: COMMENT_WIDTH_RANGE,
  pageWidth: { ...PAGE_WIDTH_RANGE, round: true },
};

/** Reads the settings file. A missing or bad value gives the default. Unknown fields are ignored. */
export function readSettings(text: string | undefined): Settings {
  const settings: Settings = { ...DEFAULT_SETTINGS };
  if (text === undefined) return settings;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return settings;
  }
  if (typeof value !== "object" || value === null) return settings;
  const record = value as Record<string, unknown>;
  const out = settings as Record<string, unknown>;
  // A setting whose default is true or false: any true or false.
  for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
    if (typeof fallback === "boolean" && typeof record[key] === "boolean") out[key] = record[key];
  }
  for (const [key, choices] of Object.entries(CHOICES)) {
    if ((choices as readonly unknown[]).includes(record[key])) out[key] = record[key];
  }
  for (const [key, range] of Object.entries(NUMBERS)) {
    const number = record[key];
    if (isNumberIn(number, range.min, range.max)) out[key] = range.round === true ? Math.round(number) : number;
  }
  if (typeof record.uiLanguage === "string" && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(record.uiLanguage)) settings.uiLanguage = record.uiLanguage;
  settings.speechSkip = readSkip(record.speechSkip);
  settings.translateSkip = readSkip(record.translateSkip);
  // Values of version 0.1: "always" was Markdown. "never" (all characters) has no mode now: auto.
  if (record.speechMarkdown === "always") settings.speechMarkdown = "markdown";
  if (typeof record.userName === "string") settings.userName = record.userName.slice(0, 80);
  if (Array.isArray(record.zenButtons)) settings.zenButtons = [...new Set(record.zenButtons.filter((id): id is string => typeof id === "string"))];
  if (typeof record.scribbleColor === "string" && /^#[0-9a-f]{6}$/i.test(record.scribbleColor)) settings.scribbleColor = record.scribbleColor;
  if (typeof record.tray === "boolean") settings.tray = record.tray;
  if (typeof record.trayCount === "number" && Number.isFinite(record.trayCount)) settings.trayCount = Math.min(TRAY_COUNT_RANGE.max, Math.max(TRAY_COUNT_RANGE.min, Math.round(record.trayCount)));
  if (typeof record.galaxyHideLabels === "boolean") settings.galaxyHideLabels = record.galaxyHideLabels;
  if (Array.isArray(record.topBarButtons)) settings.topBarButtons = [...new Set(record.topBarButtons.filter((id): id is string => typeof id === "string"))];
  settings.pluginOptions = readPluginOptions(record.pluginOptions);
  if (Array.isArray(record.mediaSources)) settings.mediaSources = readMediaSources(record.mediaSources);
  if (isBackground(record.defaultBackground)) settings.defaultBackground = record.defaultBackground;
  return settings;
}

function isNumberIn(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

/** Known fields with a boolean value. Others give the default. */
function readSkip(value: unknown): SpeechSkip {
  const skip = { ...NO_SKIP };
  if (typeof value !== "object" || value === null || Array.isArray(value)) return skip;
  for (const key of Object.keys(NO_SKIP) as (keyof SpeechSkip)[]) {
    const field = (value as Record<string, unknown>)[key];
    if (typeof field === "boolean") skip[key] = field;
  }
  return skip;
}

/** Keeps only string values: {plugin: {key: value}}. */
function readPluginOptions(value: unknown): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) return result;
  for (const [plugin, options] of Object.entries(value)) {
    if (typeof options !== "object" || options === null || Array.isArray(options)) continue;
    const strings = Object.entries(options).filter((entry): entry is [string, string] => typeof entry[1] === "string");
    if (strings.length > 0) result[plugin] = Object.fromEntries(strings);
  }
  return result;
}

export function encodeSettings(settings: Settings): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}

/** The media sources of the settings file. Bad entries are left out; the same host counts one time. */
function readMediaSources(list: unknown[]): MediaSource[] {
  const out: MediaSource[] = [];
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const host = typeof record.host === "string" ? normalizeHost(record.host) : null;
    if (host === null || !MEDIA_KINDS.includes(record.kind as never) || out.some((source) => source.host === host)) continue;
    out.push({ host, kind: record.kind as MediaSource["kind"], on: record.on !== false });
  }
  return out;
}
