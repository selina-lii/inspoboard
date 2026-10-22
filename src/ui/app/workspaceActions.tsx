// Actions that views can ask the workspace to do: navigation and windows.

import { createContext, useContext } from "react";
import type { PassageEnd } from "../../core/linkEnds";
import type { Id } from "../../core/types";
import type { FieldsRequest } from "../dialogs/FieldsDialog";

export type WorkspaceActions = {
  /** Zoom into a record: show its board. */
  openRecord(recordId: Id): void;
  /** Show a board by its home path (root, ..., board). `focusId`: a card to show on it. */
  openBoard(boardId: Id, focusId?: Id): void;
  /** Open the text of an item in a floating window. */
  openText(itemId: Id): void;
  /** Ask the user to select an item. Resolves with the item ID, or null if cancelled. */
  pickItem(options: { title: string; initialQuery?: string; allowCreate?: boolean }): Promise<Id | null>;
  /**
   * Ask the user for a link target with a search of all boards (names and texts). Resolves with the item, and the found
   * text in it (`quote`) for a hit in a text. Null if cancelled.
   */
  searchLinkTarget(title?: string): Promise<{ itemId: Id; quote?: string } | null>;
  /** While a link from selected text waits for its target: opens the search of all boards for the target. */
  searchTextLinkTarget(): void;
  /** Ask the user for some text values (a small dialog). Resolves with the values, or null if cancelled. */
  askFields(request: FieldsRequest): Promise<Record<string, string> | null>;
  /**
   * Opens the copy of a link object in the web page reader (downloads it if it has none). `itemId`: the link object
   * (without it: the first link object of the address, or a new one). `read`: then read it aloud.
   */
  openUrl(url: string, read?: boolean, find?: string, itemId?: Id): void;
  /**
   * A click on a link: a web address opens in the web browser (nothing is downloaded); a saved page with notes opens
   * its saved copy. A local file opens in the app (PDF) or in Finder.
   */
  jumpTo(url: string, itemId?: Id): void;
  /** Opens a web address in the web browser (also a page with notes). */
  openInBrowser(url: string): void;
  /** The display name of a record. */
  nameOf(recordId: Id): string;
  /**
   * Makes a link from selected text: a relation link from the item to a target, and [label](link:<id>) in the text.
   * "new": the target is a new page. "existing": the user clicks the target on a board, or finds it with search.
   */
  createTextLink(input: { sourceId: Id; label: string; from: number; to: number; mode: "new" | "existing" }): void;
  /** Goes along a relation link: shows its target, at its location (quote) if it has one. */
  followLink(linkId: Id): void;
  /** Shows an item and marks a text range in it (yellow). */
  openAt(itemId: Id, target?: JumpRange): void;
  /** Shows where an item is: its home (parent) board, with its card centered and selected. */
  showLocation(itemId: Id): void;
  /** Two items (or passages) side by side with their differences (the compare lab plugin, SPEC 7.15). */
  compare(left: PassageEnd, right: PassageEnd): void;
};

/** A text location in an item: an exact quote, or a range of string indexes. */
export type JumpRange = { quote?: string; from?: number; to?: number };

/** A request to mark a text range in an open item. `nonce` makes each request new. */
export type JumpRequest = { itemId: Id; from: number; to: number; nonce: number };

const JumpContext = createContext<JumpRequest | null>(null);
export const JumpProvider = JumpContext.Provider;

/** The current jump request for an item, or null. */
export function useJump(itemId: Id): JumpRequest | null {
  const request = useContext(JumpContext);
  return request?.itemId === itemId ? request : null;
}

const WorkspaceActionsContext = createContext<WorkspaceActions | null>(null);

export const WorkspaceActionsProvider = WorkspaceActionsContext.Provider;

export function useWorkspaceActions(): WorkspaceActions {
  const actions = useContext(WorkspaceActionsContext);
  if (actions === null) throw new Error("useWorkspaceActions() needs a WorkspaceActionsProvider.");
  return actions;
}
