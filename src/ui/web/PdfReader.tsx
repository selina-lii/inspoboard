// The reader for a saved PDF (web/<key>.pdf). See docs/SPEC.md section 7.8.
// - PDF.js draws each page (when it comes into view) and a text layer over it (selectable, readable text).
// - The pages are on the reader canvas (margins, zoom; see readerShared.tsx). Page units are PDF units (scale 1).
//   A zoom shows at once (CSS scale); the pages draw again at the new scale after a short pause.
// - Read tool: a click on text reads aloud from there. Highlight, pen, eraser, comments, and notes go to
//   web/<key>.notes.json (the PDF never changes).
// - PDF.js loads its data files from public/pdfjs (no network). Scripts in PDFs never run.

import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { COLUMN, firstTop, pageParagraphs, TranslationColumn, useColumnWidth, usePageTranslation } from "./pageTranslation";
import { pageCounterpart } from "../plugins/sentencePairs";
import { useSession, useSessionState } from "../app/sessionContext";
import { reportPassage } from "../app/passages";
import { ReaderLinks, useLinkMarks } from "./linkMarks";
import { usePlugins } from "../plugins/pluginsContext";
import { useSpeech, useSpokenSentence, WEB_SOURCE, type ReadMode } from "../plugins/speech";
import { findQuote, placeHighlight, type NoteColor } from "./savedPages";
import type { TextAnchor } from "../app/smallTool";
import { boxesOf, clampZoom, readyMarkOf, FindBar, marginOf, ReaderSheet, ReaderTools, usePageFind, useReaderKeys, useReaderNotes, type Box, type Mark, type PageFind, type ReaderMode, type SheetApi } from "./readerShared";
import { indexPdfText, offsetAt, rangeOf, type TextIndex } from "./webText";
import { useWebPages, type PdfPage } from "./WebPages";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Space between pages, at scale 1. */
const PAGE_GAP = 14;

type Props = { page: PdfPage; onClose(): void; onSaveAgain?: () => void };

