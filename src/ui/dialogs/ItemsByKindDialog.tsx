// All items of one type in the vault, in one list (like search results). See docs/SPEC.md section 7.4.
// The type is chosen at the top of the list (default: action items); the choice stays (setting listKind).
// Type to filter. A click (or Enter) goes to the item on its home board; a small item in a page goes to its page.
// Action items have a check box that finishes them ("Done").

import { Check } from "lucide-react";
import { completeItems } from "../../core/actions";
import { itemsOfKind } from "../../core/byKind";
import type { Id } from "../../core/types";
import { LIST_KINDS, type ListKind } from "../../io/settings";
import { snippetOf, titleOf } from "../board/boardModel";
import { useRunCommand, useSession, useSessionState, useStoreRevision } from "../app/sessionContext";
import { ListDialog, type ListEntry } from "./ListDialog";

type Props = { onOpen(boardId: Id, itemId: Id): void; onClose(): void };

/** The name of each type in the picker. */
export const LIST_KIND_NAMES: Record<ListKind, string> = {
  todo: "Action item",
  note: "Note",
  page: "Page",
  text: "Text",
  comment: "Comment",
  weblink: "URL",
  flashcard: "Flashcard",
  quote: "Quote",
  group: "Group",
  media: "Media item",
};

export function ItemsByKindDialog({ onOpen, onClose }: Props) {
  const session = useSession();
  const { readOnly, settings } = useSessionState();
  const runCommand = useRunCommand();
  useStoreRevision();
  const kind = settings.listKind;

  const entriesFor = (query: string): ListEntry[] => {
    const needle = query.trim().toLocaleLowerCase();
    const entries: (ListEntry & { created: string })[] = [];
    for (const { item, boardId, cardId, color } of itemsOfKind(session.store, session.graph, kind)) {
      const text = (kind === "page" || kind === "group" || kind === "media" ? item.name : "") || snippetOf(session.store.get("texts", item.id)?.body ?? "", 120) || item.name || LIST_KIND_NAMES[kind];
      const path = session.graph.homePath(session.rootId, boardId).map((id) => titleOf(session.store, id));
      if (cardId !== item.id) path.push(titleOf(session.store, cardId));
      if (needle !== "" && !`${text} ${path.join(" ")}`.toLocaleLowerCase().includes(needle)) continue;
      const film = color ?? "#f4ff3a";
      entries.push({
        key: item.id,
        created: item.created,
        data: { boardId, cardId },
        primary: (
          <span className="action-item-row">
            {kind === "todo" && !readOnly && (
              <button
                className="todo-done-small"
                style={{ borderColor: film, background: `${film}66` }}
                data-tip="Done: remove it (undo brings it back)"
                onClick={(event) => {
                  event.stopPropagation();
                  runCommand(completeItems(session.context, [item.id]));
                }}
              >
                <Check size={11} />
              </button>
            )}
            <span translate="no">{text}</span>
          </span>
        ),
        secondary: <span className="path" translate="no">{path.join(" / ")}</span>,
      });
    }
    return entries.sort((a, b) => (a.created < b.created ? -1 : 1));
  };

  return (
    <ListDialog
      title="Items by type"
      placeholder="Filter"
      header={
        <label className="dialog-kind">
          <span>Type</span>
          <select value={kind} onChange={(event) => void session.updateSettings({ listKind: event.target.value as ListKind })}>
            {LIST_KINDS.map((option) => (
              <option key={option} value={option}>
                {LIST_KIND_NAMES[option]}
              </option>
            ))}
          </select>
        </label>
      }
      entriesFor={entriesFor}
      emptyText="No items of this type."
      onChoose={(entry) => {
        const { boardId, cardId } = entry.data as { boardId: Id; cardId: Id };
        onOpen(boardId, cardId);
      }}
      onClose={onClose}
    />
  );
}
