// The copy of a document (SPEC 1.1): a saved web page or PDF belongs to one link object (its "home").
// - Files: web/<link object ID>.html or .pdf (the copy), and web/<link object ID>.notes.json (highlights, scribbles).
// - Two link objects with the same address have two copies. A copy of a link object copies its files.
// - Older vaults have one shared copy for each address: web/<hash of the address>.* (a local PDF: the hash of the
//   file). The app still reads it: a link object without its own copy shows the shared copy, and the oldest link object
//   of the address also shows the old notes. A change writes the files of the link object (the shared files stay).
//   The migration script (scripts/migrations) gives each link object its own copy.

import type { Id, ItemRecord } from "../../core/types";
import type { Store } from "../../core/store";
import type { Session } from "../../io/session";
import { isLocalPath, isWebUrl, normalizeUrl, notesPath, pagePath, pdfPath, webKey } from "./savedPages";

/** The same address: web addresses without their fragment, local paths as they are. */
export function sameAddress(a: string, b: string): boolean {
  if (isWebUrl(a) && isWebUrl(b)) return normalizeUrl(a) === normalizeUrl(b);
  return a.trim() === b.trim();
}

/** The link objects of an address, oldest first (by the time they were made, then by ID). */
export function linkObjectsOf(store: Store, url: string): ItemRecord[] {
  if (url.trim() === "") return [];
  return [...store.all("items")]
    .filter((item) => item.url !== undefined && sameAddress(item.url, url))
    .sort((a, b) => (a.created !== b.created ? (a.created < b.created ? -1 : 1) : a.id < b.id ? -1 : 1));
}

/** The oldest link object of an address (it has the old notes of the address), or null. */
export function oldestLinkObject(store: Store, url: string): Id | null {
  return linkObjectsOf(store, url)[0]?.id ?? null;
}

/** The key of the old shared copy of an address: the hash of a web address. Null for a local file (see legacyPdfKey). */
export async function legacyKey(url: string): Promise<string | null> {
  return isWebUrl(url) ? webKey(url) : null;
}

export type CopyFiles = {
  /** The key of the page file (web/<fileKey>.html or .pdf): the link object, or the old shared copy. */
  fileKey: string;
  kind: "html" | "pdf";
  /** The old shared copy: the link object has no copy of its own yet. */
  shared: boolean;
};

/** Where the copy of a link object is: its own files, else the old shared copy of its address, else null. */
export async function copyOf(session: Session, itemId: Id, url: string, sharedKey: string | null): Promise<CopyFiles | null> {
  if ((await session.readWebFile(pagePath(itemId)).catch(() => null)) !== null) return { fileKey: itemId, kind: "html", shared: false };
  if (await hasBytes(session, pdfPath(itemId))) return { fileKey: itemId, kind: "pdf", shared: false };
  if (sharedKey === null) return null;
  if ((await session.readWebFile(pagePath(sharedKey)).catch(() => null)) !== null) return { fileKey: sharedKey, kind: "html", shared: true };
  if (await hasBytes(session, pdfPath(sharedKey))) return { fileKey: sharedKey, kind: "pdf", shared: true };
  void url;
  return null;
}

async function hasBytes(session: Session, path: string): Promise<boolean> {
  try {
    await session.readWebBytes(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * The notes file to read for a link object: its own notes, else (only the oldest link object of the address) the old
 * shared notes. Writes always go to the notes of the link object.
 */
export async function notesSourceOf(session: Session, itemId: Id, url: string, sharedKey: string | null): Promise<string> {
  if ((await session.readWebFile(notesPath(itemId)).catch(() => null)) !== null) return itemId;
  if (sharedKey !== null && oldestLinkObject(session.store, url) === itemId) return sharedKey;
  return itemId;
}

/**
 * Copies the files of a link object to a new link object (a paste of a copied link object): its copy and its notes.
 * The old shared copy (and, for the oldest link object, the old notes) count as its files.
 */
export async function copyWebFiles(session: Session, from: Id, to: Id, url: string): Promise<void> {
  const shared = isLocalPath(url) ? null : await legacyKey(url);
  const copy = await copyOf(session, from, url, shared);
  if (copy !== null) {
    if (copy.kind === "html") {
      const html = await session.readWebFile(pagePath(copy.fileKey));
      if (html !== null) await session.writeWebFile(pagePath(to), html);
    } else {
      const bytes = await session.readWebBytes(pdfPath(copy.fileKey));
      await session.writeWebBytes(pdfPath(to), new Uint8Array(bytes));
    }
  }
  const notes = await session.readWebFile(notesPath(await notesSourceOf(session, from, url, shared))).catch(() => null);
  if (notes !== null) await session.writeWebFile(notesPath(to), notes);
}
