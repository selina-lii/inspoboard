// One-time migration (SPEC 1.1, "Design rule: sizes"): small items inside pages and saved web pages become vault items
// with inside links, and each link object gets its own copy of its saved page. scripts/migrations/inside-links.mjs
// runs it. The vault format becomes 2 (vault.json).
//
// It only makes a plan: the new table and text files, the web files to copy or write, and a report. It changes nothing.
// The runner shows the plan, makes a backup of the vault, and then writes it.
//
// Steps:
// 1. Comments and notes of a page in the older form (`on` = the page, `pageAt`, `quote`, a card next to the page)
//    become inside links (core/inside.ts, upgradeEntry). The card goes; the item, its text, and its replies stay.
// 2. Saved web pages and PDFs: one shared copy for each address (web/<hash>.html or .pdf) becomes one copy for each
//    link object (web/<link object ID>.*). A link object that has its own copy keeps it.
// 3. Notes of a page (web/<hash>.notes.json): they go to the oldest link object of the address (web/<ID>.notes.json),
//    unless it has its own notes file already. The comments and notes in a notes file (`items`) become vault items
//    inside the link object. All other fields of the notes file stay as they are. An entry that is not a valid
//    comment or note stays in the file.
// 4. Nothing is deleted: the old shared files stay. A second run finds nothing to do.

import type { ActionContext } from "../actions";
import { makeOp, type Op } from "../commands";
import { decodeVault, encodeVault, type VaultFiles } from "../format";
import { GraphIndex } from "../graph";
import { newId as randomId } from "../ids";
import { insideEntryOf, isLegacyInside, upgradeEntry } from "../inside";
import type { Store } from "../store";
import type { Id, InsideLink, ItemRecord } from "../types";

/** The web folder of the vault (file names in web/, and their text). */
export type WebFolder = {
  names: readonly string[];
  readText(name: string): string | null;
};

export type WebStep = { op: "copy"; from: string; to: string } | { op: "write"; name: string; content: string };

export type MigrationPlan = {
  /** The vault files after the migration (vault.json, tables, texts). */
  files: VaultFiles;
  web: WebStep[];
  report: string[];
  counts: { pageItems: number; copies: number; notesFiles: number; webItems: number; problems: number };
  /** False if the vault has errors: the plan does nothing. */
  ok: boolean;
};

/** The paper colors of notes on a web page (readerShared.tsx PAPER): a note item gets the color of its paper. */
const PAPER: Record<string, string> = { yellow: "#fff3b0", green: "#d4f5dc", pink: "#ffd9e2", blue: "#d6e9ff" };

const isWebUrl = (text: string): boolean => {
  try {
    const url = new URL(text.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};
/** The same as savedPages.normalizeUrl: the address without its fragment. */
const normalizeUrl = (url: string): string => {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return trimmed;
  }
};
/** The same as savedPages.webKey: the key of the old shared copy of a web address. */
async function webKey(url: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizeUrl(url))));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

/**
 * Makes the plan. `localPdfKey`: the key of the old shared copy of a local PDF (the runner finds it by the content of
 * the file), or null. `now`: the time for items that have none.
 */
