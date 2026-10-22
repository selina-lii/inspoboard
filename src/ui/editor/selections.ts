// The last text selection of each open item. Read aloud starts at the selection.
// The cursor of each item too: when the item opens again, the cursor (and the selection) is where it was.
// View state only: never saved.

import type { Id } from "../../core/types";

const selections = new Map<Id, { from: number; to: number }>();

export function rememberSelection(itemId: Id, from: number, to: number): void {
  if (to > from) selections.set(itemId, { from, to });
  else selections.delete(itemId);
}

const cursors = new Map<Id, { anchor: number; head: number }>();

export function rememberCursor(itemId: Id, anchor: number, head: number): void {
  cursors.set(itemId, { anchor, head });
}

/** The last cursor of an item in this run of the app, or undefined if it never had one. */
export function cursorOf(itemId: Id): { anchor: number; head: number } | undefined {
  return cursors.get(itemId);
}

export function selectionOf(itemId: Id): { from: number; to: number } | undefined {
  return selections.get(itemId);
}
