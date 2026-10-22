// Compare (lab plugin, capability "compare-text"): two items side by side, as in WinMerge. SPEC 7.15.
// - Each side is an item (its text), a passage (its words), or a saved web page or PDF (its text).
// - The plugin compares word by word: the layout (spaces, line breaks) does not count. This view shows the same
//   parts and the changes in rows, steps through the changes, and copies a change to the other side (only into a
//   text that the user can edit: a note, a page, a text card; one undo step each).

import { ArrowDown, ArrowLeft, ArrowLeftRight, ArrowRight, ArrowUp, Columns2, FileText, Rows3, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { replaceItemTexts } from "../../../core/actions";
import { passageRange, type PassageEnd } from "../../../core/linkEnds";
import type { Session } from "../../../io/session";
import { useRunCommand, useSession, useSessionState, useStoreRevision } from "../../app/sessionContext";
import { titleOf } from "../../board/boardModel";
import { htmlText } from "../../web/pageTexts";
import type { PlacedText } from "../../web/pdfText";
import { isLocalPath, isPdfPath, pagePath, pdfPath } from "../../web/savedPages";
import { OptionField } from "../PluginMenu";
import { usePlugins } from "../pluginsContext";
import { PdfPane, TextPane } from "./ComparePanes";
import { copyChange, flowText, marksOf, readChanges, rowsOf, shortened, type Change } from "./compareText";
import "../plugins.css";
import "./compare.css";

type Side = 0 | 1;

/**
 * The text of the saved copy of a link object: its web page or its PDF (`pdf`: with the place of each piece on the
 * pages). `error`: it has an address, but its copy cannot be read (the view says why; it never compares an empty text).
 */
type Saved = { text: string; kind: "PDF" | "Saved copy"; pdf?: PlacedText; error?: string };

async function loadSaved(session: Session, itemId: string): Promise<Saved | null> {
  const url = session.store.get("items", itemId)?.url?.trim();
  if (url === undefined || url === "") return null;
  const html = await session.readWebFile(pagePath(itemId)).catch(() => null);
  if (html !== null) return { text: htmlText(html), kind: "Saved copy" };
  try {
    let data = await session.readWebBytes(pdfPath(itemId)).catch(() => null);
    // A PDF file on this computer gets its copy in the vault when it first opens (as in the reader).
    if (data === null && isLocalPath(url) && isPdfPath(url)) {
      await session.importPdfFrom(url, itemId);
      data = await session.readWebBytes(pdfPath(itemId));
    }
    if (data === null) return { text: "", kind: "PDF", error: "It has no saved copy yet: open it once (double-click its card), then compare again." };
    const { pdfPlacedText } = await import("../../web/pdfText");
    const pdf = await pdfPlacedText(data);
    return { text: pdf.text, kind: "PDF", pdf };
  } catch (problem) {
    return { text: "", kind: "PDF", error: `Its PDF could not be read: ${String(problem).replace(/^Error: /, "")}` };
  }
}

/**
 * The text of one side. `write`: the new body of its item (and its new end) for a new text, or null if it cannot
 * change here. `flow`: its line breaks are layout (a PDF or a saved page): they show as spaces. `pdf`: a saved PDF.
 */
type Source = { text: string; kind: string; write: ((text: string) => { body: string; end: PassageEnd }) | null; flow: boolean; pdf?: PlacedText; error?: string };

function sourceOf(session: Session, end: PassageEnd, saved: Saved | null | undefined, readOnly: boolean): Source {
  const item = session.store.get("items", end.itemId);
  if (item === undefined) return { text: "", kind: "Missing item", write: null, flow: false };
  const body = session.store.get("texts", end.itemId)?.body ?? "";
  if (end.quote !== undefined && end.quote !== "") {
    const range = passageRange(body, end);
    if (range === null) return { text: end.quote, kind: "Passage", write: null, flow: false };
    return {
      text: body.slice(range.from, range.to),
      kind: "Passage",
      flow: false,
      write: readOnly ? null : (text) => ({ body: body.slice(0, range.from) + text + body.slice(range.to), end: { ...end, quote: text, range: { from: range.from, to: range.from + text.length } } }),
    };
  }
  // A link object with a saved page or PDF: its text (it cannot change).
  if (item.url !== undefined && item.url !== "" && saved != null) return { text: saved.text, kind: saved.kind, write: null, flow: true, pdf: saved.pdf, error: saved.error };
  return { text: body, kind: "Text", write: readOnly ? null : (text) => ({ body: text, end }), flow: false };
}

export function CompareView({ left, right, onClose }: { left: PassageEnd; right: PassageEnd; onClose(): void }) {
  const session = useSession();
  const { readOnly } = useSessionState();
  const runCommand = useRunCommand();
  useStoreRevision();
  const plugins = usePlugins();
  const plugin = plugins.plugins.find((entry) => entry.details !== null && entry.capabilities.includes("compare-text")) ?? null;
  const [ends, setEnds] = useState<[PassageEnd, PassageEnd]>([left, right]);
  // The text of each side with a saved copy: undefined while it loads, null if it has none.
  const [saved, setSaved] = useState<[Saved | null | undefined, Saved | null | undefined]>([undefined, undefined]);
  const [result, setResult] = useState<{ texts: [string, string]; changes: Change[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  // The same parts that show whole (the user opened them).
  const [opened, setOpened] = useState<ReadonlySet<number>>(new Set());
  // "rows": the texts side by side; "pages": each side in its own pane, a PDF with its pages (only with a PDF side).
  const [mode, setMode] = useState<"rows" | "pages">("rows");
  const scroller = useRef<HTMLDivElement>(null);

  const leftId = ends[0].itemId;
  const rightId = ends[1].itemId;
  useEffect(() => {
    let stale = false;
    setSaved([undefined, undefined]);
    void Promise.all([loadSaved(session, leftId), loadSaved(session, rightId)]).then(([a, b]) => !stale && setSaved([a, b]));
    return () => {
      stale = true;
    };
  }, [session, leftId, rightId]);

  const sources: [Source, Source] = [sourceOf(session, ends[0], saved[0], readOnly), sourceOf(session, ends[1], saved[1], readOnly)];
  const sideError = sources[0].error ?? sources[1].error ?? null;
  const loading = saved[0] === undefined || saved[1] === undefined || sideError !== null;
  const options = useMemo(() => {
    const defaults = Object.fromEntries((plugin?.details?.options ?? []).map((option) => [option.key, option.default]));
    return { ...defaults, ...(plugin === null ? {} : plugins.optionsOf(plugin.name)) };
  }, [plugin, plugins]);
  const optionsKey = JSON.stringify(options);

  // Compare again when a text or an option changes (after a copy too). A short wait joins quick changes.
  const [textLeft, textRight] = [sources[0].text, sources[1].text];
  useEffect(() => {
    if (plugin === null || loading) return;
    let stale = false;
    const timer = window.setTimeout(() => {
      plugins
        .callWithProgress(plugin.name, "compare", { left: textLeft, right: textRight, options }, true)
        .then((reply) => {
          if (stale) return;
          setResult({ texts: [textLeft, textRight], changes: readChanges(reply, textLeft.length, textRight.length) });
          setError(null);
        })
        .catch((problem: unknown) => !stale && setError(String(problem).replace(/^Error: /, "")));
    }, 120);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugin?.name, loading, textLeft, textRight, optionsKey]);

  const rows = useMemo(() => (result === null ? [] : rowsOf(result.texts[0], result.texts[1], result.changes)), [result]);
  const count = result?.changes.length ?? 0;
  const shown = Math.min(current, Math.max(0, count - 1));
  const hasPdf = sources[0].pdf !== undefined || sources[1].pdf !== undefined;
  const panes = hasPdf && mode === "pages";
  const marks = useMemo(() => (result === null ? null : ([marksOf(result.changes, "left"), marksOf(result.changes, "right")] as const)), [result]);

  /** Shows a change: in rows, its row; in panes, its place in each pane (the first box of it on a page). */
  const reveal = (index: number, behavior: ScrollBehavior) => {
    const containers = scroller.current?.querySelectorAll(".compare-pane") ?? [];
    for (const container of containers.length > 0 ? [...containers] : scroller.current === null ? [] : [scroller.current]) {
      container.querySelector(`[data-change="${index}"]`)?.scrollIntoView({ block: "center", behavior });
    }
  };
  const go = (index: number) => {
    if (count === 0) return;
    const next = (index + count) % count;
    setCurrent(next);
    reveal(next, "smooth");
  };
  // After a switch of the view: the current change is in view. (The pages draw later; the boxes are there at once.)
  const shownForSwitch = useRef(shown);
  shownForSwitch.current = shown;
  useEffect(() => {
    const frame = requestAnimationFrame(() => reveal(shownForSwitch.current, "auto"));
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panes]);

  // Esc closes. Alt+↓ and Alt+↑: the next and the previous change (as in WinMerge).
  const goRef = useRef(go);
  goRef.current = go;
  const shownRef = useRef(shown);
  shownRef.current = shown;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      } else if (event.altKey && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        goRef.current(shownRef.current + (event.key === "ArrowDown" ? 1 : -1));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  /** Copies a change from one side to the other side. One undo step. */
  const copy = (index: number, from: Side) => {
    const to: Side = from === 0 ? 1 : 0;
    const target = sources[to];
    const change = result?.changes[index];
    if (target.write === null || change === undefined) return;
    const { body, end } = target.write(copyChange(change, result!.texts[from], result!.texts[to], from === 0 ? "left" : "right"));
    const item = session.store.get("items", end.itemId);
    if (item === undefined) return;
    if (!runCommand(replaceItemTexts(session.context, [{ id: item.id, name: item.name, body }], "Copy difference"))) return;
    setEnds((currentEnds) => (to === 0 ? [end, currentEnds[1]] : [currentEnds[0], end]));
  };

  const shownText = (side: Side, text: string) => (sources[side].flow ? flowText(text) : text);

  const head = (side: Side) => (
    <div className="compare-head">
      <span className="compare-name" dir="auto">{titleOf(session.store, ends[side].itemId)}</span>
      <span className="compare-kind">{sources[side].kind}</span>
      {sources[side].write === null && <span className="compare-kind">Read-only</span>}
    </div>
  );

  const status =
    sideError !== null
      ? ""
      : saved[0] === undefined || saved[1] === undefined
        ? "Reading the texts…"
        : result === null
          ? error === null
            ? "Comparing…"
            : ""
          : textLeft.trim() === "" && textRight.trim() === ""
            ? "Both sides have no text"
            : count === 0
              ? "The texts are the same"
              : `Difference ${shown + 1} of ${count}`;

  return (
    <div className="compare-view" role="dialog" aria-label="Compare">
      <div className="compare-bar">
        <Columns2 size={15} />
        <span className="compare-title">Compare</span>
        <span className="plugin-lab" data-tip="Experimental: it can change or go away.">Lab</span>
        <span className="divider" />
        <button className="icon-button small" data-tip="Previous difference (Alt+↑)" disabled={count === 0} onClick={() => go(shown - 1)}>
          <ArrowUp size={14} />
        </button>
        <button className="icon-button small" data-tip="Next difference (Alt+↓)" disabled={count === 0} onClick={() => go(shown + 1)}>
          <ArrowDown size={14} />
        </button>
        <span className="compare-count">{status}</span>
        <span className="divider" />
        {plugin?.details?.options.map((option) => (
          <OptionField key={option.key} option={option} value={options[option.key] ?? option.default} onChange={(value) => plugins.setOption(plugin.name, option.key, value)} />
        ))}
        <span className="compare-space" />
        {hasPdf && (
          <div className="segmented small">
            <button className={mode === "rows" ? "active" : ""} data-tip="The texts side by side" onClick={() => setMode("rows")}>
              <Rows3 size={14} /> Text
            </button>
            <button className={mode === "pages" ? "active" : ""} data-tip="The PDF pages, with the changes on them" onClick={() => setMode("pages")}>
              <FileText size={14} /> PDF pages
            </button>
          </div>
        )}
        <button className="icon-button small" data-tip="Swap the two sides" onClick={() => setEnds(([a, b]) => [b, a])}>
          <ArrowLeftRight size={14} />
        </button>
        <button className="icon-button small" data-tip="Close (Esc)" data-tip-end onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      {plugin === null && <div className="compare-message">The compare plugin is not installed.</div>}
      {error !== null && <div className="compare-message error">{error}</div>}
      {([0, 1] as const).map((side) =>
        sources[side].error === undefined ? null : (
          <div key={side} className="compare-message error">{`${titleOf(session.store, ends[side].itemId)}: ${sources[side].error}`}</div>
        ),
      )}
      <div className="compare-heads">
        {head(0)}
        <span />
        {head(1)}
      </div>
      {panes ? (
        <div className="compare-panes" ref={scroller}>
          {([0, 1] as const).map((side) => {
            const source = sources[side];
            if (marks === null || result === null) return <div key={side} className="compare-pane" />;
            return source.pdf !== undefined ? (
              <PdfPane key={side} itemId={ends[side].itemId} pdf={source.pdf} marks={marks[side]} current={shown} onPick={setCurrent} />
            ) : (
              <TextPane key={side} text={result.texts[side]} flow={source.flow} marks={marks[side]} current={shown} onPick={setCurrent} />
            );
          })}
        </div>
      ) : (
      <div className="compare-rows" ref={scroller}>
        {rows.map((row, index) => {
          if (row.kind === "change") {
            const isCurrent = row.change === shown;
            const kind = row.left === "" ? "added" : row.right === "" ? "removed" : "changed";
            return (
              <div key={index} className={`compare-row change ${kind}${isCurrent ? " current" : ""}`} data-change={row.change} onClick={() => setCurrent(row.change)}>
                <span className={`compare-cell${row.left === "" ? " filler" : ""}`} dir="auto">
                  {shownText(0, row.left)}
                </span>
                <span className="compare-gutter">
                  {sources[1].write !== null && (
                    <button className="icon-button tiny" data-tip="Copy to the right" onClick={() => copy(row.change, 0)}>
                      <ArrowRight size={12} />
                    </button>
                  )}
                  {sources[0].write !== null && (
                    <button className="icon-button tiny" data-tip="Copy to the left" onClick={() => copy(row.change, 1)}>
                      <ArrowLeft size={12} />
                    </button>
                  )}
                </span>
                <span className={`compare-cell${row.right === "" ? " filler" : ""}`} dir="auto">
                  {shownText(1, row.right)}
                </span>
              </div>
            );
          }
          // A same part: a long one shows only its ends near the changes, until the user opens it.
          const texts = [shownText(0, row.left), shownText(1, row.right)] as const;
          const short = opened.has(index) ? [null, null] : texts.map((text) => shortened(text, index > 0, index < rows.length - 1));
          const hidden = Math.max(short[0]?.hidden ?? 0, short[1]?.hidden ?? 0);
          return (
            <div key={index} className="compare-row same">
              {([0, 1] as const).map((side) => {
                const part = short[side] ?? null;
                return (
                  <span key={side} className="compare-cell" dir="auto" style={{ gridColumn: side === 0 ? 1 : 3 }}>
                    {part === null ? texts[side] : `${part.head}${part.head === "" ? "" : " …"}${part.tail === "" ? "" : "… "}${part.tail}`}
                  </span>
                );
              })}
              {hidden > 0 && (
                <button className="compare-more" onClick={() => setOpened((set) => new Set(set).add(index))}>
                  {`Show ${hidden} more words that are the same`}
                </button>
              )}
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}