export function PdfReader({ page, onClose, onSaveAgain }: Props) {
  const { readOnly, settings } = useSessionState();
  const session = useSession();
  const speech = useSpeech();
  const plugins = usePlugins();
  const sheet = useRef<SheetApi | null>(null);
  const pages = useRef<HTMLDivElement>(null);
  const index = useRef<TextIndex | null>(null);
  /** The zoom that shows, and the scale at which the pages are drawn. */
  const [zoom, setZoom] = useState<number | null>(null);
  const [renderScale, setRenderScale] = useState<number | null>(null);
  const [ready, setReady] = useState(0);
  /** The size of all pages at scale 1. */
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [, setTextSides] = useState<{ left: number; right: number } | null>(null);
  const [title, setTitle] = useState(page.title);
  const [failure, setFailure] = useState<string | null>(null);
  const [mode, setModeNow] = useState<ReaderMode>("select");
  // The comment and note tools make one item per click, as the board tools. A double-click keeps them on.
  const [modeSticky, setModeSticky] = useState(false);
  const setMode = useCallback((next: ReaderMode, keep = false) => {
    setModeNow(next);
    setModeSticky(keep);
  }, []);
  const [color, setColor] = useState<NoteColor>("yellow");
  const { notes, notesRef, change, step, problem } = useReaderNotes(page.key, page.notesFrom);
  /** The selected text of the PDF (its place in the PDF text), for a new small item that points to it. */
  const selectedText = useRef<TextAnchor | null>(null);
  const sourceId = WEB_SOURCE + page.key;
  const spoken = useSpokenSentence(sourceId);
  const speaker = plugins.plugins.find((plugin) => plugin.details !== null && plugin.capabilities.includes("speak-text")) ?? null;
  // The translation column (pageTranslation.tsx): one paragraph for each line of the page text.
  const paragraphs = useMemo(() => pageParagraphs(index.current?.text ?? ""), [ready]);
  const translation = usePageTranslation(page.key, paragraphs);
  const [columnHeight, setColumnHeight] = useState(0);
  const column = useColumnWidth();
  const columnWidth = translation.texts === null ? 0 : COLUMN.gap + column.width;
  // The sentence of the translation that matches the sentence read aloud.
  const spokenPair = spoken === null || translation.texts === null ? null : pageCounterpart(paragraphs, translation.texts, spoken.sentence.start);
  const shownZoom = zoom ?? 1;
  const margin = marginOf(size.w);
  const zoomRef = useRef(shownZoom);
  zoomRef.current = shownZoom;
  const live = useRef({ speech, speaker });
  live.current = { speech, speaker };

  const fitZoom = useCallback(
    () => clampZoom(((sheet.current?.viewWidth() ?? 900) - 48) / Math.max(1, size.w + columnWidth)),
    [size.w, columnWidth],
  );
  /** Fits the page (and the translation column) to the width, and scrolls to the page (the margins are at its sides). */
  const [fitCount, setFitCount] = useState(0);
  const fitPage = useCallback(() => {
    setZoom(fitZoom());
    setFitCount((count) => count + 1);
  }, [fitZoom]);

  // The document, and the size of its pages at scale 1.
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [layout, setLayout] = useState<{ top: number; w: number; h: number }[]>([]);
  useEffect(() => {
    let cancelled = false;
    const task = pdfjs.getDocument({
      data: new Uint8Array(page.data.slice(0)),
      cMapUrl: "/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdfjs/standard_fonts/",
      wasmUrl: "/pdfjs/wasm/",
      iccUrl: "/pdfjs/iccs/",
    });
    task.promise
      .then(async (loaded) => {
        if (cancelled) return;
        const info = (await loaded.getMetadata().catch(() => null))?.info as { Title?: string } | undefined;
        if (typeof info?.Title === "string" && info.Title.trim() !== "") setTitle(info.Title.trim());
        const boxes: { top: number; w: number; h: number }[] = [];
        let top = 0;
        let width = 0;
        for (let number = 1; number <= loaded.numPages && !cancelled; number += 1) {
          const viewport = (await loaded.getPage(number)).getViewport({ scale: 1 });
          boxes.push({ top, w: viewport.width, h: viewport.height });
          top += viewport.height + PAGE_GAP;
          width = Math.max(width, viewport.width);
        }
        if (cancelled) return;
        setLayout(boxes);
        setSize({ w: width, h: Math.max(1, top - PAGE_GAP) });
        setDoc(loaded);
      })
      .catch((error: unknown) => !cancelled && setFailure(`The PDF could not open: ${String(error)}`));
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [page]);

  // The first zoom fits the width. Later, the pages draw again at the zoom after a short pause.
  useEffect(() => {
    if (zoom === null && size.w > 0) fitPage();
  }, [zoom, size.w, fitPage]);
  useEffect(() => {
    if (zoom === null) return;
    const timer = window.setTimeout(() => setRenderScale(zoom), renderScale === null ? 0 : 250);
    return () => window.clearTimeout(timer);
  }, [zoom, renderScale]);

  // Pages: a box, a text layer (now), and a canvas (when the page comes into view).
  useEffect(() => {
    const container = pages.current;
    if (doc === null || renderScale === null || container === null) return;
    let cancelled = false;
    const scale = renderScale;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const draw = (entry.target as HTMLElement & { draw?: () => void }).draw;
          observer.unobserve(entry.target);
          draw?.();
        }
      },
      { rootMargin: "800px 0px" },
    );
    container.replaceChildren();
    void (async () => {
      for (let number = 1; number <= doc.numPages && !cancelled; number += 1) {
        const pdfPage = await doc.getPage(number);
        const viewport = pdfPage.getViewport({ scale });
        const box = document.createElement("div") as HTMLDivElement & { draw?: () => void };
        box.className = "pdf-page";
        box.style.width = `${viewport.width}px`;
        box.style.height = `${viewport.height}px`;
        box.style.top = `${(layout[number - 1]?.top ?? 0) * scale}px`;
        box.style.setProperty("--scale-factor", String(scale));
        box.style.setProperty("--total-scale-factor", String(scale));
        box.style.setProperty("--user-unit", "1");
        const canvas = document.createElement("canvas");
        const layer = document.createElement("div");
        layer.className = "textLayer";
        box.append(canvas, layer);
        container.append(box);
        box.draw = () => {
          const ratio = window.devicePixelRatio || 1;
          canvas.width = Math.floor(viewport.width * ratio);
          canvas.height = Math.floor(viewport.height * ratio);
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          void pdfPage.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] }).promise.catch(() => undefined);
        };
        observer.observe(box);
        await new pdfjs.TextLayer({ textContentSource: pdfPage.streamTextContent(), container: layer, viewport }).render();
      }
      if (cancelled) return;
      index.current = indexPdfText(container);
      // The left and right edge of the text (for the automatic margin), at scale 1.
      const origin = container.getBoundingClientRect();
      const factor = zoomRef.current;
      let left = Infinity;
      let right = -Infinity;
      for (const span of container.querySelectorAll(".textLayer span")) {
        const rect = span.getBoundingClientRect();
        if (rect.width < 1) continue;
        left = Math.min(left, (rect.left - origin.left) / factor);
        right = Math.max(right, (rect.right - origin.left) / factor);
      }
      setTextSides(Number.isFinite(left) ? { left, right } : null);
      setReady((count) => count + 1);
    })().catch((error: unknown) => !cancelled && setFailure(String(error)));
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [doc, renderScale, layout]);

  // Find in page (⌘F): the hook needs the mark boxes (below), the keys need it here.
  const findRef = useRef<PageFind | null>(null);
  useReaderKeys({
    mode,
    find: () => findRef.current?.show(),
    step,
    zoomBy: (factor) => setZoom((value) => clampZoom((value ?? 1) * factor)),
    fit: () => fitPage(),
    setMode,
  });

  const [notice, setNotice] = useState<string | null>(null);
  const readFrom = useCallback(
    (offset: number, until?: number) => {
      const { speech: reader, speaker: plugin } = live.current;
      const text = index.current?.text ?? "";
      if (reader === null || plugin === null) {
        setNotice("Read aloud needs the Read aloud plugin (Settings → Plugins).");
        return;
      }
      if (text.trim() === "") {
        setNotice(index.current === null ? "The PDF is not ready yet." : "This PDF has no text to read (it can be scanned images).");
        return;
      }
      setNotice(null);
      if (until === undefined && reader.state?.sourceId === sourceId && !reader.state.preparing && reader.state.until === undefined) reader.seekToOffset(offset);
      else void reader.readText(plugin.name, sourceId, text, offset, undefined, until);
    },
    [sourceId],
  );

  const web = useWebPages();
  /** The selected text of the PDF: its range in the PDF text, or null. */
  const selectedRange = useCallback((): { start: number; end: number } | null => {
    const selection = window.getSelection();
    const range = selection !== null && selection.rangeCount > 0 && !selection.isCollapsed ? selection.getRangeAt(0) : null;
    if (range === null || pages.current?.contains(range.startContainer) !== true || index.current === null) return null;
    const start = offsetAt(index.current, range.startContainer, range.startOffset);
    const end = offsetAt(index.current, range.endContainer, range.endOffset);
    return start === null || end === null || end <= start ? null : { start, end };
  }, []);
  /** "Read aloud" in the plugin menu: from the start, the selected text only, or from the selected text on. */
  const read = useCallback(
    (mode: ReadMode) => {
      const range = mode === "start" ? null : selectedRange();
      readFrom(range?.start ?? 0, mode === "selection" ? range?.end : undefined);
    },
    [readFrom, selectedRange],
  );
  useEffect(() => {
    if (web === null) return;
    const textToRead = () => {
      const selection = window.getSelection();
      const range = selection !== null && selection.rangeCount > 0 && !selection.isCollapsed ? selection.getRangeAt(0) : null;
      const inside = range !== null && pages.current?.contains(range.startContainer) === true;
      const text = index.current?.text ?? "";
      const offset = inside && index.current !== null ? offsetAt(index.current, range.startContainer, range.startOffset) : null;
      return { text: offset === null ? text : text.slice(offset), fromSelection: offset !== null };
    };
    const api = { read, hasSelection: () => selectedRange() !== null, textToRead, translate: (plugin: string) => void translation.run(plugin), hideTranslation: translation.hide, translated: translation.shown };
    web.reader.current = api;
    return () => {
      if (web.reader.current === api) web.reader.current = null;
    };
  }, [web, read, selectedRange, translation]);
  // The column shows or goes: fit the width again.
  const hadColumn = useRef(columnWidth > 0);
  useEffect(() => {
    if (hadColumn.current === columnWidth > 0) return;
    hadColumn.current = columnWidth > 0;
    fitPage();
  }, [columnWidth, fitZoom]);

  const autoRead = useRef(page.autoRead === true);
  useEffect(() => {
    if (!autoRead.current || ready === 0) return;
    autoRead.current = false;
    readFrom(0);
  }, [ready, readFrom]);

  // Marks: boxes in page units (scale 1, from the top left of the pages).
  const boxes = useCallback((start: number, end: number): Box[] => {
    const range = index.current === null ? null : rangeOf(index.current, start, end);
    const container = pages.current;
    if (range === null || container === null) return [];
    const origin = container.getBoundingClientRect();
    return boxesOf(range, { x: origin.left, y: origin.top }, zoomRef.current);
  }, []);
  const highlightMarks = useMemo<Mark[]>(() => {
    if (index.current === null) return [];
    return notes.highlights.flatMap((highlight) => {
      const placed = placeHighlight(index.current!.text, highlight);
      return placed === null ? [] : [{ id: highlight.id, color: highlight.color, boxes: boxes(placed.start, placed.end) }];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes.highlights, ready, boxes]);
  const spokenStart = spoken?.sentence.start ?? null;
  const spokenEnd = spoken?.sentence.end ?? null;
  const spokenMark = useMemo<Mark | null>(
    () => (spokenStart === null || spokenEnd === null ? null : { id: "spoken", color: "spoken", boxes: boxes(spokenStart, spokenEnd) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spokenStart, spokenEnd, ready, boxes],
  );
  const pageText = useMemo(() => index.current?.text ?? "", [ready]);
  const find = usePageFind(pageText, boxes);
  findRef.current = find;
  // A search hit in this PDF (board search): find its text when the PDF is ready.
  useEffect(() => {
    if (ready && page.find !== undefined && page.find !== "") find.show(page.find);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, page]);
  const linkMarks = useLinkMarks(page.itemId, pageText, boxes, ready);
  // The "ready" cursor of read aloud (where the ready audio ends), if the setting shows it.
  const readyMark = readyMarkOf(useSpeech()?.state, sourceId, settings.speechShowReady, boxes);
  const marks = [...highlightMarks, ...linkMarks.marks, ...(spokenMark === null ? [] : [spokenMark]), ...(readyMark === null ? [] : [readyMark]), ...find.marks];

  const onClick = (event: React.MouseEvent) => {
    // ⌘-click on a linked passage (dotted line): go to the other end of its link.
    if ((event.metaKey || event.ctrlKey) && index.current !== null) {
      const at = document.caretRangeFromPoint(event.clientX, event.clientY);
      const offset = at === null ? null : offsetAt(index.current, at.startContainer, at.startOffset);
      if (offset !== null && linkMarks.follow(offset)) {
        event.preventDefault();
        return;
      }
    }
    if (mode !== "select") return;
    const selection = window.getSelection();
    if (selection !== null && !selection.isCollapsed) return;
    const caret = document.caretRangeFromPoint(event.clientX, event.clientY);
    const offset = caret === null || index.current === null ? null : offsetAt(index.current, caret.startContainer, caret.startOffset);
    // Only while it reads this PDF (Read aloud started it): the click moves the reading there. Else a click does not read.
    if (offset !== null && speech?.state?.sourceId === sourceId && !speech.state.preparing) speech.clickSeek(offset);
  };

  /** The link bench can take the selected passage (its text in the PDF text, as the marks find it again). */
  const reportPdfPassage = () => {
    const pageItem: string | undefined = page.itemId;
    if (pageItem === undefined || index.current === null) return;
    const selection = window.getSelection();
    const range = selection !== null && selection.rangeCount > 0 && !selection.isCollapsed ? selection.getRangeAt(0) : null;
    if (range === null || pages.current?.contains(range.startContainer) !== true) {
      selectedText.current = null;
      reportPassage(null, pageItem);
      return;
    }
    const start = offsetAt(index.current, range.startContainer, range.startOffset);
    const end = offsetAt(index.current, range.endContainer, range.endOffset);
    selectedText.current = start !== null && end !== null && end > start ? { text: index.current.text.slice(start, end), at: start } : null;
    if (start !== null && end !== null && end > start) reportPassage({ itemId: pageItem, quote: index.current.text.slice(start, end) });
  };

  const onMouseUp = () => {
    reportPdfPassage();
    if (mode !== "highlight" || readOnly || index.current === null) return;
    const selection = window.getSelection();
    if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const start = offsetAt(index.current, range.startContainer, range.startOffset);
    const end = offsetAt(index.current, range.endContainer, range.endOffset);
    if (start === null || end === null || end <= start) return;
    const current = notesRef.current;
    change({ ...current, highlights: [...current.highlights, { id: nanoid(10), start, end, quote: index.current.text.slice(start, end), color }] });
    selection.removeAllRanges();
  };

  return (
    <div className="web-reader pdf-reader">
      <FindBar find={find} />
      <ReaderTools
        selection={() => selectedText.current}
        title={title}
        url={page.url}
        mode={mode}
        color={color}
        readOnly={readOnly}
        zoom={shownZoom}
        onMode={setMode}
        sticky={modeSticky}
        onColor={setColor}
        onClose={onClose}
        onStep={step}
        onZoom={(value) => setZoom(clampZoom(value))}
        onFit={() => fitPage()}
        onSaveAgain={onSaveAgain}
        extra={<ReaderLinks itemId={page.itemId} />}
      />
      {(problem ?? failure ?? notice) !== null && <div className="plugin-error web-reader-problem">{problem ?? failure ?? notice}</div>}
      <ReaderSheet
        homeId={page.itemId}
        fitKey={fitCount}
        anchorBox={(quote, at) => {
          const found = index.current === null ? null : findQuote(index.current.text, quote, at ?? 0);
          return found === null ? null : (boxes(found.start, found.end).at(-1) ?? null);
        }}
        className="pdf-scroller"
        pageWidth={size.w}
        pageHeight={size.h}
        zoom={shownZoom}
        margin={margin}
        mode={mode}
        color={color}
        readOnly={readOnly}
        notes={notes}
        change={change}
        marks={marks}
        focus={spokenMark?.boxes[0] ?? null}
        findFocus={find.focus}
          onTyping={() => (mode === "comment" || mode === "note") && setMode("select")}
          onPlaced={() => !modeSticky && setMode("select")}
        onZoom={(value) => setZoom(value)}
        apiRef={sheet}
        side={
          translation.texts === null
            ? null
            : {
                width: column.width,
                gap: COLUMN.gap,
                height: columnHeight,
                render: (left) => (
                  <TranslationColumn
                    left={left}
                    paragraphs={paragraphs}
                    texts={translation.texts!}
                    topOf={(paragraph) => firstTop(boxes(paragraph.start, Math.min(paragraph.end, paragraph.start + 1)))}
                    layoutKey={`${ready}:${size.h}`}
                    onHeight={setColumnHeight}
                    width={column.width}
                    zoom={shownZoom}
                    onWidth={column.onWidth}
                    spoken={spokenPair}
                  />
                ),
              }
        }
      >
        <div
          ref={pages}
          className={`pdf-pages${settings.readerInvert ? " inverted" : ""}`}
          style={{ transform: renderScale === null || renderScale === shownZoom ? undefined : `scale(${shownZoom / renderScale})` }}
          onClick={onClick}
          onMouseUp={onMouseUp}
        />
      </ReaderSheet>
      {zoom === null && failure === null && <div className="pdf-loading muted">Opening the PDF…</div>}
    </div>
  );
}
