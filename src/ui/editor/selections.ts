// The last text selection of each open item. Read aloud starts at the selection.
// View state only: never saved.

import type { Id } from "../../core/types";

const selections = new Map<Id, { from: number; to: number }>();

export function rememberSelection(itemId: Id, from: number, to: number): void {
  if (to > from) selections.set(itemId, { from, to });
  else selections.delete(itemId);
}

export function selectionOf(itemId: Id): { from: number; to: number } | undefined {
  return selections.get(itemId);
}
