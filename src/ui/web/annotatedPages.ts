// Web pages with notes. See docs/SPEC.md sections 1.1 and 7.8.
// - A copy with notes (a highlight, a scribble, or a small item on its canvas) is "local": a click on its link opens
//   the saved copy (never the live web page), so the notes stay on the text they were made on.
//   The menu of the link keeps "Open in web browser".
// - Each link object has its own copy (webHomes.ts). The app reads its notes file (or the old shared notes) and its
//   small items. It keeps the answers while the vault is open.

import { useEffect, useSyncExternalStore } from "react";
import type { Id } from "../../core/types";
import type { Session } from "../../io/session";
import { notesPath, readNotes, type WebNotes } from "./savedPages";

type Cache = { annotated: Map<Id, boolean>; asked: Set<Id> };
const caches = new WeakMap<Session, Cache>();
const listeners = new Set<() => void>();
let version = 0;

function cacheOf(session: Session): Cache {
  let cache = caches.get(session);
  if (cache === undefined) {
    cache = { annotated: new Map(), asked: new Set() };
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
  return notes.highlights.length > 0 || notes.scribbles.length > 0;
}

/** The reader tells the app the notes state of a link object (at load, and after each change). */
export function setAnnotated(session: Session, itemId: Id, value: boolean): void {
  const cache = cacheOf(session);
  if (cache.annotated.get(itemId) === value) return;
  cache.annotated.set(itemId, value);
  changed();
}

/** True if the copy of a link object has notes or small items. Reads the notes file the first time. */
export async function isAnnotated(session: Session, itemId: Id, url: string): Promise<boolean> {
  if (session.graph.insideOf(itemId).length > 0) return true;
  const cache = cacheOf(session);
  const known = cache.annotated.get(itemId);
  if (known !== undefined) return known;
  let value = false;
  try {
    void url;
    value = hasNotes(readNotes(await session.readWebFile(notesPath(itemId))));
  } catch {
    value = false;
  }
  setAnnotated(session, itemId, value);
  return value;
}

/** For a link card: true if its copy has notes or small items (false until the app knows). */
export function useAnnotated(session: Session, itemId: Id, url: string): boolean {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => version,
  );
  useEffect(() => {
    const cache = cacheOf(session);
    if (url === "" || cache.asked.has(itemId)) return;
    cache.asked.add(itemId);
    void isAnnotated(session, itemId, url);
  }, [session, itemId, url]);
  if (url === "") return false;
  return session.graph.insideOf(itemId).length > 0 || cacheOf(session).annotated.get(itemId) === true;
}
