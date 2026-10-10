// Search in the current board and all boards below it (Ctrl+F). See docs/SPEC.md section 7.4.

import { searchBoard, type SearchHit } from "../../core/search";
import type { Id } from "../../core/types";
import { titleOf } from "../board/boardModel";
import { useSession } from "../app/sessionContext";
import { ListDialog, type ListEntry } from "./ListDialog";
import { useEffect, useState } from "react";
import type { Session } from "../../io/session";
import { savedPageTexts } from "../web/pageTexts";

type Props = {
  boardId: Id;
  /** The dialog title. Default: a search of this board. */
  title?: string;
  /** Opens a hit. `path` is the list of boards from the search board to the board that shows the record. */
  onOpen(hit: SearchHit, query: string): void;
  onClose(): void;
};

const FIELD_LABEL: Record<SearchHit["field"], string> = {
  name: "Name",
  body: "Text",
  label: "Link label",
  group: "Link group",
  alt: "Scribble",
  page: "Web page",
};

export function SearchDialog({ boardId, title, onOpen, onClose }: Props) {
  const session = useSession();
  const pages = useSavedPageTexts(session);

  const entriesFor = (query: string): ListEntry[] => {
    const hits = query.trim() === "" ? [] : searchBoard(session.store, session.graph, boardId, query.trim(), { maxHits: 200 }, pages);
    return hits.map((hit, index) => ({
      key: String(index),
      data: hit,
      primary: (
        <>
          <span className="tag">{FIELD_LABEL[hit.field]}</span> <span translate="no">{recordTitle(hit)}</span>
        </>
      ),
      secondary: (
        <>
          <span translate="no">
            <Highlight text={hit.excerpt} query={query.trim()} />
          </span>
          <span className="path" translate="no">{[...hit.path.map((id) => titleOf(session.store, id))].join(" / ")}</span>
        </>
      ),
    }));
  };

  const recordTitle = (hit: SearchHit): string => {
    const link = session.store.get("links", hit.recordId);
    if (link !== undefined) return `${titleOf(session.store, link.from)} → ${titleOf(session.store, link.to)}`;
    return titleOf(session.store, hit.recordId);
  };

  return (
    <ListDialog
      title={title ?? "Search this board and all boards below it"}
      placeholder="Search"
      entriesFor={entriesFor}
      onChoose={(entry, query) => onOpen(entry.data as SearchHit, query.trim())}
      onClose={onClose}
    />
  );
}

/** The texts of the saved pages of link objects. The search shows other hits at once; page hits come when they are read. */
function useSavedPageTexts(session: Session): ReadonlyMap<string, string> {
  const [pages, setPages] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    let live = true;
    void savedPageTexts(session).then((texts) => live && setPages(texts));
    return () => {
      live = false;
    };
  }, [session]);
  return pages;
}

function Highlight({ text, query }: { text: string; query: string }) {
  const index = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (index === -1 || query === "") return <span>{text}</span>;
  return (
    <span>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </span>
  );
}
