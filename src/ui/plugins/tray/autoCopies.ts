// "On first edit" copies of a processing map (SPEC 7.16, setting `detachCopies: "edit"`).
// - A reference card on a processing map opens for editing as a copy: the copy is made when the card opens (a window,
//   a page, or a collection's board), and the card shows it. The original never changes from the map.
// - A change made on a board of the map changes a copy too (useMapScope → copyOnWrite).
// - When the copy closes (no window, no page shows it) and nothing changed in it, it goes again: the card is a
//   reference of the original once more. So a copy stays only after a change, as if it was made at the first edit.
// - The list of these copies is for this app session only (memory).

import { useCallback, useEffect } from "react";
import { makeOp, type Command, type Op } from "../../../core/commands";
import { descendantsOf } from "../../../core/lineage";
import type { Id, PlaceLink } from "../../../core/types";
import type { Session } from "../../../io/session";
import { logError } from "../../app/debugLog";
import type { CommandScope } from "../../app/sessionContext";
import { copiesOnEdit, copyCard, copyOnWrite, copySignature, type Copied } from "./processing";

/** `signature`: the copy as it was made (copySignature): the same signature at close is an unchanged copy. */
type AutoCopy = { placeId: Id; original: Id; signature: string };
const copies = new WeakMap<Session, Map<Id, AutoCopy>>();
const copiesOf = (session: Session) => {
  let map = copies.get(session);
  if (map === undefined) copies.set(session, (map = new Map()));
  return map;
};

/** Copies the files of copied items (saved web page or PDF, notes, marks), after their command ran. */
export function copyFilesOf(session: Session, copied: Copied): void {
  for (const [from, to] of copied) void session.copyItemFiles(from, to).catch((error: unknown) => logError(`copy files ${from} → ${to}`, error));
}

/**
 * The item to open for a card: a copy if the card is a reference on a processing map that copies on the first edit
 * (made now), else the card's item. Null if the card is not there.
 */
export function itemToEdit(session: Session, runCommand: (command: Command) => boolean, placeId: Id): Id | null {
  const place = session.store.get("links", placeId);
  if (place?.kind !== "place") return null;
  if (session.getState().readOnly || !copiesOnEdit(session.context, place)) return place.to;
  const made = copyCard(session.context, placeId);
  if (made.copyId === null || !runCommand({ label: "Copy for editing", ops: made.ops })) return place.to;
  copyFilesOf(session, made.copied);
  copiesOf(session).set(made.copyId, { placeId, original: place.to, signature: copySignature(session.store, session.graph, made.copyId) });
  return made.copyId;
}

/** The command scope of the board area: on a board of a processing map, changes of reference cards change copies. */
export function useMapScope(session: Session, boardId: Id): CommandScope {
  return useCallback(
    (input: Command) => {
      const { command, copied } = copyOnWrite(session.context, boardId, input);
      return { command, after: () => copyFilesOf(session, copied) };
    },
    [session, boardId],
  );
}

/** The command that takes an unchanged copy away again (the card shows the original), or null if it changed. */
function releaseCommand(session: Session, copyId: Id, entry: AutoCopy): Command | null {
  const { store } = session;
  const copy = store.get("items", copyId);
  const place = store.get("links", entry.placeId);
  if (copy === undefined || place?.kind !== "place" || place.to !== copyId || !store.has("items", entry.original)) return null;
  const unchanged = copySignature(store, session.graph, copyId) === entry.signature && descendantsOf(store, copyId).size === 0;
  if (!unchanged) return null;
  const ops: Op[] = [makeOp("links", place.id, place, { ...place, to: entry.original, ref: true } satisfies PlaceLink), makeOp("items", copyId, copy, null)];
  const text = store.get("texts", copyId);
  if (text !== undefined) ops.push(makeOp("texts", copyId, text, null));
  // The board of a copied collection: its reference cards, its groups, and its scribbles.
  for (const card of session.graph.childrenOf(copyId)) {
    ops.push(makeOp("links", card.id, card, null));
    const stamp = store.get("stamps", card.to);
    if (stamp !== undefined) ops.push(makeOp("stamps", card.to, stamp, null));
  }
  for (const group of session.graph.outlinesOn(copyId)) ops.push(makeOp("outlines", group.id, group, null));
  return { label: "Unchanged copy removed", ops };
}

/** Takes away the unchanged copies that no window or page shows now. `open`: the items that show. */
export function useReleaseClosedCopies(session: Session, runCommand: (command: Command) => boolean, open: readonly Id[]): void {
  const key = open.join(",");
  useEffect(() => {
    const map = copiesOf(session);
    const shown = new Set(key.split(","));
    for (const [copyId, entry] of [...map]) {
      if (shown.has(copyId)) continue;
      map.delete(copyId);
      const command = releaseCommand(session, copyId, entry);
      if (command !== null && !session.getState().readOnly) runCommand(command);
    }
  }, [session, runCommand, key]);
}
