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
import { useSession, useSessionState } from "../app/sessionContext";
import { reportPassage } from "../app/passages";
import { ReaderLinks, useLinkMarks } from "./linkMarks";
import { offerSelection } from "../plugins/SelectionTranslate";
import { usePlugins } from "../plugins/pluginsContext";
import { useSpeech, useSpokenSentence, WEB_SOURCE, type ReadMode } from "../plugins/speech";
import { useWebPages, type HtmlPage } from "./WebPages";
import { findQuote, isWebUrl, placeHighlight, WIDTH_RANGE, type NoteColor, type WebNotes } from "./savedPages";
import { armSmallByKey, type TextAnchor } from "../app/smallTool";
import { isTextTarget } from "../app/dom";
import { boxesOf, clampZoom, readyMarkOf, FindBar, marginOf, readerKey, ReaderSheet, ReaderTools, usePageFind, useReaderKeys, useReaderNotes, type Box, type Mark, type PageFind, type ReaderMode, type SheetApi } from "./readerShared";
import { indexText, offsetAt, rangeOf, type TextIndex } from "./webText";

/** Styles inside the page: no scroll (the canvas scrolls), and cursors for the tools. */
const FRAME_STYLE = `
html, body { overflow: hidden !important; }
html.inspoboard-invert:not(.inspoboard-invert-images) img, html.inspoboard-invert:not(.inspoboard-invert-images) video, html.inspoboard-invert:not(.inspoboard-invert-images) canvas, html.inspoboard-invert:not(.inspoboard-invert-images) [style*="background-image"] { filter: invert(1) hue-rotate(180deg); }
html.inspoboard-select body { cursor: text; }
`;
/** A page taller than this is cut (a page that grows with its frame). */
const MAX_HEIGHT = 200000;

type Props = { page: HtmlPage; onClose(): void; onSaveAgain(): void };

