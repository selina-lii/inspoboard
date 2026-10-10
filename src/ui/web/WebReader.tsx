// The reader for a saved web page. See docs/SPEC.md section 7.8.
// - The page shows in a frame at a fixed width (saved in the notes), as tall as the page: the frame does not scroll.
//   The canvas around it scrolls and zooms (the page does not flow again), and has a margin at each side.
// - The page has no scripts (the plugin removes them, and the page CSP blocks them). The frame allows scripts only
//   because WebKit runs no event listener of the reader in a frame without that permission.
// Tools (in the main tool bar): read (a click on text reads aloud from there), select, highlight, pen, eraser, comment, note.
// Links: ⌘-click (Ctrl-click) saves and opens the linked page. A click on a "#" link goes to that part of the page.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { COLUMN, firstTop, pageParagraphs, TranslationColumn, useColumnWidth, usePageTranslation } from "./pageTranslation";
import { pageCounterpart } from "../plugins/sentencePairs";
import { nanoid } from "nanoid";
import { useSessionState } from "../app/sessionContext";
import { offerSelection } from "../plugins/SelectionTranslate";
import { usePlugins } from "../plugins/pluginsContext";
import { useSpeech, useSpokenSentence, WEB_SOURCE } from "../plugins/speech";
import { useWebPages, type HtmlPage } from "./WebPages";
import { isWebUrl, placeHighlight, WIDTH_RANGE, type NoteColor, type WebNotes } from "./savedPages";
import { boxesOf, clampZoom, FindBar, marginOf, readerKey, ReaderSheet, ReaderTools, usePageFind, useReaderKeys, useReaderNotes, type Box, type Mark, type PageFind, type ReaderMode, type SheetApi } from "./readerShared";
import { indexText, offsetAt, rangeOf, type TextIndex } from "./webText";

/** Styles inside the page: no scroll (the canvas scrolls), and cursors for the tools. */
const FRAME_STYLE = `
html, body { overflow: hidden !important; }
html.inspoboard-read body { cursor: text; }
`;
/** A page taller than this is cut (a page that grows with its frame). */
const MAX_HEIGHT = 200000;

type Props = { page: HtmlPage; onClose(): void; onSaveAgain(): void };

