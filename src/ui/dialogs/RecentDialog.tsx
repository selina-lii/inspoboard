// Recently added: the items made in the last 30 days, the newest first. See docs/SPEC.md section 7.4.
// Type to filter. A click (or Enter) shows the item: on its home board, in its page, or (an item on no board) in a window.

import { trashEntries } from "../../core/trash";
import type { Id } from "../../core/types";
import { snippetOf, titleOf } from "../board/boardModel";
import { useSession, useStoreRevision } from "../app/sessionContext";
import { t, uiLocale } from "../i18n/i18n";
import { ListDialog, type ListEntry } from "./ListDialog";

type Props = { onOpen(itemId: Id): void; onClose(): void };

/** The time span of the list. */
const DAYS = 30;
const MAX_ENTRIES = 300;

export function RecentDialog({ onOpen, onClose }: Props) {
  const session = useSession();
  useStoreRevision();

  const entriesFor = (query: string): ListEntry[] => {
    const needle = query.trim().toLocaleLowerCase();
    const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString();
    const trashed = new Set(trashEntries(session, session.rootId).map((entry) => entry.itemId));
    const items = [...session.store.all("items")]
      .filter((item) => item.id !== session.rootId && item.created >= since)
      .sort((a, b) => (a.created < b.created ? 1 : a.created > b.created ? -1 : 0));
    const entries: ListEntry[] = [];
    for (const item of items) {
      if (entries.length >= MAX_ENTRIES) break;
      const title = titleOf(session.store, item.id);
      const snippet = snippetOf(session.store.get("texts", item.id)?.body ?? "", 100);
      // Where it is: its home board (or the page that it is in), or the trash.
      const inside = session.graph.insideHomeOf(item.id)?.from;
      const card = inside !== undefined && session.store.has("items", inside) ? inside : item.id;
      const home = session.graph.homeOf(card);
      const path = home === undefined ? [] : session.graph.homePath(session.rootId, home.from).map((id) => titleOf(session.store, id));
      if (card !== item.id) path.push(titleOf(session.store, card));
      const where = trashed.has(item.id) ? t("In the trash") : path.join(" / ");
      if (needle !== "" && !`${title} ${snippet} ${where}`.toLocaleLowerCase().includes(needle)) continue;
      entries.push({
        key: item.id,
        data: item.id,
        primary: (
          <span className="trash-title" translate="no" dir="auto">
            {title}
            {snippet !== "" && snippet !== title && <span className="trash-snippet"> · {snippet}</span>}
          </span>
        ),
        secondary: (
          <span className="path">
            {t("Added {0}", new Date(item.created).toLocaleString(uiLocale()))}
            {where !== "" && (
              <>
                {" · "}
                <span translate="no">{where}</span>
              </>
            )}
          </span>
        ),
      });
    }
    return entries;
  };

  return (
    <ListDialog
      title="Recently added"
      placeholder="Filter"
      header={<div className="setting-help">Items made in the last 30 days, the newest first. A click shows the item.</div>}
      entriesFor={entriesFor}
      emptyText="No items were added in the last 30 days."
      onChoose={(entry) => onOpen(entry.data as Id)}
      onClose={onClose}
    />
  );
}
