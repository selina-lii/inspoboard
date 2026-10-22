// The notes of a saved page or PDF (highlights, scribbles): the file, saves, and the app undo history.

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession, useSessionState } from "../app/sessionContext";
import { hasNotes, setAnnotated } from "./annotatedPages";
import { EMPTY_NOTES, encodeNotes, notesPath, readNotes, type WebNotes } from "./savedPages";

/** The notes of each copy while the vault is open (one state for all readers and all undo steps of a copy). */
type NotesEntry = { notes: WebNotes; loaded: boolean; listeners: Set<() => void>; timer: number | undefined; pending: WebNotes | null; problem: string | null };
const notesStores = new WeakMap<object, Map<string, NotesEntry>>();

function notesEntry(session: object, key: string): NotesEntry {
  let store = notesStores.get(session);
  if (store === undefined) {
    store = new Map();
    notesStores.set(session, store);
  }
  let entry = store.get(key);
  if (entry === undefined) {
    entry = { notes: EMPTY_NOTES, loaded: false, listeners: new Set(), timer: undefined, pending: null, problem: null };
    store.set(key, entry);
  }
  return entry;
}

/**
 * The notes of a copy: web/<key>.notes.json (key: the link object). Changes save after a short pause; closing saves
 * at once.
 * Each change by the user is one step of the app undo history (as the marks of a text page). The state of the notes is
 * one for the copy (not for one reader): an undo after the reader closed, or in a reader opened again, changes the
 * same notes, and the file always gets the newest state.
 */
export function useReaderNotes(key: string) {
  const session = useSession();
  const { readOnly } = useSessionState();
  const entry = notesEntry(session, key);
  const [, setRevision] = useState(0);
  const notesRef = useRef(entry.notes);
  notesRef.current = entry.notes;

  useEffect(() => {
    const listener = () => setRevision((count) => count + 1);
    entry.listeners.add(listener);
    if (!entry.loaded) {
      session
        .readWebFile(notesPath(key))
        .then((text) => {
          if (entry.loaded) return;
          entry.notes = readNotes(text);
          entry.loaded = true;
          setAnnotated(session, key, hasNotes(entry.notes));
          entry.listeners.forEach((each) => each());
        })
        .catch((error: unknown) => {
          entry.problem = String(error);
          entry.loaded = true;
          entry.listeners.forEach((each) => each());
        });
    }
    return () => {
      entry.listeners.delete(listener);
      // The last reader of the copy closes: a waiting save happens now.
      if (entry.listeners.size === 0 && entry.pending !== null) {
        window.clearTimeout(entry.timer);
        const next = entry.pending;
        entry.pending = null;
        void session.writeWebFile(notesPath(key), encodeNotes(next)).catch(() => undefined);
      }
    };
  }, [session, key, entry]);

  /** Shows and saves notes (no undo step). The file gets the newest state after a short pause. */
  const apply = useCallback(
    (next: WebNotes) => {
      entry.notes = next;
      setAnnotated(session, key, hasNotes(next));
      entry.listeners.forEach((each) => each());
      entry.pending = next;
      window.clearTimeout(entry.timer);
      entry.timer = window.setTimeout(() => {
        const latest = entry.pending;
        entry.pending = null;
        if (latest === null) return;
        void session.writeWebFile(notesPath(key), encodeNotes(latest)).catch((error: unknown) => {
          entry.problem = String(error);
          entry.listeners.forEach((each) => each());
        });
      }, 400);
    },
    [session, key, entry],
  );
  /** A change by the user: one step of the app undo history. */
  const change = useCallback(
    (next: WebNotes, label = "Change the page notes") => {
      if (readOnly || !entry.loaded) return;
      const before = entry.notes;
      apply(next);
      session.history.recordView(label, { undo: () => apply(before), redo: () => apply(next) });
    },
    [apply, readOnly, session, entry],
  );
  /** ⌘Z and ⇧⌘Z in the reader: the app undo history (notes, small items, and all other steps). */
  const step = useCallback((back: boolean) => (back ? session.history.undo() : session.history.redo()), [session]);
  const setProblem = useCallback(
    (problem: string | null) => {
      entry.problem = problem;
      entry.listeners.forEach((each) => each());
    },
    [entry],
  );
  return { notes: entry.notes, notesRef, loaded: entry.loaded, change, step, problem: entry.problem, setProblem };
}
