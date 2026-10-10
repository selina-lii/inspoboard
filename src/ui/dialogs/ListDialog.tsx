// A modal dialog with a query field and a list of results. Up/Down move, Enter selects, Escape closes.
// The item picker and the search use it.

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { MovablePanel } from "../app/movable";
import { isComposing } from "../app/keys";
import "./dialogs.css";

export type ListEntry = {
  key: string;
  primary: ReactNode;
  secondary?: ReactNode;
  /** Any value the caller needs when the entry is chosen. */
  data?: unknown;
};

type Props = {
  title: string;
  placeholder: string;
  initialQuery?: string;
  /** Returns the entries for a query. */
  entriesFor(query: string): ListEntry[];
  onChoose(entry: ListEntry, query: string): void;
  onClose(): void;
  emptyText?: string;
};

export function ListDialog({ title, placeholder, initialQuery, entriesFor, onChoose, onClose, emptyText }: Props) {
  const [query, setQuery] = useState(initialQuery ?? "");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const entries = entriesFor(query);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  useEffect(() => setActive(0), [query]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (isComposing(event)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(entries.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const entry = entries[active];
      if (entry !== undefined) onChoose(entry, query);
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <MovablePanel className="dialog" titleClassName="dialog-title" label={title} title={title} onMouseDown={(event) => event.stopPropagation()}>
        <input
          ref={input}
          className="dialog-query"
          value={query}
          dir="auto"
          placeholder={placeholder}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <ul className="dialog-list">
          {entries.map((entry, index) => (
            <li
              key={entry.key}
              className={index === active ? "active" : undefined}
              onMouseEnter={() => setActive(index)}
              onClick={() => onChoose(entry, query)}
            >
              <div className="primary">{entry.primary}</div>
              {entry.secondary !== undefined && <div className="secondary">{entry.secondary}</div>}
            </li>
          ))}
          {entries.length === 0 && (query !== "" || emptyText !== undefined) && <li className="empty">{emptyText ?? "No results"}</li>}
        </ul>
      </MovablePanel>
    </div>
  );
}
