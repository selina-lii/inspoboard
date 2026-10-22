// Vault file format. See docs/SPEC.md section 3.
// These functions convert between files (path -> text) and records. They do no I/O.
//
// Integrity rules:
// - Body text is kept byte for byte. No trim, no line-ending change.
// - Unknown fields in a record are kept and written back.
// - A line that the app cannot read is an error. The vault then opens read-only,
//   so that a save cannot remove the bad line.

import { isId } from "./ids";
import type { Problem } from "./problems";
import { Store } from "./store";
import { schemaErrors } from "./validate";
import type { AnyRecord, Id, TableName } from "./types";

/**
 * The vault format. The app reads this version only (MIN_FORMAT to FORMAT_VERSION).
 * - 1: the first format.
 * - 2: small items inside pages and saved web pages are `inside` links; each link object has its own web copy
 *   (SPEC 1.1). scripts/migrations/inside-links.mjs changes a vault from 1 to 2.
 * A vault of an older format has an error: it opens read-only (the app writes nothing) until the user runs the
 * migration script. Only the migration reads the older format (`oldFormat`).
 */
export const FORMAT_VERSION = 2;
export const MIN_FORMAT = 2;

export const VAULT_FILE = "vault.json";
export const APP_FOLDER = ".inspoboard";
export const ITEMS_FOLDER = "items";
export const TEXT_EXTENSION = ".md";
/** App state, not core data: the time each item was last opened. It is not in history snapshots. */
export const OPENED_FILE = ".inspoboard/opened.json";
/** App state, not core data: the settings of this vault. It is not in history snapshots. */
export const SETTINGS_FILE = ".inspoboard/settings.json";
/** Files that are app state. They are not core data. */
export const APP_STATE_FILES: readonly string[] = [OPENED_FILE, SETTINGS_FILE];

/** Tables saved as JSON Lines. The "texts" table is saved as one Markdown file per item. */
export type LineTable = Exclude<TableName, "texts">;

export const LINE_TABLES: readonly LineTable[] = ["items", "links", "stamps", "outlines"];

/** Tables that a vault can be without. A missing file is an empty table. */
const OPTIONAL_TABLES: readonly LineTable[] = ["outlines"];

export const TABLE_FILES: Record<LineTable, string> = {
  items: "table/items.jsonl",
  links: "table/links.jsonl",
  stamps: "table/stamps.jsonl",
  outlines: "table/outlines.jsonl",
};

/** Field order in saved lines. Known fields come first. Other fields follow in alphabetical order. */
const FIELD_ORDER: Record<LineTable, readonly string[]> = {
  items: ["id", "name", "subtitle", "codeName", "created", "modified", "date", "board", "list", "background", "backgroundWidth", "backgroundCenter", "backgroundFixed", "backgroundOnBoard", "url", "author", "on", "quote", "resolved", "pageAt", "trashed", "trashedFrom", "media", "sources", "discarded", "lostAndFound", "detached", "madeFrom"],
  links: ["id", "kind", "from", "to", "view", "x", "y", "w", "h", "expanded", "color", "ref", "outline", "parent", "rank", "day", "until", "time", "offset", "p3", "stubs", "label", "group", "start", "end", "quote", "at", "fromQuote", "onBoard", "dashed", "marks", "shape", "shapePath", "filled"],
  stamps: ["id", "alt", "w", "h", "path"],
  outlines: ["id", "type", "name", "board", "x", "y", "list", "direction", "start", "end", "radius", "seed"],
};

export type VaultMeta = {
  format: number;
  root: Id;
};

/** Vault-relative path -> file text. */
export type VaultFiles = Map<string, string>;

export function textPath(id: Id): string {
  return `${ITEMS_FOLDER}/${id}${TEXT_EXTENSION}`;
}

/** Returns the item ID for a text file path, or null if the path is not a text file. */
export function idFromTextPath(path: string): Id | null {
  const prefix = `${ITEMS_FOLDER}/`;
  if (!path.startsWith(prefix) || !path.endsWith(TEXT_EXTENSION)) return null;
  const id = path.slice(prefix.length, -TEXT_EXTENSION.length);
  return isId(id) ? id : null;
}

export function encodeMeta(meta: VaultMeta): string {
  return `${JSON.stringify({ format: meta.format, root: meta.root }, null, 2)}\n`;
}

export function encodeRecordLine(table: LineTable, record: AnyRecord): string {
  const source = record as Record<string, unknown>;
  const known = FIELD_ORDER[table];
  const ordered: Record<string, unknown> = {};
  for (const field of known) {
    if (source[field] !== undefined) ordered[field] = source[field];
  }
  for (const field of Object.keys(source).sort()) {
    if (!known.includes(field) && source[field] !== undefined) ordered[field] = source[field];
  }
  return JSON.stringify(ordered);
}

