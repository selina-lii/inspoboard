// The last passage that the user selected, in any view: a page text, a saved web page, or a PDF.
// The link bench takes it ("Selected text", or a drop of the dragged selection). See docs/SPEC.md section 7.11.
// This is view state: it is not saved.

import { useSyncExternalStore } from "react";
import type { Id } from "../../core/types";

/** A selected passage: its item, its text, and (in an item text) its place. */
export type Passage = { itemId: Id; quote: string; range?: { from: number; to: number } };

let last: Passage | null = null;
const listeners = new Set<() => void>();

/** A view reports its selection (null: the selection of this item is gone). */
export function reportPassage(passage: Passage | null, itemId?: Id): void {
  if (passage === null && itemId !== undefined && last?.itemId !== itemId) return;
  if (passage !== null && passage.quote.trim() === "") passage = null;
  last = passage;
  for (const listener of listeners) listener();
}

export function lastPassage(): Passage | null {
  return last;
}

export function usePassage(): Passage | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => last,
  );
}
