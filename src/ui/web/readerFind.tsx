// Find in a saved page or PDF (⌘F): the hits, their marks, and the find bar.

import type { Box, Mark } from "./readerBasics";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

/** The places of a text in the page text: not case-sensitive, at most MAX_FIND_HITS. */
export function findAll(text: string, query: string): { start: number; end: number }[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return [];
  const haystack = text.toLocaleLowerCase();
  const hits: { start: number; end: number }[] = [];
  for (let at = haystack.indexOf(needle); at !== -1 && hits.length < MAX_FIND_HITS; at = haystack.indexOf(needle, at + needle.length)) {
    hits.push({ start: at, end: at + needle.length });
  }
  return hits;
}
const MAX_FIND_HITS = 1000;
/** Matches that get a mark on the page (all count; the current one always has a mark). */
const MAX_FIND_MARKS = 300;

/**
 * Find in the open page or PDF (⌘F while it is open). Matches have a light mark; the current one a strong mark,
 * and the page scrolls to it.
 */
export function usePageFind(text: string, boxes: (start: number, end: number) => Box[]) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState(0);
  const [focusKey, setFocusKey] = useState(0);
  /** Changes at each open or ⌘F: the find bar selects its text then (not while the user types). */
  const [selectKey, setSelectKey] = useState(0);
  const matches = useMemo(() => (open ? findAll(text, query) : []), [open, text, query]);
  const index = matches.length === 0 ? -1 : Math.min(current, matches.length - 1);
  const marks = useMemo<Mark[]>(() => {
    if (index === -1) return [];
    const near = matches.slice(Math.max(0, index - MAX_FIND_MARKS / 2), index + MAX_FIND_MARKS / 2);
    return [
      ...near.filter((match) => match !== matches[index]).map((match) => ({ id: `find:${match.start}`, color: "find" as const, boxes: boxes(match.start, match.end) })),
      { id: "find-current", color: "find-current" as const, boxes: boxes(matches[index]!.start, matches[index]!.end) },
    ];
  }, [matches, index, boxes]);
  return {
    open,
    query,
    selectKey,
    count: matches.length,
    index,
    marks,
    /** The box to scroll to (null: none), and a key that changes at each step (the page scrolls again). */
    focus: marks.length > 0 ? { box: marks[marks.length - 1]!.boxes[0] ?? null, key: focusKey } : null,
    show: (initial?: string) => {
      setOpen(true);
      if (initial !== undefined) {
        setQuery(initial);
        setCurrent(0);
      }
      setFocusKey((value) => value + 1);
      setSelectKey((value) => value + 1);
    },
    close: () => setOpen(false),
    setQuery: (value: string) => {
      setQuery(value);
      setCurrent(0);
      setFocusKey((key) => key + 1);
    },
    step: (delta: number) => {
      if (matches.length === 0) return;
      setCurrent((value) => (Math.min(value, matches.length - 1) + delta + matches.length) % matches.length);
      setFocusKey((key) => key + 1);
    },
  };
}

export type PageFind = ReturnType<typeof usePageFind>;

/** The find bar at the top right of the reader. */
export function FindBar({ find }: { find: PageFind }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (find.open) input.current?.select();
  }, [find.open, find.selectKey]);
  if (!find.open) return null;
  return (
    <div className="reader-find" role="search">
      <Search size={13} className="muted" />
      <input
        ref={input}
        autoFocus
        value={find.query}
        placeholder="Find in page"
        spellCheck={false}
        onChange={(event) => find.setQuery(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") find.step(event.shiftKey ? -1 : 1);
          else if (event.key === "Escape") find.close();
          else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
            event.preventDefault();
            input.current?.select();
          }
        }}
      />
      <span className="reader-find-count muted">{find.query.trim() === "" ? "" : find.count === 0 ? "No results" : `${find.index + 1} / ${find.count}`}</span>
      <button className="icon-button small" data-tip="Previous (⇧Enter)" disabled={find.count === 0} onClick={() => find.step(-1)}>
        <ChevronUp size={14} />
      </button>
      <button className="icon-button small" data-tip="Next (Enter)" disabled={find.count === 0} onClick={() => find.step(1)}>
        <ChevronDown size={14} />
      </button>
      <button className="icon-button small" data-tip="Close (Esc)" data-tip-end onClick={find.close}>
        <X size={14} />
      </button>
    </div>
  );
}