/** One line for each record, sorted by ID. The file ends with a newline. */
export function encodeTable(store: Store, table: LineTable): string {
  const records = [...store.all(table)].sort((a, b) => compareIds(a.id, b.id));
  return records.map((record) => `${encodeRecordLine(table, record)}\n`).join("");
}

/** All files of the vault. The persistence layer writes only the files that changed. */
export function encodeVault(store: Store, meta: VaultMeta): VaultFiles {
  const files: VaultFiles = new Map();
  files.set(VAULT_FILE, encodeMeta(meta));
  for (const table of LINE_TABLES) {
    // Tables that came later (outlines) get a file only when they have records. Old vaults stay as they are.
    if (OPTIONAL_TABLES.includes(table) && store.count(table) === 0) continue;
    files.set(TABLE_FILES[table], encodeTable(store, table));
  }
  for (const text of store.all("texts")) files.set(textPath(text.id), text.body);
  return files;
}

export type DecodedVault = {
  store: Store;
  meta: VaultMeta | null;
  problems: Problem[];
};

/** Reads vault files into a new store. Never throws for bad data. Reports problems. */
export function decodeVault(files: ReadonlyMap<string, string>, options: { oldFormat?: boolean } = {}): DecodedVault {
  const problems: Problem[] = [];
  const store = new Store();
  const meta = decodeMeta(files.get(VAULT_FILE), problems, options.oldFormat === true);

  for (const table of LINE_TABLES) {
    const path = TABLE_FILES[table];
    const text = files.get(path);
    if (text === undefined) continue;
    const records = decodeTable(table, path, text, problems);
    store.write(records.map((record) => ({ table, id: record.id, after: record })));
  }

  const texts: { table: "texts"; id: Id; after: AnyRecord }[] = [];
  for (const [path, body] of files) {
    if (!path.startsWith(`${ITEMS_FOLDER}/`)) continue;
    const id = idFromTextPath(path);
    if (id === null) {
      problems.push({ severity: "warning", code: "unknown-file", message: "The app ignores this file.", path });
      continue;
    }
    texts.push({ table: "texts", id, after: { id, body } });
  }
  store.write(texts);
  return { store, meta, problems };
}

function decodeMeta(text: string | undefined, problems: Problem[], oldFormat: boolean): VaultMeta | null {
  if (text === undefined) {
    problems.push({ severity: "error", code: "meta-missing", message: "The vault has no vault.json file.", path: VAULT_FILE });
    return null;
  }
  const value = parseJson(text);
  const record = value as Partial<VaultMeta> | undefined;
  if (record === undefined || typeof record !== "object" || !isId(record.root) || typeof record.format !== "number") {
    problems.push({ severity: "error", code: "meta-invalid", message: "vault.json must have a format number and a root ID.", path: VAULT_FILE });
    return null;
  }
  if (record.format > FORMAT_VERSION) {
    problems.push({
      severity: "error",
      code: "format-too-new",
      message: `The vault uses format ${record.format}. This app reads format ${FORMAT_VERSION} or lower.`,
      path: VAULT_FILE,
    });
  }
  if (record.format < MIN_FORMAT && !oldFormat) {
    problems.push({
      severity: "error",
      code: "format-too-old",
      message: `The vault uses format ${record.format}. This app reads format ${MIN_FORMAT}. Run the migration script once (scripts/migrations/inside-links.mjs, with --apply), then open the vault again. Until then the app does not change the vault.`,
      path: VAULT_FILE,
    });
  }
  return { format: record.format, root: record.root };
}

function decodeTable(table: LineTable, path: string, text: string, problems: Problem[]): AnyRecord[] {
  const records: AnyRecord[] = [];
  const seen = new Set<Id>();
  const lines = text.split("\n");
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line === "") return;
    const at = { path, line: index + 1 };
    const value = parseJson(line);
    if (value === undefined) {
      problems.push({ severity: "error", code: "bad-json", message: "The line is not valid JSON.", ...at });
      return;
    }
    const errors = schemaErrors(table, value);
    if (errors.length > 0) {
      problems.push({ severity: "error", code: "bad-record", message: errors.join(" "), ...at });
      return;
    }
    const record = value as AnyRecord;
    if (seen.has(record.id)) {
      problems.push({ severity: "error", code: "duplicate-id", message: `ID "${record.id}" occurs two times.`, recordId: record.id, ...at });
      return;
    }
    seen.add(record.id);
    records.push(record);
  });
  return records;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // The caller reports the problem. `undefined` is never a valid parse result.
    return undefined;
  }
}

function compareIds(a: Id, b: Id): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
