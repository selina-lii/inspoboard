// The reader for a saved PDF (web/<key>.pdf). See docs/SPEC.md section 7.8.
// - The pages are the pdf.js viewer (PDFViewer, the page viewer of the Firefox PDF reader): it draws only the pages
//   near the view, makes their text layers (selectable text), keeps the last ones, and draws again after a zoom.
// - The viewer is on the reader canvas (margins, zoom, notes; see readerShared.tsx). Page units are PDF units (scale
//   1); the pages are one under the other with a gap of PAGE_GAP, as the canvas places its notes.
// - The text of the PDF (read aloud, find, highlights, links, translation) is the text model (pdfTextModel.ts): from
//   the text items of each page, never from the screen. Marks are boxes from the places of the items.
// - Read tool: a click on text reads aloud from there. Highlight, pen, eraser, comments, and notes go to
//   web/<key>.notes.json (the PDF never changes).
// - PDF.js loads its data files from public/pdfjs (no network). Scripts in PDFs never run. A link to a web address
//   opens in the web browser; a link inside the PDF goes to its page.

import { ctrlClickAsCommandClick } from "../app/keys";
import type { EventBus, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import { nanoid } from "nanoid";
import { logEvent } from "../app/debugLog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { COLUMN, layoutParagraphs, textUnits, TranslationColumn, useColumnWidth, usePageTranslation, type PageParagraph } from "./pageTranslation";
import { pageCounterpart } from "../plugins/sentencePairs";
import { useSession, useSessionState } from "../app/sessionContext";
import { reportPassage } from "../app/passages";
import { ReaderLinkShadows, ReaderLinks, useLinkMarks } from "./linkMarks";
import { FormulaNotes, type FormulaNote } from "./formulaNotes";
import { FormulaButton } from "../plugins/FormulaButton";
import { formulaCachePath, formulaRanges, formulaStore, trackViewDraw, type PageFormula, type PdfFormulaStore } from "./pdfFormulas";
import { formulaSentence } from "../plugins/formulas";
import { formulaWords, useFormulaWords } from "../plugins/formulaWords";
import { usePluginHost } from "../plugins/pluginsContext";
import { usePlugins } from "../plugins/pluginsContext";
import { useReadyState, useSpeechNow, useSpokenSentence, WEB_SOURCE, type ReadMode, type SentenceResolver } from "../plugins/speech";
import { findQuote, placeHighlight, type NoteColor, type PageBox, type WebHighlight } from "./savedPages";
import type { TextAnchor } from "../app/smallTool";
import { clampZoom, readyMarkOf, FindBar, marginOf, ReaderSheet, ReaderTools, usePageFind, useReaderKeys, useReaderNotes, type Box, type Mark, type PageFind, type ReaderMode, type SheetApi } from "./readerShared";
import { buildPdfText, characterBoxes, offsetOfSpan, pagesOf, textBoxes, type PdfText, type RawPage } from "./pdfTextModel";
import { textContentOf } from "./pdfText";
import { pdfjs, viewerModule } from "./pdfjsViewer";
import { useWebPages, type PdfPage } from "./WebPages";

/** Space between pages, at scale 1 (the viewer CSS has the same gap: web.css). */
const PAGE_GAP = 14;
/** The text layer params of the pdf.js viewer: the text model reads the same items, so each span is one item. */
const LAYER_TEXT = { includeMarkedContent: true, disableNormalization: true };

type Props = { page: PdfPage; onClose(): void; onSaveAgain?: () => void };

export function PdfReader({ page, onClose, onSaveAgain }: Props) {
  const { readOnly, settings } = useSessionState();
  // Read aloud, read at the time of a call: the reader does not render again at each change of read aloud.
  const speechNow = useSpeechNow();
  const plugins = usePlugins();
  const sheet = useRef<SheetApi | null>(null);
  /** The text of the PDF (pdfTextModel.ts): null until all pages are read. */
  const index = useRef<PdfText | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const [ready, setReady] = useState(0);
  /** The size of all pages at scale 1. */
  const [size, setSize] = useState({ w: 0, h: 0 });
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
  const { notes, notesRef, change, step, problem } = useReaderNotes(page.key);
  /** The selected text of the PDF (its place in the PDF text), for a new small item that points to it. */
  const selectedText = useRef<TextAnchor | null>(null);
  const sourceId = WEB_SOURCE + page.key;
  const spoken = useSpokenSentence(sourceId);
  const speaker = plugins.plugins.find((plugin) => plugin.details !== null && plugin.capabilities.includes("speak-text")) ?? null;
  // The translation column (pageTranslation.tsx): one paragraph for each line of the page text.
  // The paragraphs of the translation: from the layout of the page (set below, when the page is ready).
  const [paragraphs, setParagraphs] = useState<PageParagraph[]>([]);
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
  const sessionNow = useSession();
  const sessionRef = useRef(sessionNow);
  sessionRef.current = sessionNow;
  const live = useRef({ speechNow, speaker });
  live.current = { speechNow, speaker };

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
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  useEffect(() => {
    let cancelled = false;
    const opened = performance.now();
    const task = pdfjs.getDocument({
      data: new Uint8Array(page.data.slice(0)),
      // As the Firefox PDF reader (its default): hardware-accelerated canvases.
      enableHWA: true,
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
        logEvent(`PDF ${page.key}: ${loaded.numPages} pages, ${(page.data.byteLength / 1e6).toFixed(1)} MB, page sizes in ${Math.round(performance.now() - opened)} ms`);
      })
      .catch((error: unknown) => {
        logEvent(`PDF ${page.key} could not open: ${String(error)}`);
        if (!cancelled) setFailure(`The PDF could not open: ${String(error)}`);
      });
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [page]);

  // The first zoom fits the width.
  useEffect(() => {
    if (zoom === null && size.w > 0) fitPage();
  }, [zoom, size.w, fitPage]);

  // The text of all pages (in the pdf.js worker), for read aloud, find, marks, links, and the translation.
  useEffect(() => {
    if (doc === null) return;
    let cancelled = false;
    const started = performance.now();
    void (async () => {
      const raw: RawPage[] = [];
      for (let number = 1; number <= doc.numPages && !cancelled; number += 1) {
        const pdfPage = await doc.getPage(number);
        const content = await textContentOf(pdfPage, LAYER_TEXT);
        const items = content.items.filter((item): item is Extract<typeof item, { str: string }> => "str" in item);
        raw.push({ number, transform: pdfPage.getViewport({ scale: 1 }).transform, items, styles: content.styles });
      }
      if (cancelled) return;
      index.current = buildPdfText(raw, pdfjs.normalizeUnicode, fontAscent);
      logEvent(`PDF ${page.key}: text of all pages in ${Math.round(performance.now() - started)} ms`);
      setReady((count) => count + 1);
    })().catch((error: unknown) => !cancelled && setFailure(`The text of the PDF could not be read: ${String(error)}`));
    return () => {
      cancelled = true;
      index.current = null;
    };
  }, [doc, page.key]);

  /**
   * The pages near the view: the formula notes are made for them. Kept in a ref while scrolling; the reader draws
   * again for it only while "Formulas → words" is on (no work on scroll otherwise).
   */
  const nearRef = useRef(new Set<number>());
  const [nearPages, setNearPages] = useState<ReadonlySet<number>>(new Set());
  const notesWanted = useRef(false);
  const nearChange = (pageNumber: number, near: boolean) => {
    if (nearRef.current.has(pageNumber) === near) return;
    if (near) nearRef.current.add(pageNumber);
    else nearRef.current.delete(pageNumber);
    if (notesWanted.current) setNearPages(new Set(nearRef.current));
  };
  const nearChangeRef = useRef(nearChange);
  nearChangeRef.current = nearChange;

  // The pages: the pdf.js viewer in the canvas of the reader (the canvas scrolls; the viewer finds the pages in view).
  const viewerDiv = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<PDFViewer | null>(null);
  /** The spans of the text layers that are there now: the page and the order of each (the nth item with text). */
  const spans = useRef(new WeakMap<Element, { page: number; item: number }>());
  /** True while the reader sets the scale of the viewer: the viewer does not scroll then (the canvas keeps the point). */
  const zooming = useRef(false);
  const applyZoom = useCallback((value: number) => {
    const viewer = viewerRef.current;
    if (viewer === null || viewer.pagesCount === 0) return;
    const scale = value / pdfjs.PixelsPerInch.PDF_TO_CSS_UNITS;
    if (Math.abs(viewer.currentScale - scale) < 1e-6) return;
    zooming.current = true;
    try {
      viewer.currentScale = scale;
    } finally {
      zooming.current = false;
    }
  }, []);
  useEffect(() => {
    const container = sheet.current?.element() ?? null;
    const element = viewerDiv.current;
    if (doc === null || container === null || element === null) return;
    let stopped = false;
    let viewer: PDFViewer | null = null;
    let near: IntersectionObserver | null = null;
    const drawing = new Map<number, () => void>();
    void viewerModule.then(({ EventBus: Bus, PDFLinkService, PDFViewer: Viewer }) => {
      if (stopped) return;
      const eventBus: EventBus = new Bus();
      const linkService = new PDFLinkService({ eventBus });
      viewer = new Viewer({ container, viewer: element, eventBus, linkService, textLayerMode: 1, annotationMode: pdfjs.AnnotationMode.ENABLE });
      const made = viewer;
      // Only the reader scrolls the canvas: a zoom keeps the point under the pointer (readerShared.tsx), and a link
      // in the PDF goes to its place here.
      made.scrollPageIntoView = (params: { pageNumber: number; destArray?: unknown[] | null }) => {
        if (!zooming.current) goToPlace(made, container, params.pageNumber, params.destArray ?? null);
      };
      linkService.setViewer(made);
      eventBus.on("pagesinit", () => {
        applyZoom(zoomRef.current);
        // The pages near the view (one screen around it), for the formula notes.
        near = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) nearChangeRef.current(Number((entry.target as HTMLElement).dataset.pageNumber), entry.isIntersecting);
          },
          { root: container, rootMargin: "100% 0px" },
        );
        for (let at = 0; at < made.pagesCount; at += 1) near.observe(made.getPageView(at).div);
      });
      // Each text layer that the viewer makes: its spans, one for each text item with text (in order).
      eventBus.on("textlayerrendered", ({ pageNumber, source }: { pageNumber: number; source: { textLayer?: { div: HTMLElement } } }) => {
        const layer = source.textLayer?.div;
        if (layer === undefined) return;
        layer.querySelectorAll('span:not(.markedContent):not([role="img"])').forEach((span, item) => spans.current.set(span, { page: pageNumber, item }));
      });
      // The formula work waits while pages in view draw (pdfFormulas.ts). A draw that never ends (cancelled) stops
      // the wait after some seconds.
      eventBus.on("pagerender", ({ pageNumber }: { pageNumber: number }) => {
        trackViewDraw(
          new Promise<void>((resolve) => {
            drawing.get(pageNumber)?.();
            drawing.set(pageNumber, resolve);
            window.setTimeout(resolve, 3000);
          }),
        );
      });
      eventBus.on("pagerendered", ({ pageNumber }: { pageNumber: number }) => {
        drawing.get(pageNumber)?.();
        drawing.delete(pageNumber);
      });
      made.setDocument(doc);
      linkService.setDocument(doc);
      viewerRef.current = made;
    });
    return () => {
      stopped = true;
      near?.disconnect();
      for (const resolve of drawing.values()) resolve();
      viewer?.setDocument(null as never);
      viewerRef.current = null;
      element.replaceChildren();
    };
  }, [doc, applyZoom]);

  // Formulas of the PDF (pdfFormulas.ts), from a "math-image" plugin, only while "Formulas → words" is on. Nothing is
  // done ahead: read aloud asks for the formulas of each sentence just before its clip is made (resolveSentence), and
  // the formula notes ask for the pages in view.
  const session = useSession();
  const hostValue = usePluginHost();
  const imagePlugin = plugins.plugins.find((plugin) => plugin.details !== null && plugin.capabilities.includes("math-image")) ?? null;
  const mathPlugin = plugins.plugins.find((plugin) => plugin.details !== null && plugin.capabilities.includes("math-text")) ?? null;
  const formulasOn = settings.formulaNotes && imagePlugin !== null && mathPlugin !== null;
  const [store, setStore] = useState<PdfFormulaStore | null>(null);
  const [formulaBusy, setFormulaBusy] = useState(false);
  const [storeRevision, setStoreRevision] = useState(0);
  useEffect(() => {
    if (!formulasOn || hostValue === null || doc === null) return;
    const name = imagePlugin!.name;
    const next = formulaStore(
      page.key,
      doc,
      page.data.byteLength,
      {
        find: (image) => hostValue.host.call(name, "formulas", { image, read: false }),
        recognize: (images) => hostValue.host.call(name, "recognize", { images }),
        // Page images from PDFium (no drawing on the main thread); null without it.
        pageImage: (pageNumber, width, crop) => {
          const url = session.pdfPageUrl(page.key, pageNumber, width, crop);
          return url === null ? null : imageData(url);
        },
      },
      { load: () => session.readWebFile(formulaCachePath(page.key)), save: (text) => session.writeWebFile(formulaCachePath(page.key), text) },
    );
    setStore(next);
    const stop = next.subscribe(() => {
      setFormulaBusy(next.isBusy());
      setStoreRevision((count) => count + 1);
    });
    return () => {
      stop();
      // Off, or the reader closes: no formula work in the background.
      next.stop();
      setStore(null);
      setFormulaBusy(false);
    };
  }, [formulasOn, imagePlugin, hostValue, doc, page, session]);
  const storeRef = useRef(store);
  storeRef.current = store;
  // The formula notes need the pages near the view: from now on (and at once) while the store is there.
  useEffect(() => {
    notesWanted.current = store !== null;
    setNearPages(store === null ? new Set() : new Set(nearRef.current));
  }, [store]);

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
      const { speechNow, speaker: plugin } = live.current;
      const reader = speechNow();
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
      else void reader.readText(plugin.name, sourceId, text, offset, undefined, until, (sentence) => resolveRef.current(sentence));
    },
    [sourceId],
  );

  const web = useWebPages();
  /** The selected text of the PDF: its range in the PDF text, or null. */
  const selectedRange = useCallback((): { start: number; end: number } | null => {
    const selection = window.getSelection();
    const range = selection !== null && selection.rangeCount > 0 && !selection.isCollapsed ? selection.getRangeAt(0) : null;
    if (range === null || viewerDiv.current?.contains(range.startContainer) !== true || index.current === null) return null;
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
      const inside = range !== null && viewerDiv.current?.contains(range.startContainer) === true;
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

  // Marks: boxes in page units (scale 1, from the top left of the first page), from the places of the text items.
  /** Page boxes in canvas units (the pages are one under the other, PAGE_GAP between them). */
  const sheetBoxes = useCallback((list: readonly PageBox[]): Box[] => list.map(([number, left, top, width, height]) => ({ left, top: (layoutRef.current[number - 1]?.top ?? 0) + top, width, height })), []);
  const boxes = useCallback((start: number, end: number): Box[] => (index.current === null ? [] : sheetBoxes(textBoxes(index.current, start, end, measureText))), [sheetBoxes]);
  // The text ranges of the formulas of a page: the characters whose middle is in a formula box. Once per page and text.
  const pageRanges = useRef(new Map<number, { formula: PageFormula; start: number; end: number }[]>());
  useEffect(() => pageRanges.current.clear(), [ready]);
  const rangesOf = useCallback((pageNumber: number, formulas: readonly PageFormula[]) => {
    const known = pageRanges.current.get(pageNumber);
    if (known !== undefined) return known;
    const value = index.current;
    if (value === null || formulas.length === 0) return [];
    const touches = (box: Box) => formulas.some(({ box: area }) => box.left < area.left + area.width && box.left + box.width > area.left && box.top < area.top + area.height && box.top + box.height > area.top);
    const chars = characterBoxes(value, pageNumber, touches, measureText);
    const found = formulaRanges(formulas.map((formula) => ({ box: formula.box, formula })), chars).map(({ formula, start, end }) => ({ formula, start, end }));
    pageRanges.current.set(pageNumber, found);
    return found;
  }, []);
  /** The index in the PDF text of a DOM place in a text layer (a selection, a click). */
  const offsetAt = (model: PdfText, node: Node, offset: number): number | null => domOffset(model, spans.current, node, offset);
  /** The pages (numbers) of a text range of the PDF text. */
  const pagesOfRange = useCallback((start: number, end: number): number[] => (index.current === null ? [] : pagesOf(index.current, start, end)), []);
  /**
   * Read aloud, just before the clip of a sentence is made: the formulas on its pages are found, the ones in the
   * sentence are read, and the sentence is said with their words (in parts: the voice says formulas slower).
   */
  const resolveSentence = useCallback<SentenceResolver>(
    async (sentence) => {
      const current = storeRef.current;
      const value = index.current;
      if (current === null || value === null || hostValue === null || mathPlugin === null) return sentence;
      const touching: { formula: PageFormula; start: number; end: number }[] = [];
      for (const pageNumber of pagesOfRange(sentence.start, sentence.end)) {
        const formulas = await current.find(pageNumber);
        for (const entry of rangesOf(pageNumber, formulas)) if (entry.start < sentence.end && sentence.start < entry.end) touching.push(entry);
      }
      if (touching.length === 0) return sentence;
      await current.read(touching.map((entry) => entry.formula));
      const words = await formulaWords(hostValue.host, mathPlugin.name, plugins.optionsOf(mathPlugin.name), touching.map(({ formula }) => ({ tex: formula.tex, display: formula.display })));
      const said = touching.map((entry, at) => ({ start: entry.start, end: entry.end, tex: entry.formula.tex, display: entry.formula.display, words: words[at]?.speech ?? "" }));
      const { speech, parts } = formulaSentence(value.text, sentence.start, sentence.end, said);
      return { ...sentence, speech, parts };
    },
    [hostValue, mathPlugin, plugins, pagesOfRange, rangesOf],
  );
  const resolveRef = useRef(resolveSentence);
  resolveRef.current = resolveSentence;

  // The formula notes: the pages in view ask for their formulas (found and read). A note is placed like a box of the
  // translation column: on the text of its formula (boxes of its text range); a formula with no text (a picture):
  // on its own box.
  useEffect(() => {
    if (store === null) return;
    for (const pageNumber of nearPages) void store.find(pageNumber).then((formulas) => store.read(formulas)).catch(() => undefined);
  }, [store, nearPages]);
  const noteFormulas = useMemo(() => {
    if (store === null) return [];
    return [...nearPages].sort((a, b) => a - b).flatMap((pageNumber) => {
      const formulas = store.known(pageNumber) ?? [];
      const ranges = rangesOf(pageNumber, formulas);
      const top = layout[pageNumber - 1]?.top ?? 0;
      return formulas.flatMap((formula) => {
        if (formula.tex === undefined || formula.tex === "") return [];
        const range = ranges.find((entry) => entry.formula === formula);
        const textBoxes = range === undefined ? [] : boxes(range.start, range.end).filter((box) => box.width > 0 && box.height > 0);
        const box = textBoxes.length > 0 ? unionBox(textBoxes) : { ...formula.box, top: top + formula.box.top };
        return [{ key: `${pageNumber}:${formula.box.left}:${formula.box.top}`, box, tex: formula.tex, display: formula.display }];
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, storeRevision, nearPages, ready, layout, rangesOf, boxes]);
  const formulaWordList = useFormulaWords(store === null ? null : noteFormulas.map(({ tex, display }) => ({ tex, display })));
  const formulaNotes: FormulaNote[] = formulaWordList === null ? [] : noteFormulas.map((note, at) => ({ key: note.key, box: note.box, words: formulaWordList[at] ?? "", tex: note.tex }));
  // The paragraphs of the translation, from the layout of the page (pageTranslation.tsx).
  useEffect(() => {
    const value = index.current;
    setParagraphs(value === null ? [] : layoutParagraphs(value.text, value.lines ?? textUnits(value.text), boxes, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, size.h, boxes]);
  const highlightMarks = useMemo<Mark[]>(() => {
    if (index.current === null) return [];
    return notes.highlights.flatMap((highlight) => {
      // A highlight with its page boxes shows there; an older one is found by its text.
      if (highlight.boxes !== undefined) return [{ id: highlight.id, color: highlight.color, boxes: sheetBoxes(highlight.boxes) }];
      const placed = placeHighlight(index.current!.text, highlight);
      return placed === null ? [] : [{ id: highlight.id, color: highlight.color, boxes: boxes(placed.start, placed.end) }];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes.highlights, ready, boxes, sheetBoxes]);
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
  const readyMark = readyMarkOf(useReadyState(sourceId, settings.speechShowReady), sourceId, settings.speechShowReady, boxes);
  const marks = [...highlightMarks, ...linkMarks.marks, ...(spokenMark === null ? [] : [spokenMark]), ...(readyMark === null ? [] : [readyMark]), ...find.marks];

  /** A link of the PDF to a web address opens in the web browser (a link inside the PDF goes to its page: pdf.js). */
  const onLinkClick = (event: React.MouseEvent) => {
    const link = (event.target as Element).closest(".annotationLayer a");
    const href = link?.getAttribute("href") ?? "";
    if (link == null || href === "" || href.startsWith("#")) return;
    event.preventDefault();
    event.stopPropagation();
    if (/^(https?|mailto):/i.test(href)) void sessionNow.openInBrowser(href);
  };

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
    const speech = speechNow();
    if (offset !== null && speech?.state?.sourceId === sourceId && !speech.state.preparing) speech.clickSeek(offset);
  };

  /** The link bench can take the selected passage (its text in the PDF text, as the marks find it again). */
  const reportPdfPassage = () => {
    const pageItem: string | undefined = page.itemId;
    if (pageItem === undefined || index.current === null) return;
    const selection = window.getSelection();
    const range = selection !== null && selection.rangeCount > 0 && !selection.isCollapsed ? selection.getRangeAt(0) : null;
    if (range === null || viewerDiv.current?.contains(range.startContainer) !== true) {
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
    // The place on the pages is kept too (as Zotero does): the highlight shows there, whatever the text finds later.
    const placed = textBoxes(index.current, start, end, measureText).map((box) => box.map((part, at) => (at === 0 ? part : Math.round(part * 100) / 100)) as PageBox);
    const highlight: WebHighlight = { id: nanoid(10), start, end, quote: index.current.text.slice(start, end), color };
    if (placed.length > 0) highlight.boxes = placed;
    change({ ...current, highlights: [...current.highlights, highlight] });
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
        extra={
          <>
            {imagePlugin !== null && plugins.plugins.some((plugin) => plugin.details !== null && plugin.capabilities.includes("math-text")) && <FormulaButton busy={formulaBusy} />}
            <ReaderLinks itemId={page.itemId} />
          </>
        }
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
        focus={spokenMark?.boxes ?? null}
        focusKey={spokenStart}
        findFocus={find.focus}
          onTyping={() => (mode === "comment" || mode === "note") && setMode("select")}
          onPlaced={() => !modeSticky && setMode("select")}
        onZoom={(value) => setZoom(value)}
        apiRef={sheet}
        onZoomLayout={applyZoom}
        leftNotes={settings.formulaNotes && formulaNotes.length > 0 ? <FormulaNotes notes={formulaNotes} margin={margin} /> : null}
        shadows={<ReaderLinkShadows placed={linkMarks.placed} margin={margin} pageWidth={size.w} side={translation.texts === null ? "right" : "left"} />}
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
                    pageWidth={size.w}
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
        {/* The pdf.js viewer: at the left edge of the canvas (it measures the pages from there), the pages after the margin. */}
        <div
          ref={viewerDiv}
          className={`pdfViewer pdf-pages${settings.readerInvert ? " inverted" : ""}`}
          style={{ left: -margin * shownZoom, paddingLeft: margin * shownZoom }}
          onClickCapture={onLinkClick}
          onClick={onClick}
          // Ctrl+click works as ⌘-click (links, linked passages): on macOS it is a right-click, with no click event.
          onContextMenu={(event) => void ctrlClickAsCommandClick(event.nativeEvent)}
          onMouseUp={onMouseUp}
        />
      </ReaderSheet>
      {zoom === null && failure === null && <div className="pdf-loading muted">Opening the PDF…</div>}
    </div>
  );
}

/** The box around boxes. */
function unionBox(list: readonly Box[]): Box {
  const left = Math.min(...list.map((box) => box.left));
  const top = Math.min(...list.map((box) => box.top));
  const right = Math.max(...list.map((box) => box.left + box.width));
  const bottom = Math.max(...list.map((box) => box.top + box.height));
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * Goes to a place of a page (a link inside the PDF): the top of the place near the top of the view. `dest`: a PDF
 * destination ([page, {name}, ...]): XYZ (left, top), FitH and FitBH (top), FitR (left, bottom, right, top).
 */
function goToPlace(viewer: PDFViewer, container: HTMLElement, pageNumber: number, dest: readonly unknown[] | null): void {
  const view = viewer.getPageView(pageNumber - 1) as { div: HTMLElement; viewport: { convertToViewportPoint(x: number, y: number): number[] } } | undefined;
  if (view === undefined) return;
  const name = (dest?.[1] as { name?: string } | undefined)?.name;
  const number = (value: unknown) => (typeof value === "number" ? value : null);
  const top = name === "XYZ" ? number(dest?.[3]) : name === "FitH" || name === "FitBH" ? number(dest?.[2]) : name === "FitR" ? number(dest?.[5]) : null;
  const y = top === null ? 0 : Math.max(0, view.viewport.convertToViewportPoint(0, top)[1]!);
  container.scrollTop += view.div.getBoundingClientRect().top + y - container.getBoundingClientRect().top - 16;
}

/** The share of the font height above the baseline, as the pdf.js text layer measures it (TextLayer #getAscent). */
const ascents = new Map<string, number | null>();
function fontAscent(fontFamily: string): number | null {
  let known = ascents.get(fontFamily);
  if (known === undefined) {
    measurer ??= document.createElement("canvas").getContext("2d");
    if (measurer === null) return null;
    measurer.font = `30px ${fontFamily}`;
    const metrics = measurer.measureText("");
    const descent = Math.abs(metrics.fontBoundingBoxDescent);
    known = metrics.fontBoundingBoxAscent > 0 ? metrics.fontBoundingBoxAscent / (metrics.fontBoundingBoxAscent + descent) : null;
    ascents.set(fontFamily, known);
  }
  return known;
}

/** The width of a text in a font family (a canvas measures it, as the pdf.js text layer does). */
let measurer: CanvasRenderingContext2D | null = null;
function measureText(text: string, font: string): number {
  measurer ??= document.createElement("canvas").getContext("2d");
  if (measurer === null) return text.length;
  measurer.font = `100px ${font}`;
  return measurer.measureText(text).width;
}

/**
 * The index in the PDF text of a DOM place in a text layer. A place in a span: its item. A place between spans (the
 * end of a text layer, a page): the first span after it, else the end of the last span of its layer.
 */
function domOffset(model: PdfText, spans: WeakMap<Element, { page: number; item: number }>, node: Node, offset: number): number | null {
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
  const span = element?.closest("span") ?? null;
  const known = span === null ? undefined : spans.get(span);
  if (known !== undefined) {
    const length = span!.textContent?.length ?? 0;
    const at = node.nodeType === Node.TEXT_NODE ? offset : offset === 0 ? 0 : length;
    return offsetOfSpan(model, known.page, known.item, at, pdfjs.normalizeUnicode);
  }
  const layer = element?.closest(".textLayer") ?? element?.closest(".page")?.querySelector(".textLayer") ?? null;
  if (layer == null) return null;
  const point = document.createRange();
  point.setStart(node, offset);
  let last: { page: number; item: number; length: number } | null = null;
  for (const candidate of layer.querySelectorAll("span")) {
    const info = spans.get(candidate);
    if (info === undefined) continue;
    if (point.comparePoint(candidate, 0) >= 0) return offsetOfSpan(model, info.page, info.item, 0, pdfjs.normalizeUnicode);
    last = { ...info, length: candidate.textContent?.length ?? 0 };
  }
  return last === null ? null : offsetOfSpan(model, last.page, last.item, last.length, pdfjs.normalizeUnicode);
}

/** An image address as a PNG data URL (for a plugin). */
async function imageData(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(await response.text());
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
