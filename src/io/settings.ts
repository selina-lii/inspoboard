// Vault settings. App state, not core data: they are in .inspoboard/settings.json.
// To add a setting, add a field, its default, and its check in readSettings().

import { isBackground } from "../core/validate";

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
  /** Read-aloud volume: 0 to 1. */
  speechVolume: number;
  /** Read-aloud view: highlight the sentence in the text, or also show it as a large subtitle. */
  speechMode: SpeechMode;
  /** The subtitle floats above all apps in its own window (true), or shows in the app window (false). */
  subtitleFloating: boolean;
  /** The subtitle also shows the translation of the sentence (or the original, when the translation is read). */
  subtitleBoth: boolean;
  /** The width of the translation column at the right of a web page or PDF (page units). The user drags its edge. */
  translationWidth: number;
  /**
   * How far read-aloud makes audio ahead: "window" (about one minute), "end" (to the end of the text, while it plays),
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
  /** The width of the text on a text page (px). The user drags an edge of the text, or types it in Settings. */
  pageWidth: number;
  /** The width of the comment column at the side of a text page (px). The user drags its edge. */
  commentWidth: number;
  /** "Back up" warns when one backup is larger than this (megabytes). */
  backupAlertMB: number;
  /** The option values of each plugin, for example {"translate": {"target": "zh"}}. */
  pluginOptions: Record<string, Record<string, string>>;
};

export type SpeechMode = "highlight" | "subtitle";
export type ThemeSetting = "system" | "dark" | "light";
export type TransformLayout = "replace" | "side";
export type SpeechMarkdown = "auto" | "markdown" | "paper";
export const SPEECH_RATE_RANGE = { min: 0.5, max: 3 } as const;
/** The width of the comment column (px). */
export const COMMENT_WIDTH_RANGE = { min: 160, max: 640 };
/** The width of the text on a text page (px). */
export const PAGE_WIDTH_RANGE = { min: 360, max: 2400 };
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
  speechVolume: 1,
  speechMode: "highlight",
  subtitleFloating: true,
  subtitleBoth: false,
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
  commentWidth: 250,
  pageWidth: 760,
  pluginOptions: {},
};
export const BACKUP_ALERT_RANGE = { min: 1, max: 10_000_000 } as const;

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
  if (isNumberIn(record.uiFontWeight, UI_FONT_WEIGHT_RANGE.min, UI_FONT_WEIGHT_RANGE.max)) settings.uiFontWeight = Math.round(record.uiFontWeight);
  if (record.theme === "system" || record.theme === "dark" || record.theme === "light") settings.theme = record.theme;
  if (typeof record.uiLanguage === "string" && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(record.uiLanguage)) settings.uiLanguage = record.uiLanguage;
  if (typeof record.showItemTitle === "boolean") settings.showItemTitle = record.showItemTitle;
  if (typeof record.showItemDates === "boolean") settings.showItemDates = record.showItemDates;
  if (isNumberIn(record.speechRate, SPEECH_RATE_RANGE.min, SPEECH_RATE_RANGE.max)) settings.speechRate = record.speechRate;
  if (isNumberIn(record.speechVolume, 0, 1)) settings.speechVolume = record.speechVolume;
  if (record.speechMode === "highlight" || record.speechMode === "subtitle") settings.speechMode = record.speechMode;
  if (typeof record.subtitleFloating === "boolean") settings.subtitleFloating = record.subtitleFloating;
  if (record.speechAhead === "window" || record.speechAhead === "end" || record.speechAhead === "all") settings.speechAhead = record.speechAhead;
  if (typeof record.subtitleBoth === "boolean") settings.subtitleBoth = record.subtitleBoth;
  if (isNumberIn(record.translationWidth, TRANSLATION_WIDTH_RANGE.min, TRANSLATION_WIDTH_RANGE.max)) settings.translationWidth = record.translationWidth;
  settings.speechSkip = readSkip(record.speechSkip);
  settings.translateSkip = readSkip(record.translateSkip);
  if (record.speechMarkdown === "auto" || record.speechMarkdown === "markdown" || record.speechMarkdown === "paper") settings.speechMarkdown = record.speechMarkdown;
  // Values of version 0.1: "always" was Markdown. "never" (all characters) has no mode now: auto.
  if (record.speechMarkdown === "always") settings.speechMarkdown = "markdown";
  if (record.speechSpeedKey === "ctrl" || record.speechSpeedKey === "alt") settings.speechSpeedKey = record.speechSpeedKey;
  if (typeof record.userName === "string") settings.userName = record.userName.slice(0, 80);
  if (record.transformLayout === "replace" || record.transformLayout === "side") settings.transformLayout = record.transformLayout;
  if (isNumberIn(record.transformSplit, TRANSFORM_SPLIT_RANGE.min, TRANSFORM_SPLIT_RANGE.max)) settings.transformSplit = record.transformSplit;
  if (isNumberIn(record.backupAlertMB, BACKUP_ALERT_RANGE.min, BACKUP_ALERT_RANGE.max)) settings.backupAlertMB = record.backupAlertMB;
  if (isNumberIn(record.commentWidth, COMMENT_WIDTH_RANGE.min, COMMENT_WIDTH_RANGE.max)) settings.commentWidth = record.commentWidth;
  if (isNumberIn(record.pageWidth, PAGE_WIDTH_RANGE.min, PAGE_WIDTH_RANGE.max)) settings.pageWidth = Math.round(record.pageWidth);
  if (Array.isArray(record.zenButtons)) settings.zenButtons = [...new Set(record.zenButtons.filter((id): id is string => typeof id === "string"))];
  settings.pluginOptions = readPluginOptions(record.pluginOptions);
  if (typeof record.defaultBackgroundFixed === "boolean") settings.defaultBackgroundFixed = record.defaultBackgroundFixed;
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
