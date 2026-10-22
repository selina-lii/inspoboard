// Search, and replace, in the current board and all boards below it (Ctrl+F; Ctrl+Alt+F shows the replace field).
// See docs/SPEC.md section 7.4.
// - Options: match case (Alt+C), whole word (Alt+W), regular expression (Alt+R); where: this board or all boards.
// - Up/Down choose a result, Enter opens it, Esc closes. In the replace field: Enter replaces the chosen result,
//   Ctrl+Enter replaces all. A replace is one command (⌘Z gives the texts back).
// - Special codes (the "¶" menu of each field): ^p (a line break), ^t, … in a plain search, as in Microsoft Word;
//   \n, \t, $1, … with a regular expression, as in VS Code. See core/search.ts and core/replace.ts.
// - The query, the options and the replacement stay for the next search while the app is open.

import { CaseSensitive, ChevronRight, Pilcrow, Regex, Replace, ReplaceAll, WholeWord } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { replaceHits, replacementText } from "../../core/replace";
import { makeMatcher, searchBoard, type SearchHit, type SearchOptions } from "../../core/search";
import type { Id } from "../../core/types";
import { titleOf } from "../board/boardModel";
import { isComposing } from "../app/keys";
import { MovablePanel } from "../app/movable";
import { useRunCommand, useSession, useSessionState, useStoreRevision } from "../app/sessionContext";
import type { Session } from "../../io/session";
import { savedPageTexts } from "../web/pageTexts";
import "./dialogs.css";

type Props = {
  boardId: Id;
  /** The dialog title. Default: a search of this board. */
  title?: string;
  /** Pick a result (a link target): no replace, and no choice of where. */
  pick?: boolean;
  /** Show the replace field at the start. */
  replace?: boolean;
  /** Opens a hit. `query`: the text that matched. */
  onOpen(hit: SearchHit, query: string): void;
  onClose(): void;
};

const FIELD_LABEL: Record<SearchHit["field"], string> = {
  name: "Name",
  subtitle: "Page subtitle",
  body: "Text",
  label: "Link label",
  group: "Link group",
  alt: "Scribble",
  page: "Web page",
};

/** The results that show (all results count for "Replace all"). */
const SHOWN_HITS = 200;
const ALL_HITS = 100_000;

type Memory = { query: string; replacement: string; showReplace: boolean; allBoards: boolean } & Required<Pick<SearchOptions, "caseSensitive" | "wholeWord" | "regex">>;
/** The last search, for the next one (while the app is open). */
let memory: Memory = { query: "", replacement: "", showReplace: false, allBoards: false, caseSensitive: false, wholeWord: false, regex: false };