export function WebReader({ page, onClose, onSaveAgain }: Props) {
  const { readOnly } = useSessionState();
  const session = useSession();
  const speech = useSpeech();
  const plugins = usePlugins();
  const web = useWebPages();
  const frame = useRef<HTMLIFrameElement>(null);
  const sheet = useRef<SheetApi | null>(null);
  const index = useRef<TextIndex | null>(null);
  const [loaded, setLoaded] = useState(0);
  const [mode, setModeNow] = useState<ReaderMode>("select");
  // The comment and note tools make one item per click, as the board tools. A double-click keeps them on.
  const [modeSticky, setModeSticky] = useState(false);
  const setMode = useCallback((next: ReaderMode, keep = false) => {
    setModeNow(next);
    setModeSticky(keep);
  }, []);
  const [color, setColor] = useState<NoteColor>("yellow");
  const { notes, notesRef, loaded: notesLoaded, change: changeNotes, step, problem } = useReaderNotes(page.key, page.notesFrom);
  /** The selected text of the page (its place in the page text), for a new small item that points to it. */
  const selectedText = useRef<TextAnchor | null>(null);
  const [title, setTitle] = useState("");
  const [height, setHeight] = useState(2000);
  const [, setTextSides] = useState<{ left: number; right: number } | null>(null);
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
  const margin = marginOf(width);
  // Each change keeps the page width, so that the page flows the same next time.
  const change = useCallback((next: WebNotes) => changeNotes({ ...next, width: next.width ?? width }), [changeNotes, width]);

  const fitZoom = useCallback(() => clampZoom(Math.min(1, ((sheet.current?.viewWidth() ?? window.innerWidth) - 48) / (width + columnWidth))), [width, columnWidth]);
  /** Fits the page (and the translation column) to the width, and scrolls to the page (the margins are at its sides). */
  const [fitCount, setFitCount] = useState(0);
  const fitPage = useCallback(() => {
    setZoom(fitZoom());
    setFitCount((count) => count + 1);
  }, [fitZoom]);
  useEffect(() => {
    if (zoom === null && notesLoaded) fitPage();
  }, [zoom, notesLoaded, fitPage]);
  const shownZoom = zoom ?? 1;

  // The newest values for the frame event handlers (they are added one time per load).
  const live = useRef({ mode, color, speech, speaker, change, step, web, readOnly, zoom: shownZoom, fitZoom });
  live.current = { mode, color, speech, speaker, change, step, web, readOnly, zoom: shownZoom, fitZoom };

  // Find in page (⌘F): the hook needs the mark boxes (below), the keys need it here.
  const findRef = useRef<PageFind | null>(null);
  /** ⌘-click on a linked passage: goes along its link (set below, when the page text is known). */
  const followRef = useRef<(offset: number) => boolean>(() => false);
  const keyActions = {
    mode,
    find: () => findRef.current?.show(),
    step,
    zoomBy: (factor: number) => setZoom((value) => clampZoom((value ?? 1) * factor)),
    fit: () => fitPage(),
    setMode,
  };
  useReaderKeys(keyActions);
  const keyActionsRef = useRef(keyActions);
  keyActionsRef.current = keyActions;

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
        setNotice(index.current === null ? "The page is not ready yet." : "This page has no text to read.");
        return;
      }
      setNotice(null);
      if (until === undefined && reader.state?.sourceId === sourceId && !reader.state.preparing && reader.state.until === undefined) reader.seekToOffset(offset);
      else void reader.readText(plugin.name, sourceId, text, offset, index.current?.formulas, until);
    },
    [sourceId],
  );

  /** The selected text of the page: its range in the page text, or null. */
  const selectedRange = useCallback((): { start: number; end: number } | null => {
    const selection = frame.current?.contentDocument?.getSelection();
    const range = selection != null && selection.rangeCount > 0 && !selection.isCollapsed ? selection.getRangeAt(0) : null;
    if (range === null || index.current === null) return null;
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
      const doc = frame.current?.contentDocument;
      const selection = doc?.getSelection();
      const range = selection != null && selection.rangeCount > 0 && !selection.isCollapsed ? selection.getRangeAt(0) : null;
      const text = index.current?.text ?? "";
      const offset = range === null || index.current === null ? null : offsetAt(index.current, range.startContainer, range.startOffset);
      return { text: offset === null ? text : text.slice(offset), fromSelection: offset !== null };
    };
    const api = { read, hasSelection: () => selectedRange() !== null, textToRead, translate: (plugin: string) => void translation.run(plugin), hideTranslation: translation.hide, translated: translation.shown };
    web.reader.current = api;
    return () => {
      if (web.reader.current === api) web.reader.current = null;
    };
  }, [web, read, selectedRange, translation]);

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
    fitPage();
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
        // ⌘-click on a linked passage (dotted line): go to the other end of its link.
        if (event.metaKey || event.ctrlKey) {
          const at = doc.caretRangeFromPoint(event.clientX, event.clientY);
          const offset = at === null || index.current === null ? null : offsetAt(index.current, at.startContainer, at.startOffset);
          if (offset !== null && followRef.current(offset)) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
        }
        if (live.current.mode !== "select") return;
        const selection = doc.getSelection();
        if (selection !== null && !selection.isCollapsed) return;
        const caret = doc.caretRangeFromPoint(event.clientX, event.clientY);
        const offset = caret === null || index.current === null ? null : offsetAt(index.current, caret.startContainer, caret.startOffset);
        // Only while it reads this page (Read aloud started it): the click moves the reading there. Else a click does not read.
        const reader = live.current.speech;
        if (offset !== null && reader?.state?.sourceId === sourceId && !reader.state.preparing) reader.clickSeek(offset);
      },
      true,
    );

    doc.addEventListener("mouseup", () => {
      const selection = doc.getSelection();
      const pageItem: string | undefined = page.itemId;
      if (selection === null || selection.isCollapsed || selection.rangeCount === 0 || index.current === null) {
        selectedText.current = null;
        offerSelection("", 0, 0);
        if (pageItem !== undefined) reportPassage(null, pageItem);
        return;
      }
      const range = selection.getRangeAt(0);
      // The link bench can take this passage (its page text, as the marks find it again).
      if (pageItem !== undefined) {
        const start = offsetAt(index.current, range.startContainer, range.startOffset);
        const end = offsetAt(index.current, range.endContainer, range.endOffset);
        if (start !== null && end !== null && end > start) reportPassage({ itemId: pageItem, quote: index.current.text.slice(start, end) });
      }
      {
        const start = offsetAt(index.current, range.startContainer, range.startOffset);
        const end = offsetAt(index.current, range.endContainer, range.endOffset);
        selectedText.current = start !== null && end !== null && end > start ? { text: index.current.text.slice(start, end), at: start } : null;
      }
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
      if (readerKey(event, keyActionsRef.current)) return;
      // The keys of the small kinds (N, M, W, I, F, Q) also work while the page frame has the focus.
      if (!event.metaKey && !event.ctrlKey && !event.altKey && !isTextTarget(event.target) && armSmallByKey(event.key.toLowerCase())) {
        event.preventDefault();
        return;
      }
      // A key in the page frame does not reach the app window: Esc with no use in the reader goes there (zen mode).
      if (event.key === "Escape" && !event.defaultPrevented) window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
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
    for (const name of ["select", "highlight", "pen", "erase", "comment", "note"]) root.classList.toggle(`inspoboard-${name}`, name === mode);
  }, [mode, loaded]);

  // Inverted colors: the frame is inverted; its pictures are inverted again, so they keep their colors (unless the
  // setting "Invert pictures too" is on).
  const { settings } = useSessionState();
  useEffect(() => {
    const root = frame.current?.contentDocument?.documentElement;
    root?.classList.toggle("inspoboard-invert", settings.readerInvert);
    root?.classList.toggle("inspoboard-invert-images", settings.readerInvertImages);
  }, [settings.readerInvert, settings.readerInvertImages, loaded]);

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
  const linkMarks = useLinkMarks(page.itemId, pageText, boxes, `${loaded}:${height}`);
  followRef.current = linkMarks.follow;
  // The "ready" cursor of read aloud (where the ready audio ends), if the setting shows it.
  const readyMark = readyMarkOf(useSpeech()?.state, sourceId, settings.speechShowReady, boxes);
  const marks = [...highlightMarks, ...linkMarks.marks, ...(spokenMark === null ? [] : [spokenMark]), ...(readyMark === null ? [] : [readyMark]), ...find.marks];

  return (
    <div className="web-reader">
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
        onSaveAgain={web?.canSave === true ? onSaveAgain : undefined}
        extra={<ReaderLinks itemId={page.itemId} />}
      />
      <FindBar find={find} />
      {problem !== null && <div className="plugin-error web-reader-problem">{problem}</div>}
      {notice !== null && <div className="plugin-error web-reader-problem">{notice}</div>}
      {notesLoaded && (
        <ReaderSheet
          homeId={page.itemId}
          fitKey={fitCount}
        anchorBox={(quote, at) => {
            const found = index.current === null ? null : findQuote(index.current.text, quote, at ?? 0);
            return found === null ? null : (boxes(found.start, found.end).at(-1) ?? null);
          }}
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
            className={`web-reader-frame${settings.readerInvert ? " inverted" : ""}`}
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
