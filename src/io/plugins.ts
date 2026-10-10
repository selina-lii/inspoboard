// Plugin protocol, frontend part. See docs/PLUGINS.md.
// Plugin output is not trusted: each reader checks the shape and drops bad parts.

import type { PluginHost } from "./backend";

export type PluginChoice = { value: string; label: string };

/**
 * An option that the core shows for a plugin:
 * - "choice": a select box, for example "To: Chinese".
 * - "text": a text field, for example "Pitch: +2 Hz". `pattern` (a regular expression) checks the value. `unit` shows after it.
 */
export type PluginOption =
  | { kind: "choice"; key: string; label: string; choices: PluginChoice[]; default: string }
  | { kind: "text"; key: string; label: string; default: string; placeholder: string; pattern: string | null; unit: string };

/** A button that the core shows in Settings, for example "Download Chinese ↔ English". */
export type PluginAction = { id: string; label: string; detail: string; enabled: boolean };

/** The reply to "info". */
export type PluginDetails = {
  title: string;
  description: string;
  /** A name from PLUGIN_ICONS. Unknown names give the default icon. */
  icon: string;
  options: PluginOption[];
  actions: PluginAction[];
};

/** `partial`: a transform plugin sends the text so far for one input text (its index in the call). */
export type PluginProgress = { done: number; total: number; label: string; partial: { index: number; text: string } | null };

const MAX_LIST = 500;

export function readDetails(value: unknown, fallbackTitle: string): PluginDetails {
  const record = asRecord(value);
  const options = asArray(record.options).flatMap((entry): PluginOption[] => {
    const option = asRecord(entry);
    if (option.kind === "text") {
      if (typeof option.key !== "string") return [];
      const pattern = typeof option.pattern === "string" && compiles(option.pattern) ? option.pattern : null;
      return [{ kind: "text", key: option.key, label: asString(option.label, option.key), default: asString(option.default, ""), placeholder: asString(option.placeholder, ""), pattern, unit: asString(option.unit, "") }];
    }
    const choices = asArray(option.choices).flatMap((choice): PluginChoice[] => {
      const fields = asRecord(choice);
      return typeof fields.value === "string" ? [{ value: fields.value, label: asString(fields.label, fields.value) }] : [];
    });
    if (typeof option.key !== "string" || choices.length === 0) return [];
    const fallback = choices[0]!.value;
    const preferred = asString(option.default, fallback);
    return [{ kind: "choice", key: option.key, label: asString(option.label, option.key), choices, default: choices.some((choice) => choice.value === preferred) ? preferred : fallback }];
  });
  const actions = asArray(record.actions).flatMap((entry): PluginAction[] => {
    const action = asRecord(entry);
    if (typeof action.id !== "string") return [];
    return [{ id: action.id, label: asString(action.label, action.id), detail: asString(action.detail, ""), enabled: action.enabled !== false }];
  });
  return {
    title: asString(record.title, fallbackTitle),
    description: asString(record.description, ""),
    icon: asString(record.icon, ""),
    options,
    actions,
  };
}

/** The texts of a "transform" reply. It must have one string for each input text. */
export function readTexts(value: unknown, count: number): string[] {
  const texts = asRecord(value).texts;
  if (!Array.isArray(texts) || texts.length !== count || !texts.every((text) => typeof text === "string")) {
    throw new Error(`The plugin gave a bad reply: it must give ${count} texts.`);
  }
  return texts as string[];
}

export function readProgress(value: unknown): PluginProgress | null {
  const record = asRecord(value);
  if (typeof record.done !== "number" || typeof record.total !== "number") return null;
  const partial = asRecord(record.partial);
  const validPartial = typeof partial.index === "number" && Number.isInteger(partial.index) && typeof partial.text === "string";
  return {
    done: record.done,
    total: record.total,
    label: asString(record.label, ""),
    partial: validPartial ? { index: partial.index as number, text: partial.text as string } : null,
  };
}

/** A sentence to read aloud. `start` and `end` are string indexes (UTF-16) in the text. `speech` is the text to say. */
export type Sentence = { start: number; end: number; speech: string };

/** The sentences of a "sentences" reply. Bad or overlapping ranges are dropped. */
export function readSentences(value: unknown, textLength: number): Sentence[] {
  const sentences: Sentence[] = [];
  let last = 0;
  for (const entry of asArrayUnlimited(asRecord(value).sentences)) {
    const fields = asRecord(entry);
    const { start, end, speech } = fields;
    if (typeof start !== "number" || typeof end !== "number" || typeof speech !== "string") continue;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < last || end <= start || end > textLength || speech.trim() === "") continue;
    sentences.push({ start, end, speech });
    last = end;
  }
  return sentences;
}

/** Audio of one "speak" reply. */
export type Clip = { audio: string; mime: string };

export function readClip(value: unknown): Clip {
  const record = asRecord(value);
  if (typeof record.audio !== "string" || record.audio === "" || typeof record.mime !== "string" || !record.mime.startsWith("audio/")) {
    throw new Error("The plugin gave a bad reply: it must give audio.");
  }
  return { audio: record.audio, mime: record.mime };
}

/** True if a value is valid for an option: one of the choices, or text that matches the pattern. */
export function isValidOption(option: PluginOption, value: string | undefined): value is string {
  if (value === undefined) return false;
  if (option.kind === "choice") return option.choices.some((choice) => choice.value === value);
  return option.pattern === null || new RegExp(option.pattern, "iu").test(value);
}

function compiles(pattern: string): boolean {
  try {
    new RegExp(pattern, "iu");
    return true;
  } catch {
    return false;
  }
}

/** Starting values for the options of a plugin. */
export function defaultOptions(details: PluginDetails): Record<string, string> {
  return Object.fromEntries(details.options.map((option) => [option.key, option.default]));
}

export async function transformTexts(host: PluginHost, plugin: string, texts: string[], options: Record<string, string>): Promise<string[]> {
  if (texts.length === 0) return [];
  const reply = await host.call(plugin, "transform", { texts, options });
  return readTexts(reply, texts.length);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value.slice(0, MAX_LIST) : [];
}

function asArrayUnlimited(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}
