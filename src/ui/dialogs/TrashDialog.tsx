// The trash: items that are on no board, the most recent first. See docs/SPEC.md section 5.4.
// Type to filter. A click (or Enter) puts the item back ("Restore") and shows it. The trash button deletes it for good.

import { RotateCcw, Trash2 } from "lucide-react";
import { deleteForever, restoreFromTrash, trashEntries } from "../../core/trash";
import type { Id } from "../../core/types";
import { snippetOf, titleOf } from "../board/boardModel";
import { useRunCommand, useSession, useSessionState, useStoreRevision } from "../app/sessionContext";
import { t, uiLocale } from "../i18n/i18n";
import { ListDialog, type ListEntry } from "./ListDialog";

type Props = { boardId: Id; onOpen(boardId: Id, itemId: Id): void; onClose(): void };

export function TrashDialog({ boardId, onOpen, onClose }: Props) {
  const session = useSession();
  const { readOnly } = useSessionState();
  const runCommand = useRunCommand();
  useStoreRevision();

  const restore = (itemId: Id) => {
    // No last board (or it is gone too): to the right of the cards on the current board.
    const children = session.graph.childrenOf(boardId);
    const x = children.length === 0 ? 0 : Math.max(...children.map((place) => place.x + place.w)) + 40;
    const y = children.length === 0 ? 0 : Math.min(...children.map((place) => place.y));
    const { command, boardId: target } = restoreFromTrash(session.context, session.rootId, itemId, { boardId, x, y });
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

  return (
    <ListDialog
      title="Trash"
      placeholder="Filter"
      entriesFor={entriesFor}
      emptyText="The trash is empty. Items that you delete from all boards show here."
      onChoose={(entry) => !readOnly && restore(entry.data as Id)}
      onClose={onClose}
    />
  );
}