export async function planInsideMigration(vault: VaultFiles, web: WebFolder, localPdfKey: (path: string) => Promise<string | null>, now: string, newId: () => Id = randomId): Promise<MigrationPlan> {
  const report: string[] = [];
  const counts = { pageItems: 0, copies: 0, notesFiles: 0, webItems: 0, problems: 0 };
  const decoded = decodeVault(vault);
  const errors = decoded.problems.filter((problem) => problem.severity === "error");
  if (errors.length > 0 || decoded.meta === null) {
    report.push("The vault has errors. The migration does nothing. Fix the errors first (open the vault in the app to see them):");
    for (const problem of errors) report.push(`  - ${problem.path ?? ""}${problem.line !== undefined ? `:${problem.line}` : ""} ${problem.message}`);
    return { files: vault, web: [], report, counts: { ...counts, problems: errors.length }, ok: false };
  }
  const store = decoded.store;
  const graph = new GraphIndex(store);
  const context: ActionContext = { store, graph, newId, now: () => now };
  const apply = (ops: Op[]) => store.write(ops.map((op) => ({ table: op.table, id: op.id, after: op.after })) as never);

  // 1. Page comments and notes in the older form.
  for (const item of [...store.all("items")]) {
    if (!isLegacyInside(store, graph, item)) continue;
    const entry = insideEntryOf(store, graph, item.id);
    if (entry === null) continue;
    apply(upgradeEntry(context, entry).ops);
    counts.pageItems += 1;
  }
  if (counts.pageItems > 0) report.push(`Page comments and notes: ${counts.pageItems} change to inside links (their cards next to the page go; the items, texts, and replies stay).`);

  // 2 and 3. Saved web pages and PDFs, by address.
  const names = new Set(web.names);
  const steps: WebStep[] = [];
  const has = (name: string) => names.has(name) || steps.some((step) => (step.op === "copy" ? step.to : step.name) === name);
  const groups = new Map<string, ItemRecord[]>();
  for (const item of store.all("items")) {
    if (item.url === undefined || item.url.trim() === "") continue;
    const key = isWebUrl(item.url) ? await webKey(item.url) : await localPdfKey(item.url.trim());
    const list = groups.get(key ?? `own:${item.id}`) ?? [];
    list.push(item);
    groups.set(key ?? `own:${item.id}`, list);
  }
  const usedShared = new Set<string>();
  for (const [key, objects] of groups) {
    objects.sort((a, b) => (a.created !== b.created ? (a.created < b.created ? -1 : 1) : a.id < b.id ? -1 : 1));
    const shared = key.startsWith("own:") ? null : key;
    const sharedPage = shared === null ? null : names.has(`${shared}.html`) ? `${shared}.html` : names.has(`${shared}.pdf`) ? `${shared}.pdf` : null;
    if (sharedPage !== null) usedShared.add(sharedPage);
    for (const object of objects) {
      const own = has(`${object.id}.html`) || has(`${object.id}.pdf`);
      if (!own && sharedPage !== null) {
        const to = `${object.id}${sharedPage.slice(sharedPage.indexOf("."))}`;
        steps.push({ op: "copy", from: sharedPage, to });
        counts.copies += 1;
      }
    }
    if (objects.length > 1 && shared !== null && names.has(`${shared}.notes.json`)) {
      report.push(`Address ${objects[0]!.url}: ${objects.length} link objects. The old notes go to the oldest one ("${objects[0]!.name || objects[0]!.url}", ${objects[0]!.id}). Use the link bench to move small items to another one.`);
    }
    // The notes of each link object: its own file, else (the oldest) the old shared file.
    for (const [index, object] of objects.entries()) {
      const ownName = `${object.id}.notes.json`;
      const source = names.has(ownName) ? ownName : index === 0 && shared !== null && names.has(`${shared}.notes.json`) ? `${shared}.notes.json` : null;
      if (source === null) continue;
      if (source !== ownName) usedShared.add(source);
      const text = web.readText(source);
      if (text === null) continue;
      let raw: Record<string, unknown>;
      try {
        const value: unknown = JSON.parse(text);
        if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("not an object");
        raw = value as Record<string, unknown>;
      } catch {
        report.push(`Notes file web/${source} is not valid JSON. It stays as it is (nothing changes for ${object.id}).`);
        counts.problems += 1;
        continue;
      }
      const entries = Array.isArray(raw.items) ? raw.items : [];
      const kept: unknown[] = [];
      for (const entry of entries) {
        const made = marginItemOps(context, object.id, entry, now);
        if (made === null) {
          kept.push(entry);
          counts.problems += 1;
          continue;
        }
        apply(made);
        counts.webItems += 1;
      }
      if (kept.length > 0) report.push(`Notes file web/${source}: ${kept.length} entries are not valid comments or notes. They stay in the notes file of ${object.id}.`);
      // The notes file of the link object: all fields as they were; `items` only keeps the entries that did not move.
      if (source !== ownName || kept.length !== entries.length) {
        const next: Record<string, unknown> = { ...raw };
        if (Array.isArray(raw.items)) next.items = kept;
        steps.push({ op: "write", name: ownName, content: `${JSON.stringify(next)}\n` });
        counts.notesFiles += 1;
      }
    }
  }
  if (counts.copies > 0) report.push(`Saved pages and PDFs: ${counts.copies} copies for link objects (web/<link object ID>.*). The old shared files stay.`);
  if (counts.notesFiles > 0) report.push(`Notes files: ${counts.notesFiles} written for link objects (web/<link object ID>.notes.json).`);
  if (counts.webItems > 0) report.push(`Comments and notes on web pages and PDFs: ${counts.webItems} become vault items inside their link object.`);
  // Old shared files that no link object uses (for example a PDF from "Open a PDF file…" with no link object).
  const orphans = [...names].filter((name) => /^[0-9a-f]{24}\.(html|pdf|notes\.json)$/.test(name) && !usedShared.has(name) && !groupsHaveKey(groups, name.slice(0, 24)));
  if (orphans.length > 0) {
    report.push(`Old shared files with no link object: ${orphans.length}. They stay as they are (nothing is lost). Files:`);
    for (const name of orphans) report.push(`  - web/${name}`);
  }
  if (report.length === 0) report.push("Nothing to do: the vault has the new format already.");

  // The vault files, and a check: the new files must read again with no errors. The format becomes 2.
  const files = encodeVault(store, { ...decoded.meta, format: Math.max(decoded.meta.format, 2) });
  const check = decodeVault(files).problems.filter((problem) => problem.severity === "error");
  if (check.length > 0) {
    report.push("The new vault files have errors. The migration does nothing. Tell the developer:");
    for (const problem of check) report.push(`  - ${problem.path ?? ""}${problem.line !== undefined ? `:${problem.line}` : ""} ${problem.message}`);
    return { files: vault, web: [], report, counts: { ...counts, problems: counts.problems + check.length }, ok: false };
  }
  return { files, web: steps, report, counts, ok: true };
}

