// The trash: items that are on no board, the most recent first. See docs/SPEC.md section 5.4.
// Type to filter. A click (or Enter) puts the item back ("Restore") and shows it. The trash button deletes it for good.

import { LifeBuoy, RotateCcw, Trash2 } from "lucide-react";
import { lostTops } from "../../core/lost";
import { useWorkspaceActions } from "../app/workspaceActions";
import { lostAndFoundMap } from "../plugins/tray/tray";
import { rightOfCards } from "../../core/actions";
import { deleteForever, restoreFromTrash, trashEntries } from "../../core/trash";
import type { Id } from "../../core/types";
import { snippetOf, titleOf } from "../board/boardModel";
import { useRunCommand, useSession, useSessionState, useStoreRevision } from "../app/sessionContext";
import { t, uiLocale } from "../i18n/i18n";
import { ListDialog, type ListEntry } from "./ListDialog";

type Props = { boardId: Id; onOpen(boardId: Id, itemId: Id): void; onClose(): void };

export function TrashDialog({ boardId, onOpen, onClose }: Props) {
  const session = useSession();
  const { readOnly, settings } = useSessionState();
  const actions = useWorkspaceActions();
  const runCommand = useRunCommand();
  useStoreRevision();

  const restore = (itemId: Id) => {
    // No last board (or it is gone too): to the right of the cards on the current board.
    const { command, boardId: target } = restoreFromTrash(session.context, session.rootId, itemId, { boardId, ...rightOfCards(session, boardId) });
    if (runCommand(command)) onOpen(target, itemId);
  };

  const entriesFor = (query: string): ListEntry[] => {
    const needle = query.trim().toLocaleLowerCase();
    return trashEntries(session, session.rootId).flatMap((entry) => {
      const title = titleOf(session.store, entry.itemId);
      const snippet = snippetOf(session.store.get("texts", entry.itemId)?.body ?? "", 100);
      if (needle !== "" && !`${title} ${snippet}`.toLocaleLowerCase().includes(needle)) return [];
      const board = entry.from !== null && session.store.has("items", entry.from.board) ? titleOf(session.store, entry.from.board) : null;
      const when = entry.trashed === null ? t("Older") : t("Deleted {0}", new Date(entry.trashed).toLocaleString(uiLocale()));
      return [
        {
          key: entry.itemId,
          data: entry.itemId,
          primary: (
            <span className="trash-row">
              <span className="trash-title" translate="no" dir="auto">
                {title}
                {snippet !== "" && snippet !== title && <span className="trash-snippet"> · {snippet}</span>}
              </span>
              {!readOnly && (
                <span className="trash-buttons">
                  <button
                    className="icon-button"
                    data-tip="Restore: put it back on its board"
                    onClick={(event) => {
                      event.stopPropagation();
                      restore(entry.itemId);
                    }}
                  >
                    <RotateCcw size={13} />
                  </button>
                  <button
                    className="icon-button danger"
                    data-tip="Delete forever"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (window.confirm(t("Delete “{0}” forever? Its text, its links, and its board go. Undo can still bring it back while the app is open.", title)))
                        runCommand(deleteForever(session.context, entry.itemId));
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </span>
              )}
            </span>
          ),
          secondary: (
            <span className="path">
              {when}
              {board !== null && (
                <>
                  {" · "}
                  <span translate="no">{board}</span>
                </>
              )}
            </span>
          ),
        },
      ];
    });
  };

  // Plugin "Sorting tray": "Lost and found" salvages all items that no board shows (also those on a board that is on no
  // board: they are not in the trash). It opens the "Lost and found" map of the root board (made at the first use).
  const lostCount = settings.tray ? lostTops(session.store, session.graph, session.rootId).length : 0;
  const openLostAndFound = () => {
    const { mapId, command } = lostAndFoundMap(session.context, session.rootId, rightOfCards(session, session.rootId));
    if (command !== null && !runCommand(command)) return;
    onClose();
    actions.openBoard(mapId);
  };

  return (
    <ListDialog
      title="Trash"
      placeholder="Filter"
      header={
        settings.tray && !readOnly ? (
          <div className="trash-lost">
            <span className="setting-help">{lostCount === 0 ? "No items are lost: each item shows on a board or in the trash." : `${lostCount} lost items (no board shows them), with the trash.`}</span>
            <button onClick={openLostAndFound} data-tip="A sorting map whose tray holds the lost items: pull them out onto a board">
              <LifeBuoy size={13} /> Lost and found
            </button>
          </div>
        ) : undefined
      }
      entriesFor={entriesFor}
      emptyText="The trash is empty. Items that you delete from all boards show here."
      onChoose={(entry) => !readOnly && restore(entry.data as Id)}
      onClose={onClose}
    />
  );
}
