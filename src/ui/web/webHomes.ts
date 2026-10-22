// The copy of a document (SPEC 1.1): a saved web page or PDF belongs to one link object (its "home").
// - Files: web/<link object ID>.html or .pdf (the copy), and web/<link object ID>.notes.json (highlights, scribbles).
// - Two link objects with the same address have two copies. A copy of a link object copies its files.
// - Older vaults (format 1) had one shared copy for each address (web/<hash>.*). The app does not read it: the
//   migration script gives each link object its own copy (the old files stay on disk, unused).

import type { Id, ItemRecord } from "../../core/types";
import type { Store } from "../../core/store";
import type { Session } from "../../io/session";
import { isLocalPath, isWebUrl, normalizeUrl, notesPath, pagePath, pdfPath } from "./savedPages";

/**
 * The same address: web addresses without their fragment. Local files by their path: "file://" and "%20" (URL
 * escapes) do not count, so "file:///a/b%20c.pdf" and "/a/b c.pdf" are the same file.
 */
export function sameAddress(a: string, b: string): boolean {
  if (isWebUrl(a) && isWebUrl(b)) return normalizeUrl(a) === normalizeUrl(b);
  return localKey(a) === localKey(b);
}

function localKey(address: string): string {
  let path = address.trim();
  if (/^file:\/\//i.test(path)) path = path.replace(/^file:\/\/(localhost)?/i, "");
  if (isLocalPath(path) || /%[0-9a-f]{2}/i.test(path)) {
    try {
      path = decodeURI(path);
    } catch {
      // Not an escaped path: as it is.
    }
  }
  return path;
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

export type CopyFiles = {
  /** The key of the page file (web/<fileKey>.html or .pdf): the link object. */
  fileKey: string;
  kind: "html" | "pdf";
};

/** The copy of a link object (its own files), or null. */
export async function copyOf(session: Session, itemId: Id): Promise<CopyFiles | null> {
  if ((await session.readWebFile(pagePath(itemId)).catch(() => null)) !== null) return { fileKey: itemId, kind: "html" };
  if (await hasBytes(session, pdfPath(itemId))) return { fileKey: itemId, kind: "pdf" };
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

/** Copies the files of a link object to a new link object (a paste of a copied link object): its copy and its notes. */
export async function copyWebFiles(session: Session, from: Id, to: Id): Promise<void> {
  const copy = await copyOf(session, from);
  if (copy !== null) {
    if (copy.kind === "html") {
      const html = await session.readWebFile(pagePath(copy.fileKey));
      if (html !== null) await session.writeWebFile(pagePath(to), html);
    } else {
      const bytes = await session.readWebBytes(pdfPath(copy.fileKey));
      await session.writeWebBytes(pdfPath(to), new Uint8Array(bytes));
    }
  }
  const notes = await session.readWebFile(notesPath(from)).catch(() => null);
  if (notes !== null) await session.writeWebFile(notesPath(to), notes);
}