function groupsHaveKey(groups: Map<string, ItemRecord[]>, key: string): boolean {
  return groups.has(key);
}

/** A comment or note of a notes file as a vault item inside a link object, or null if the entry is not valid. */
function marginItemOps(context: ActionContext, homeId: Id, entry: unknown, now: string): Op[] | null {
  if (typeof entry !== "object" || entry === null) return null;
  const { kind, x, y, w, text, color, author, created } = entry as Record<string, unknown>;
  const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
  if ((kind !== "comment" && kind !== "note") || !finite(x) || !finite(y) || typeof text !== "string") return null;
  const itemId = context.newId();
  const linkId = context.newId();
  const item: ItemRecord = { id: itemId, name: "", created: typeof created === "string" && created !== "" ? created : now };
  if (kind === "comment" && typeof author === "string" && author.trim() !== "") item.author = author.trim();
  const link: InsideLink = { id: linkId, kind: "inside", from: homeId, to: itemId, view: kind, x: Math.round(x), y: Math.round(y) };
  if (finite(w) && w > 0) link.w = Math.round(w);
  if (kind === "note" && typeof color === "string" && PAPER[color] !== undefined) link.color = PAPER[color];
  return [makeOp("items", itemId, null, item), makeOp("texts", itemId, null, { id: itemId, body: text }), makeOp("links", linkId, null, link)];
}

/** For tests: the store of a plan. */
export function storeOf(files: VaultFiles): Store {
  return decodeVault(files).store;
}