export function WebReader({ page, onClose, onSaveAgain }: Props) {
  const { readOnly } = useSessionState();
  const speech = useSpeech();
  const plugins = usePlugins();
  const web = useWebPages();
  const frame = useRef<HTMLIFrameElement>(null);
  const sheet = useRef<SheetApi | null>(null);
  const index = useRef<TextIndex | null>(null);
  const [loaded, setLoaded] = useState(0);
  const [mode, setModeNow] = useState<ReaderMode>("read");
  // The comment and note tools make one item per click, as the board tools. A double-click keeps them on.
  const [modeSticky, setModeSticky] = useState(false);
  const setMode = useCallback((next: ReaderMode, keep = false) => {
    setModeNow(next);
    setModeSticky(keep);
  }, []);
  const [color, setColor] = useState<NoteColor>("yellow");
  const { notes, notesRef, loaded: notesLoaded, change: changeNotes, step, problem } = useReaderNotes(page.key);
  const [title, setTitle] = useState("");
  const [height, setHeight] = useState(2000);
  const [textSides, setTextSides] = useState<{ left: number; right: number } | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const sourceId = WEB_SOURCE + page.key;
  const spoken = useSpokenSentence(sourceId);
  const speaker = plugins.plugins.find((plugin) => plugin.details !== null && plugin.capabilities.includes("speak-text")) ?? null;
  // The translation column (pageTranslation.tsx): one paragraph for each line of the page text.
  const paragraphs = useMemo(() => pageParagraphs(index.current?.text ?? ""), [loaded]);
  const translation = usePageTranslation(page.key, paragraphs);
  const [columnHeight, setColumnHeight] = useState(0);
  const column = useColumnWidth();
  const columnWidth = translation.texts === null ? 0 : COLUMN.gap + column.width;
  // The sentence of the translation that matches the sentence read aloud.
  const spokenPair = spoken === null || translation.texts === null ? null : pageCounterpart(paragraphs, translation.texts, spoken.sentence.start);

  // The page width: saved in the notes; the first time, from the size of the reader.
  const [defaultWidth] = useState(() => Math.round(Math.min(1100, Math.max(720, window.innerWidth - 2 * 260 - 80))));
  const width = notes.width ?? defaultWidth;
  const margin = marginOf(notes.margin, width, textSides);
  // Each change keeps the page width, so that the page flows the same next time.
  const change = useCallback((next: WebNotes) => changeNotes({ ...next, width: next.width ?? width }), [changeNotes, width]);

  const fitZoom = useCallback(() => clampZoom(Math.min(1, ((sheet.current?.viewWidth() ?? window.innerWidth) - 48) / (width + 2 * margin + columnWidth))), [width, margin, columnWidth]);
  useEffect(() => {
    if (zoom === null && notesLoaded) setZoom(fitZoom());
  }, [zoom, notesLoaded, fitZoom]);
  const shownZoom = zoom ?? 1;

  // The newest values for the frame event handlers (they are added one time per load).
  const live = useRef({ mode, color, speech, speaker, change, step, web, readOnly, zoom: shownZoom, fitZoom });
  live.current = { mode, color, speech, speaker, change, step, web, readOnly, zoom: shownZoom, fitZoom };

  // Find in page (⌘F): the hook needs the mark boxes (below), the keys need it here.
  const findRef = useRef<PageFind | null>(null);
  const keyActions = {
    find: () => findRef.current?.show(),
    step,
    zoomBy: (factor: number) => setZoom((value) => clampZoom((value ?? 1) * factor)),
    fit: () => setZoom(fitZoom()),
    setMode,
  };
  useReaderKeys(keyActions);
  const keyActionsRef = useRef(keyActions);
  keyActionsRef.current = keyActions;

  const [notice, setNotice] = useState<string | null>(null);
  const readFrom = useCallback(
    (offset: number) => {
      const { speech: reader, speaker: plugin } = live.current;
      const text = index.current?.text ?? "";
      if (reader === null || plugin === null) {
        setNotice("Read aloud needs the Read aloud plugin (Settings → Plugins).");
        return;
      }
      if (text.trim() === "") {
        setNotice(index.current === null ? "The page is not ready yet." : "This page has no text to read.");
        return;
      }
      setNotice(null);
      if (reader.state?.sourceId === sourceId && !reader.state.preparing) reader.seekToOffset(offset);
      else void reader.readText(plugin.name, sourceId, text, offset);
    },
    [sourceId],
  );

  /** Read from the selected text, or from the top. The "Read aloud" button of the plugin menu uses it. */
  const readFromSelection = useCallback(() => {
    const doc = frame.current?.contentDocument;
    const selection = doc?.getSelection();
    const range = selection != null && selection.rangeCount > 0 && !selection.isCollapsed ? selection.getRangeAt(0) : null;
    const offset = range === null || index.current === null ? 0 : (offsetAt(index.current, range.startContainer, range.startOffset) ?? 0);
    readFrom(offset);
  }, [readFrom]);
  useEffect(() => {
    if (web === null) return;
    const textToRead = () => {
      const doc = frame.current?.contentDocument;
      const selection = doc?.getSelection();
      const range = selection != null && selection.rangeCount > 0 && !selection.isCollapsed ? selection.getRangeAt(0) : null;
      const text = index.current?.text ?? "";
      const offset = range === null || index.current === null ? null : offsetAt(index.current, range.startContainer, range.startOffset);
      return { text: offset === null ? text : text.slice(offset), fromSelection: offset !== null };
    };
    const api = { readFromSelection, textToRead, translate: (plugin: string) => void translation.run(plugin), hideTranslation: translation.hide, translated: translation.shown };
    web.reader.current = api;
    return () => {
      if (web.reader.current === api) web.reader.current = null;
    };
  }, [web, readFromSelection, translation]);

  // The frame can finish loading before React adds its load handler: set up when it is complete.
  useEffect(() => {
    if (!notesLoaded) return;
    const timer = window.setInterval(() => {
      const doc = frame.current?.contentDocument;
      if (doc != null && doc.readyState === "complete" && doc.body !== null) {
        onLoad();
        window.clearInterval(timer);
      }
    }, 150);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesLoaded]);

  // "Read aloud" on a link object: read from the top when the page is ready.
  // The column shows or goes: fit the width again.
  const hadColumn = useRef(columnWidth > 0);
  useEffect(() => {
    if (hadColumn.current === columnWidth > 0) return;
    hadColumn.current = columnWidth > 0;
    setZoom(fitZoom());
  }, [columnWidth, fitZoom]);

  const autoRead = useRef(page.autoRead === true);
  useEffect(() => {
    if (!autoRead.current || loaded === 0) return;
    autoRead.current = false;
    readFrom(0);
  }, [loaded, readFrom]);

  /** The page height, and the left and right edge of its text. */
  const measure = useCallback(() => {
    const doc = frame.current?.contentDocument;
    if (doc == null) return;
    const next = Math.min(MAX_HEIGHT, Math.ceil(Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0)));
    setHeight((current) => (Math.abs(current - next) > 1 ? next : current));
    const nodes = index.current?.nodes ?? [];
    let left = Infinity;
    let right = -Infinity;
    const stride = Math.max(1, Math.floor(nodes.length / 1500));
    for (let at = 0; at < nodes.length; at += stride) {
      if (nodes[at]!.data.trim() === "") continue;
      const range = doc.createRange();
      range.selectNodeContents(nodes[at]!);
      const rect = range.getBoundingClientRect();
      if (rect.width < 1) continue;
      left = Math.min(left, rect.left);
      right = Math.max(right, rect.right);
    }
    setTextSides(Number.isFinite(left) ? { left, right } : null);
  }, []);

  /** Documents that have the reader set up (the load event and the mount check can both run). */
  const setUp = useRef(new WeakSet<Document>());
  const onLoad = () => {
    const doc = frame.current?.contentDocument;
    const view = frame.current?.contentWindow as (Window & typeof globalThis) | null | undefined;
    if (doc == null || view == null || doc.readyState !== "complete" || setUp.current.has(doc)) return;
    setUp.current.add(doc);
    setTitle(doc.title || page.url);
    const style = doc.createElement("style");
    style.textContent = FRAME_STYLE;
    (doc.head ?? doc.documentElement).append(style);
    showLazyImages(doc);
    index.current = indexText(doc);
    measure();
    // The page height can change (late images, fonts). A page that grows with its frame stops after some steps.
    let steps = 0;
    const observer = new view.ResizeObserver(() => {
      if (steps++ < 12) measure();
    });
    observer.observe(doc.body ?? doc.documentElement);

    doc.addEventListener(
      "click",
      (event) => {
        // Nodes of the frame are not instances of this window's Element: check the node type.
        const node = event.target as Node | null;
        const target = node?.nodeType === Node.ELEMENT_NODE ? (node as Element) : (node?.parentElement ?? null);
        const anchor = target?.closest("a[href]");
        if (anchor != null) {
          event.preventDefault();
          const href = anchor.getAttribute("href") ?? "";
          if (href.startsWith("#")) {
            doc.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ behavior: "smooth" });
            return;
          }
          if ((event.metaKey || event.ctrlKey) && isWebUrl(href)) {
            void live.current.web?.openWebPage(href);
            return;
          }
        }
        if (live.current.mode !== "read") return;
        const selection = doc.getSelection();
        if (selection !== null && !selection.isCollapsed) return;
        const caret = doc.caretRangeFromPoint(event.clientX, event.clientY);
        const offset = caret === null || index.current === null ? null : offsetAt(index.current, caret.startContainer, caret.startOffset);
        if (offset !== null) readFrom(offset);
      },
      true,
    );

    doc.addEventListener("mouseup", () => {
      const selection = doc.getSelection();
      if (selection === null || selection.isCollapsed || selection.rangeCount === 0 || index.current === null) {
        offerSelection("", 0, 0);
        return;
      }
      const range = selection.getRangeAt(0);
      if (live.current.mode === "highlight" && !live.current.readOnly) {
        const start = offsetAt(index.current, range.startContainer, range.startOffset);
        const end = offsetAt(index.current, range.endContainer, range.endOffset);
        if (start !== null && end !== null && end > start) {
          const notesNow = notesRef.current;
          const quote = index.current.text.slice(start, end);
          live.current.change({ ...notesNow, highlights: [...notesNow.highlights, { id: nanoid(10), start, end, quote, color: live.current.color }] });
          selection.removeAllRanges();
          return;
        }
      }
      const rects = range.getClientRects();
      const last = rects[rects.length - 1] ?? range.getBoundingClientRect();
      const box = frame.current!.getBoundingClientRect();
      const factor = live.current.zoom;
      offerSelection(selection.toString(), box.left + last.right * factor, box.top + last.bottom * factor);
    });

    doc.addEventListener("keydown", (event) => {
      if (live.current.speech?.handleKey(event) === true) return;
      readerKey(event, keyActionsRef.current);
    });
    // The frame does not scroll: its wheel scrolls the canvas. Ctrl + wheel and pinch zoom the canvas.
    const toApp = (x: number, y: number) => {
      const box = frame.current!.getBoundingClientRect();
      return [box.left + x * live.current.zoom, box.top + y * live.current.zoom] as const;
    };
    doc.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        if (event.ctrlKey || event.metaKey) {
          const [x, y] = toApp(event.clientX, event.clientY);
          sheet.current?.zoomAt(live.current.zoom * Math.exp(-event.deltaY * 0.01), x, y);
        } else {
          sheet.current?.scrollBy(event.deltaX, event.deltaY);
        }
      },
      { passive: false },
    );
    let gestureStart = 1;
    doc.addEventListener("gesturestart", (event) => {
      event.preventDefault();
      gestureStart = live.current.zoom;
    });
    doc.addEventListener("gesturechange", (event) => {
      event.preventDefault();
      const gesture = event as Event & { scale: number; clientX: number; clientY: number };
      const [x, y] = toApp(gesture.clientX, gesture.clientY);
      sheet.current?.zoomAt(gestureStart * gesture.scale, x, y);
    });
    setLoaded((count) => count + 1);
  };

  // The tool: a class on the page root (for cursors).
  useEffect(() => {
    const root = frame.current?.contentDocument?.documentElement;
    if (root == null) return;
    for (const name of ["read", "select", "highlight", "pen", "erase", "comment", "note"]) root.classList.toggle(`inspoboard-${name}`, name === mode);
  }, [mode, loaded]);

  // Marks: boxes of the highlights and of the spoken sentence, in page units (the frame does not scroll).
  const boxes = useCallback((start: number, end: number): Box[] => {
    const range = index.current === null ? null : rangeOf(index.current, start, end);
    return range === null ? [] : boxesOf(range, { x: 0, y: 0 }, 1);
  }, []);
  const highlightMarks = useMemo<Mark[]>(() => {
    if (index.current === null) return [];
    return notes.highlights.flatMap((highlight) => {
      const placed = placeHighlight(index.current!.text, highlight);
      return placed === null ? [] : [{ id: highlight.id, color: highlight.color, boxes: boxes(placed.start, placed.end) }];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes.highlights, loaded, height, boxes]);
  const spokenStart = spoken?.sentence.start ?? null;
  const spokenEnd = spoken?.sentence.end ?? null;
  const spokenMark = useMemo<Mark | null>(
    () => (spokenStart === null || spokenEnd === null ? null : { id: "spoken", color: "spoken", boxes: boxes(spokenStart, spokenEnd) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spokenStart, spokenEnd, loaded, height, boxes],
  );
  const pageText = useMemo(() => index.current?.text ?? "", [loaded]);
  const find = usePageFind(pageText, boxes);
  findRef.current = find;
  // A search hit in this page (board search): find its text when the page is ready.
  useEffect(() => {
    if (loaded && page.find !== undefined && page.find !== "") find.show(page.find);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, page]);
  const marks = [...highlightMarks, ...(spokenMark === null ? [] : [spokenMark]), ...find.marks];

  return (
    <div className="web-reader">
      <ReaderTools
        title={title}
        url={page.url}
        mode={mode}
        color={color}
        readOnly={readOnly}
        canRead={speaker !== null}
        zoom={shownZoom}
        margin={notes.margin}
        shownMargin={margin}
        onMode={setMode}
        sticky={modeSticky}
        onColor={setColor}
        onClose={onClose}
        onStep={step}
        onReadFromStart={() => readFrom(0)}
        onZoom={(value) => setZoom(clampZoom(value))}
        onFit={() => setZoom(fitZoom())}
        onMargin={(value) => change({ ...notesRef.current, margin: value })}
        onSaveAgain={web?.canSave === true ? onSaveAgain : undefined}
      />
      <FindBar find={find} />
      {problem !== null && <div className="plugin-error web-reader-problem">{problem}</div>}
      {notice !== null && <div className="plugin-error web-reader-problem">{notice}</div>}
      {notesLoaded && (
        <ReaderSheet
          pageWidth={Math.min(WIDTH_RANGE.max, width)}
          pageHeight={height}
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
                      layoutKey={`${loaded}:${height}`}
                      onHeight={setColumnHeight}
                      width={column.width}
                      zoom={shownZoom}
                      onWidth={column.onWidth}
                      spoken={spokenPair}
                    />
                  ),
                }
          }
          onScroll={() => offerSelection("", 0, 0)}
        >
          <iframe
            ref={frame}
            className="web-reader-frame"
            title={title}
            sandbox="allow-same-origin allow-scripts"
            srcDoc={page.html}
            onLoad={onLoad}
            scrolling="no"
            style={{ width, height, transform: `scale(${shownZoom})` }}
          />
        </ReaderSheet>
      )}
    </div>
  );
}

/** Classes that lazy-load scripts use before an image loads (as in the web plugin). */
const LAZY_CLASSES = ["lazyload", "lazyloading", "lazy", "lazy-load", "js-lazy", "b-lazy", "lozad"];

/**
 * Pages saved by an older web plugin: a saved image (a data address) can keep its lazy-load class, and a page style
 * such as ".lazyload { display: none }" hides it. Only the shown page changes, not the saved file.
 */
function showLazyImages(doc: Document): void {
  for (const image of doc.querySelectorAll<HTMLImageElement>("img[src^='data:image/']")) {
    if (!LAZY_CLASSES.some((name) => image.classList.contains(name))) continue;
    image.classList.remove(...LAZY_CLASSES);
    image.classList.add("lazyloaded");
  }
}
