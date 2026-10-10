// Web pages with notes. See docs/SPEC.md section 7.8.
// - A saved page with notes (a highlight, a scribble, a comment, or a note on its canvas) is "local": a click on its
//   link opens the saved copy (never the live web page), so the notes stay on the text they were made on.
//   The menu of the link keeps "Open in web browser".
// - The app reads web/<key>.notes.json to know it. It keeps the answers while the vault is open.

import { useEffect, useSyncExternalStore } from "react";
import type { Session } from "../../io/session";
import { isWebUrl, normalizeUrl, notesPath, readNotes, webKey, type WebNotes } from "./savedPages";

type Cache = { keys: Map<string, string>; annotated: Map<string, boolean> };
const caches = new WeakMap<Session, Cache>();
const listeners = new Set<() => void>();
let version = 0;

function cacheOf(session: Session): Cache {
  let cache = caches.get(session);
  if (cache === undefined) {
    cache = { keys: new Map(), annotated: new Map() };
    caches.set(session, cache);
  }
  return cache;
}

function changed(): void {
  version += 1;
  for (const listener of listeners) listener();
}

/** True if the notes have content. */
export function hasNotes(notes: WebNotes): boolean {
  return notes.highlights.length > 0 || notes.scribbles.length > 0 || notes.items.length > 0;
}

/** The reader tells the app the notes state of a page (at load, and after each change). */
export function setAnnotated(session: Session, key: string, value: boolean): void {
  const cache = cacheOf(session);
  if (cache.annotated.get(key) === value) return;
  cache.annotated.set(key, value);
  changed();
}

async function keyOf(cache: Cache, url: string): Promise<string> {
  const normal = normalizeUrl(url);
  let key = cache.keys.get(normal);
  if (key === undefined) {
    key = await webKey(normal);
    cache.keys.set(normal, key);
  }
  return key;
}

/** True if the saved copy of a web address has notes. Reads the notes file the first time. */
export async function isAnnotated(session: Session, url: string): Promise<boolean> {
  if (!isWebUrl(url)) return false;
  const cache = cacheOf(session);
  const key = await keyOf(cache, url);
  const known = cache.annotated.get(key);
  if (known !== undefined) return known;
  let value = false;
  try {
    value = hasNotes(readNotes(await session.readWebFile(notesPath(key))));
  } catch {
    value = false;
  }
  setAnnotated(session, key, value);
  return value;
}

/** For a link card: true if its page has notes (false until the app knows). */
export function useAnnotated(session: Session, url: string): boolean {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => version,
  );
  useEffect(() => {
    if (url !== "" && isWebUrl(url)) void isAnnotated(session, url);
  }, [session, url]);
  if (!isWebUrl(url)) return false;
  const cache = cacheOf(session);
  const key = cache.keys.get(normalizeUrl(url));
  return key !== undefined && cache.annotated.get(key) === true;
}
