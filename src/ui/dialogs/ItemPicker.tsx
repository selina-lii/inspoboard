// Select an item by name. It can also offer to create a new item with the query as its name.

import type { Id } from "../../core/types";
import { useSession } from "../app/sessionContext";
import { ListDialog, type ListEntry } from "./ListDialog";

export const CREATE_KEY = "create:";
const MAX_RESULTS = 30;

export type PickResult = { kind: "existing"; id: Id } | { kind: "create"; name: string };

type Props = {
  title: string;
  initialQuery?: string;
  allowCreate?: boolean;
  onDone(result: PickResult | null): void;
};

export function ItemPicker({ title, initialQuery, allowCreate, onDone }: Props) {
  const session = useSession();

  const entriesFor = (query: string): ListEntry[] => {
    const needle = query.trim().toLocaleLowerCase();
    const items: ListEntry[] = [...session.store.all("items")]
      .filter((item) => needle === "" || item.name.toLocaleLowerCase().includes(needle))
      .sort((a, b) => rank(a.name, needle) - rank(b.name, needle) || a.name.localeCompare(b.name))
      .slice(0, MAX_RESULTS)
      .map((item) => ({
        key: item.id,
        primary: item.name === "" ? <span className="muted">Untitled</span> : <span translate="no">{item.name}</span>,
        secondary: <span translate="no">{firstLine(session.store.get("texts", item.id)?.body ?? "")}</span>,
      }));
    const exact = items.some((entry) => session.store.get("items", entry.key)?.name === query.trim());
    if (allowCreate === true && query.trim() !== "" && !exact) {
      items.push({ key: `${CREATE_KEY}${query.trim()}`, primary: `Create new item “${query.trim()}”`, secondary: "On the current board" });
    }
    return items;
  };

  return (
    <ListDialog
      title={title}
      placeholder="Item name"
      initialQuery={initialQuery}
      entriesFor={entriesFor}
      onChoose={(entry) =>
        onDone(
          entry.key.startsWith(CREATE_KEY)
            ? { kind: "create", name: entry.key.slice(CREATE_KEY.length) }
            : { kind: "existing", id: entry.key },
        )
      }
      onClose={() => onDone(null)}
    />
  );
}

/** Lower is better: a name that starts with the query comes first. */
function rank(name: string, needle: string): number {
  if (needle === "") return 0;
  return name.toLocaleLowerCase().startsWith(needle) ? 0 : 1;
}

function firstLine(body: string): string {
  const line = body.split("\n").find((candidate) => candidate.trim() !== "") ?? "";
  return line.length > 80 ? `${line.slice(0, 80)}…` : line;
}
