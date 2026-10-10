// All open action items of the vault, in one list (like search results). See docs/SPEC.md section 7.4.
// Type to filter. A click (or Enter) goes to the item on its home board. The check box finishes it ("Done").

import { Check } from "lucide-react";
import { completeItems } from "../../core/actions";
import type { Id } from "../../core/types";
import { snippetOf, titleOf } from "../board/boardModel";
import { useRunCommand, useSession, useSessionState, useStoreRevision } from "../app/sessionContext";
import { ListDialog, type ListEntry } from "./ListDialog";

type Props = { onOpen(boardId: Id, itemId: Id): void; onClose(): void };

export function ActionItemsDialog({ onOpen, onClose }: Props) {
  const session = useSession();
  const { readOnly } = useSessionState();
  const runCommand = useRunCommand();
  useStoreRevision();

  const entriesFor = (query: string): ListEntry[] => {
    const needle = query.trim().toLocaleLowerCase();
    const seen = new Set<Id>();
    const entries: (ListEntry & { created: string })[] = [];
    for (const link of session.store.all("links")) {
      if (link.kind !== "place" || link.view !== "todo" || seen.has(link.to)) continue;
      const item = session.store.get("items", link.to);
      if (item === undefined) continue;
      seen.add(item.id);
      const home = session.graph.homeOf(item.id) ?? link;
      const text = snippetOf(session.store.get("texts", item.id)?.body ?? "", 120) || item.name || "To do";
      const path = session.graph.homePath(session.rootId, home.from).map((id) => titleOf(session.store, id));
      if (needle !== "" && !`${text} ${path.join(" ")}`.toLocaleLowerCase().includes(needle)) continue;
      entries.push({
        key: item.id,
        created: item.created,
        data: { boardId: home.from, itemId: item.id },
        primary: (
          <span className="action-item-row">
            {!readOnly && (
              <button
                className="todo-done-small"
                style={{ borderColor: home.color ?? "#f4ff3a", background: `${home.color ?? "#f4ff3a"}66` }}
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
      title="Action items"
      placeholder="Filter"
      entriesFor={entriesFor}
      emptyText="No open action items."
      onChoose={(entry) => {
        const { boardId, itemId } = entry.data as { boardId: Id; itemId: Id };
        onOpen(boardId, itemId);
      }}
      onClose={onClose}
    />
  );
}