export function SearchDialog({ boardId, title, pick = false, replace = false, onOpen, onClose }: Props) {
  const session = useSession();
  const { readOnly } = useSessionState();
  const runCommand = useRunCommand();
  const revision = useStoreRevision();
  const pages = useSavedPageTexts(session);
  const [state, setState] = useState<Memory>(() => ({ ...memory, query: selectedText() ?? memory.query, showReplace: !pick && (replace || memory.showReplace) }));
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState<string[] | null>(null);
  const queryInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const update = (change: Partial<Memory>) =>
    setState((current) => {
      const next = { ...current, ...change };
      memory = next;
      return next;
    });

  // A plain query ignores spaces at its ends; a regular expression is used as it is.
  const query = state.regex ? state.query : state.query.trim();
  const options: SearchOptions = { caseSensitive: state.caseSensitive, wholeWord: state.wholeWord, regex: state.regex };
  const matcher = makeMatcher(query, options);
  const error = typeof matcher === "string" ? matcher : null;
  const searchFrom = state.allBoards && !pick ? session.rootId : boardId;
  const search = (maxHits: number) => (matcher === null || error !== null ? [] : searchBoard(session.store, session.graph, searchFrom, query, { ...options, maxHits }, pages));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const hits = useMemo(() => search(SHOWN_HITS + 1), [query, state.caseSensitive, state.wholeWord, state.regex, searchFrom, pages, revision]);
  const shown = hits.slice(0, SHOWN_HITS);
  const index = Math.min(active, shown.length - 1);

  useEffect(() => {
    queryInput.current?.focus();
    queryInput.current?.select();
  }, []);
  useEffect(() => setActive(0), [query, state.caseSensitive, state.wholeWord, state.regex, searchFrom]);
  useEffect(() => setStatus(null), [query, state.replacement, state.caseSensitive, state.wholeWord, state.regex, searchFrom]);
  useEffect(() => list.current?.querySelector(".active")?.scrollIntoView({ block: "nearest" }), [index]);

  const canReplace = !pick && !readOnly && error === null && matcher !== null;
  const doReplace = (targets: SearchHit[]) => {
    if (!canReplace || targets.length === 0) return;
    const result = replaceHits(session.context, targets, query, state.replacement, options);
    if (result.command.ops.length > 0) runCommand(result.command);
    setStatus([
      result.replaced === 1 ? "Replaced 1 result." : `Replaced ${result.replaced} results.`,
      ...(result.skipped === 0 ? [] : [result.skipped === 1 ? "1 result did not change: a link target, a linked passage, or a saved web page." : `${result.skipped} results did not change: link targets, linked passages, or saved web pages.`]),
      ...(result.replaced > 0 ? ["⌘Z undoes it."] : []),
    ]);
  };
  const replaceOne = () => {
    const hit = shown[index];
    if (hit !== undefined) doReplace([hit]);
  };
  const replaceAll = () => doReplace(search(ALL_HITS));
  /** The new text of a match (with a regular expression: its groups put in; a match that needs the text around it can differ). */
  const previewOf = (match: string) => replacementText(match, { start: 0, end: match.length }, query, state.replacement, options);

  const onKeyDown = (event: KeyboardEvent) => {
    if (isComposing(event)) return;
    const mod = event.metaKey || event.ctrlKey;
    // Alt+C, Alt+W, Alt+R: the options (by the key place: Alt changes the letter on macOS).
    if (event.altKey && !mod) {
      const option = ({ KeyC: "caseSensitive", KeyW: "wholeWord", KeyR: "regex" } as const)[event.code as "KeyC" | "KeyW" | "KeyR"];
      if (option !== undefined) {
        event.preventDefault();
        update({ [option]: !state[option] });
        return;
      }
    }
    if (mod && event.altKey && event.code === "KeyF" && !pick) {
      event.preventDefault();
      update({ showReplace: true });
      setTimeout(() => replaceInput.current?.focus());
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(Math.min(shown.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(Math.max(0, index - 1));
    }
  };

  const itemCount = new Set(shown.map((hit) => hit.recordId)).size;
  const count = hits.length > SHOWN_HITS ? `More than ${SHOWN_HITS} results` : hits.length === 1 ? "1 result" : itemCount === 1 ? `${hits.length} results in 1 place` : `${hits.length} results in ${itemCount} places`;
  const recordTitle = (hit: SearchHit): string => {
    const link = session.store.get("links", hit.recordId);
    if (link !== undefined && link.kind !== "inside") return `${titleOf(session.store, link.from)} → ${titleOf(session.store, link.to)}`;
    return titleOf(session.store, hit.recordId);
  };

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <MovablePanel
        className="dialog search-dialog"
        titleClassName="dialog-title"
        label={title ?? "Search"}
        title={title ?? (state.allBoards ? "Search all boards" : "Search this board and all boards below it")}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="search-rows" onKeyDown={onKeyDown}>
          <div className="search-row">
            {!pick && (
              <button
                className={`icon-button small search-expand${state.showReplace ? " open" : ""}`}
                data-tip={state.showReplace ? "Hide replace" : "Replace (⌥⌘F)"}
                data-tip-start
                onClick={() => update({ showReplace: !state.showReplace })}
              >
                <ChevronRight size={14} />
              </button>
            )}
            <div className={`search-field${error !== null ? " invalid" : ""}`}>
              <input
                ref={queryInput}
                className="search-input"
                value={state.query}
                dir="auto"
                spellCheck={false}
                placeholder="Search"
                onChange={(event) => update({ query: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !isComposing(event)) {
                    event.preventDefault();
                    const hit = shown[index];
                    if (hit !== undefined) onOpen(hit, hit.match);
                  }
                }}
              />
              <CodeMenu input={queryInput} codes={state.regex ? FIND_REGEX_CODES : FIND_PLAIN_CODES} onChange={(query) => update({ query })} />
              <Toggle on={state.caseSensitive} tip="Match case (⌥C)" onClick={() => update({ caseSensitive: !state.caseSensitive })}>
                <CaseSensitive size={15} />
              </Toggle>
              <Toggle on={state.wholeWord} tip="Whole word (⌥W)" onClick={() => update({ wholeWord: !state.wholeWord })}>
                <WholeWord size={15} />
              </Toggle>
              <Toggle on={state.regex} tip="Regular expression (⌥R)" onClick={() => update({ regex: !state.regex })}>
                <Regex size={15} />
              </Toggle>
            </div>
          </div>
          {state.showReplace && !pick && (
            <div className="search-row">
              <span className="search-expand-space" />
              <div className="search-field">
                <input
                  ref={replaceInput}
                  className="search-input"
                  value={state.replacement}
                  dir="auto"
                  spellCheck={false}
                  disabled={readOnly}
                  placeholder={state.regex ? "Replace (\\n: line break, $1: group 1)" : "Replace (^p: line break)"}
                  onChange={(event) => update({ replacement: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !isComposing(event)) {
                      event.preventDefault();
                      if (event.metaKey || event.ctrlKey) replaceAll();
                      else replaceOne();
                    }
                  }}
                />
                <CodeMenu input={replaceInput} codes={state.regex ? REPLACE_REGEX_CODES : REPLACE_PLAIN_CODES} onChange={(replacement) => update({ replacement })} />
                <button className="icon-button small" data-tip="Replace the chosen result (Enter)" disabled={!canReplace || shown.length === 0} onClick={replaceOne}>
                  <Replace size={15} />
                </button>
                <button className="icon-button small" data-tip="Replace all (⌘Enter)" data-tip-end disabled={!canReplace || hits.length === 0} onClick={replaceAll}>
                  <ReplaceAll size={15} />
                </button>
              </div>
            </div>
          )}
          <div className="search-meta">
            {!pick && (
              <select className="search-where" value={state.allBoards ? "all" : "board"} onChange={(event) => update({ allBoards: event.target.value === "all" })}>
                <option value="board">This board and below</option>
                <option value="all">All boards</option>
              </select>
            )}
            <span className={error !== null ? "search-error" : "muted"}>
              {error !== null ? "Not a correct regular expression." : query === "" ? "" : hits.length === 0 ? "No results" : count}
            </span>
            {readOnly && state.showReplace && !pick && <span className="muted">Read-only: replace is off.</span>}
          </div>
          {status !== null && (
            <div className="search-status">
              {status.map((sentence) => (
                <span key={sentence}>{sentence} </span>
              ))}
            </div>
          )}
        </div>
        <ul className="dialog-list" ref={list}>
          {shown.map((hit, position) => (
            <li key={`${hit.recordId}:${hit.field}:${hit.start}`} className={position === index ? "active" : undefined} onMouseEnter={() => setActive(position)} onClick={() => onOpen(hit, hit.match)}>
              <div className="primary search-hit-head">
                <span>
                  <span className="tag">{FIELD_LABEL[hit.field]}</span> <span translate="no">{recordTitle(hit)}</span>
                </span>
                {state.showReplace && canReplace && hit.field !== "page" && (
                  <button
                    className="icon-button small search-hit-replace"
                    data-tip="Replace"
                    data-tip-end
                    onClick={(event) => {
                      event.stopPropagation();
                      doReplace([hit]);
                    }}
                  >
                    <Replace size={13} />
                  </button>
                )}
              </div>
              <div className="secondary">
                <span translate="no">
                  <Excerpt hit={hit} replacement={state.showReplace && canReplace && hit.field !== "page" ? previewOf(hit.match) : null} />
                </span>
                <span className="path" translate="no">{hit.path.map((id) => titleOf(session.store, id)).join(" / ")}</span>
              </div>
            </li>
          ))}
        </ul>
      </MovablePanel>
    </div>
  );
}

function Toggle({ on, tip, onClick, children }: { on: boolean; tip: string; onClick(): void; children: ReactNode }) {
  return (
    <button className={`icon-button small search-toggle${on ? " active" : ""}`} data-tip={tip} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

/** The text near a hit, with the match marked. With a replacement: the match struck out, and the new text after it. */
function Excerpt({ hit, replacement }: { hit: SearchHit; replacement: string | null }) {
  const at = hit.excerpt.indexOf(hit.match.replace(/\s+/g, " "));
  if (at === -1) return <span>{hit.excerpt}</span>;
  const length = hit.match.replace(/\s+/g, " ").length;
  return (
    <span>
      {hit.excerpt.slice(0, at)}
      <mark className={replacement !== null ? "search-old" : undefined}>{visible(hit.match)}</mark>
      {replacement !== null && <ins className="search-new">{visible(replacement)}</ins>}
      {hit.excerpt.slice(at + length)}
    </span>
  );
}

/** A text with its line breaks and tabs shown ("¶", "→"). */
const visible = (text: string) => text.replace(/\r?\n/g, "¶").replace(/\t/g, "→");

type Code = { code: string; label: string };
const FIND_PLAIN_CODES: Code[] = [
  { code: "^p", label: "Line break (Enter)" },
  { code: "^t", label: "Tab" },
  { code: "^?", label: "Any character" },
  { code: "^#", label: "Any digit" },
  { code: "^$", label: "Any letter" },
  { code: "^^", label: "Caret (^)" },
];
const FIND_REGEX_CODES: Code[] = [
  { code: "\\n", label: "Line break (Enter)" },
  { code: "\\t", label: "Tab" },
  { code: ".", label: "Any character" },
  { code: "\\d", label: "Any digit" },
  { code: "\\p{L}", label: "Any letter" },
  { code: "^", label: "Start of a line" },
  { code: "$", label: "End of a line" },
];
const REPLACE_PLAIN_CODES: Code[] = [
  { code: "^p", label: "Line break (Enter)" },
  { code: "^t", label: "Tab" },
  { code: "^&", label: "The found text" },
  { code: "^^", label: "Caret (^)" },
];
const REPLACE_REGEX_CODES: Code[] = [
  { code: "\\n", label: "Line break (Enter)" },
  { code: "\\t", label: "Tab" },
  { code: "$&", label: "The found text" },
  { code: "$1", label: "Group 1" },
  { code: "$<name>", label: "A named group" },
  { code: "$$", label: "Dollar sign ($)" },
  { code: "\\\\", label: "Backslash (\\)" },
];

/** The special codes of a field ("¶"): a click puts the code in at the cursor. */
function CodeMenu({ input, codes, onChange }: { input: RefObject<HTMLInputElement | null>; codes: Code[]; onChange(value: string): void }) {
  const [open, setOpen] = useState(false);
  const put = (code: string) => {
    const field = input.current;
    if (field === null) return;
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;
    onChange(field.value.slice(0, start) + code + field.value.slice(end));
    setOpen(false);
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(start + code.length, start + code.length);
    });
  };
  return (
    <span className="search-codes">
      <button className={`icon-button small${open ? " active" : ""}`} data-tip="Special characters" onMouseDown={(event) => event.preventDefault()} onClick={() => setOpen((value) => !value)}>
        <Pilcrow size={14} />
      </button>
      {open && (
        <ul className="search-code-list" role="menu" onMouseDown={(event) => event.preventDefault()}>
          {codes.map(({ code, label }) => (
            <li key={code} role="menuitem" onClick={() => put(code)}>
              <code translate="no">{code}</code>
              <span>{label}</span>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

/** The selected text of the page, if it is short and on one line (it becomes the query). */
function selectedText(): string | null {
  const text = window.getSelection()?.toString() ?? "";
  return text.trim() !== "" && text.length <= 200 && !text.includes("\n") ? text : null;
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
