// Formulas of a PDF (SPEC 7.10), from a "math-image" plugin (plugins/mathocr): a PDF keeps formulas as glyphs or
// pictures, not as LaTeX. Only while "Formulas → words" is on. Work is done when it is needed, page by page:
// - find(page): the boxes of the formulas on one page (the page drawn to an image; plugin "formulas", read: false;
//   about 2 s a page).
// - read(formulas): the LaTeX of some formulas (cut out of the page image; plugin "recognize"; about 1 s each).
// Read aloud asks for the formulas of the sentences ahead (just before their clips are made); the formula notes ask
// for the pages in view. One job at a time; the pages in view draw first (trackViewDraw).
// - Boxes are in page units (PDF units at scale 1) from the top left of their page.
// - Results stay while the app is open (memory) and in a cache file of the vault (`.inspoboard/cache/formulas/<key>.json`,
//   see FormulaFile): a page is found once, a formula is read once. The file has the size and the page count of the
//   PDF: a different PDF under the same key starts again.

import type * as pdfjs from "pdfjs-dist";
import { logEvent } from "../app/debugLog";
import type { Formula } from "../plugins/formulas";
import type { Box } from "./readerBasics";

/** A formula on a page. `tex`: its LaTeX, once it is read ("" if the plugin could not read it). */
export type PageFormula = { page: number; box: Box; display: boolean; tex?: string };

/** The width of a page image for the plugin (pixels). The plugin finds formulas at a width of 768. */
const IMAGE_WIDTH = 1536;
const CACHE_VERSION = 2;

/** The cache file of a PDF: read and written by the caller (Session.readWebFile and writeWebFile). */
export type FormulaFile = { load(): Promise<string | null>; save(text: string): Promise<void> };
export const formulaCachePath = (key: string) => `cache/formulas/${key}.json`;

/** The plugin calls that the store uses. */
export type FormulaPlugin = {
  find(image: string): Promise<unknown>;
  recognize(images: string[]): Promise<unknown>;
  /**
   * A page image (PNG data URL) drawn by the backend (PDFium), `width` pixels wide; `crop`: a part in page units.
   * Null: no backend drawing; the store draws with pdf.js (on the main thread).
   */
  pageImage?(page: number, width: number, crop?: Box): Promise<string> | null;
};

/**
 * Pages that the reader draws now. PDF.js draws one thing at a time: the formula work waits until these are done,
 * so the pages in view never wait behind it.
 */
let viewDraws = 0;
let idleWaiters: (() => void)[] = [];

/** The reader tells each draw of a page in view (the promise of the draw). */
export function trackViewDraw(draw: Promise<unknown>): void {
  viewDraws += 1;
  void draw.finally(() => {
    viewDraws -= 1;
    if (viewDraws > 0) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const waiter of waiters) waiter();
  });
}

function viewDrawsDone(): Promise<void> {
  return viewDraws === 0 ? Promise.resolve() : new Promise((resolve) => idleWaiters.push(resolve));
}

/** The formula store of one PDF. Get it with `formulaStore` (one per PDF while the app is open). */
export class PdfFormulaStore {
  private found = new Map<number, PageFormula[]>();
  private finding = new Map<number, Promise<PageFormula[]>>();
  private reading = new Map<PageFormula, Promise<void>>();
  /** One job at a time (the plugin and PDF.js work one at a time anyway). */
  private chain: Promise<unknown> = Promise.resolve();
  private loaded: Promise<void> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private busy = 0;
  private listeners = new Set<() => void>();
  /** Off, or the reader closed: jobs that did not start yet are not done. */
  private stopped = false;

  constructor(
    private readonly key: string,
    private readonly doc: pdfjs.PDFDocumentProxy,
    private readonly bytes: number,
    private plugin: FormulaPlugin,
    private file: FormulaFile,
  ) {}

  /** New plugin calls or file (a new reader of the same PDF). Starts the work again after a stop. */
  connect(plugin: FormulaPlugin, file: FormulaFile): void {
    this.plugin = plugin;
    this.file = file;
    this.stopped = false;
  }

  stop(): void {
    this.stopped = true;
  }

  /** True while jobs wait or run. */
  isBusy(): boolean {
    return this.busy > 0;
  }

  /** Called when the busy state or the known formulas change. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** The formulas of a page if they are found already (no work). */
  known(page: number): readonly PageFormula[] | null {
    return this.found.get(page) ?? null;
  }

  /** The formulas of a page (found once). */
  async find(page: number): Promise<PageFormula[]> {
    await this.load();
    const known = this.found.get(page);
    if (known !== undefined) return known;
    let job = this.finding.get(page);
    if (job === undefined) {
      job = this.job(async () => {
        const started = performance.now();
        const { image, scale } = (await this.native(page)) ?? (await this.draw(page));
        const reply = readReply(await this.plugin.find(image));
        const factor = 1 / scale;
        const formulas: PageFormula[] = reply.formulas.map(({ box: [left = 0, top = 0, right = 0, bottom = 0], display }) => ({
          page,
          box: { left: left * factor, top: top * factor, width: (right - left) * factor, height: (bottom - top) * factor },
          display: display === true,
        }));
        this.found.set(page, formulas);
        logEvent(`PDF ${this.key}: page ${page}: ${formulas.length} formulas found in ${Math.round(performance.now() - started)} ms`);
        this.changed();
        return formulas;
      });
      this.finding.set(page, job);
      void job.catch(() => undefined).finally(() => this.finding.delete(page));
    }
    return job;
  }

  /** Reads the LaTeX of the formulas that do not have it yet (the ones of one page: one image, one plugin call). */
  async read(formulas: readonly PageFormula[]): Promise<void> {
    const missing = formulas.filter((formula) => formula.tex === undefined && !this.reading.has(formula));
    for (const page of new Set(missing.map((formula) => formula.page))) {
      const group = missing.filter((formula) => formula.page === page);
      const job = this.job(async () => {
        const started = performance.now();
        let images: string[];
        const native = this.plugin.pageImage === undefined ? null : await Promise.all(group.map((formula) => this.plugin.pageImage!(page, IMAGE_WIDTH, formula.box)));
        if (native !== null && native.every((image) => typeof image === "string")) images = native as string[];
        else {
          const { canvas, scale } = await this.render(page);
          images = group.map((formula) => cut(canvas, formula.box, scale));
          canvas.width = 0;
          canvas.height = 0;
        }
        const texts = readTexts(await this.plugin.recognize(images), group.length);
        group.forEach((formula, at) => (formula.tex = texts[at]!));
        logEvent(`PDF ${this.key}: page ${page}: ${group.length} formulas read in ${Math.round(performance.now() - started)} ms`);
        this.changed();
      });
      for (const formula of group) this.reading.set(formula, job);
      void job.catch(() => undefined).finally(() => group.forEach((formula) => this.reading.delete(formula)));
    }
    await Promise.all(formulas.map((formula) => this.reading.get(formula)));
  }

  private job<T>(work: () => Promise<T>): Promise<T> {
    this.busy += 1;
    this.changed(false);
    const run = this.chain.then(async () => {
      if (this.stopped) throw new Error("Stopped.");
      await viewDrawsDone();
      return work();
    });
    this.chain = run.catch(() => undefined);
    void run
      .catch(() => undefined)
      .finally(() => {
        this.busy -= 1;
        this.changed(false);
      });
    return run;
  }

  private async render(page: number): Promise<{ canvas: HTMLCanvasElement; scale: number }> {
    const pdfPage = await this.doc.getPage(page);
    const scale = IMAGE_WIDTH / pdfPage.getViewport({ scale: 1 }).width;
    const viewport = pdfPage.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    // A white page under the drawing: a PDF page can be transparent.
    const context = canvas.getContext("2d");
    if (context !== null) {
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    await pdfPage.render({ canvas, viewport }).promise;
    return { canvas, scale };
  }

  /** The page image from the backend (PDFium), or null if it does not draw pages. */
  private async native(page: number): Promise<{ image: string; scale: number } | null> {
    const request = this.plugin.pageImage?.(page, IMAGE_WIDTH);
    if (request == null) return null;
    const image = await request.catch(() => null);
    if (image === null) return null;
    const pdfPage = await this.doc.getPage(page);
    return { image, scale: IMAGE_WIDTH / pdfPage.getViewport({ scale: 1 }).width };
  }

  private async draw(page: number): Promise<{ image: string; scale: number }> {
    const { canvas, scale } = await this.render(page);
    const image = canvas.toDataURL("image/png");
    // Free the canvas memory now (WebKit has a limit for all canvases together).
    canvas.width = 0;
    canvas.height = 0;
    return { image, scale };
  }

  private load(): Promise<void> {
    this.loaded ??= this.file
      .load()
      .catch(() => null)
      .then((text) => {
        for (const [page, formulas] of readFile(text, this.bytes, this.doc.numPages)) if (!this.found.has(page)) this.found.set(page, formulas);
        this.changed(false);
      });
    return this.loaded;
  }

  private changed(save = true): void {
    for (const listener of this.listeners) listener();
    if (!save) return;
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.file.save(fileText(this.found, this.bytes, this.doc.numPages)).catch(() => undefined);
    }, 1000);
  }
}

const stores = new Map<string, PdfFormulaStore>();

/** The formula store of a PDF (`key`: its web key; `bytes`: its size). A new PDF under the same key gets a new store. */
export function formulaStore(key: string, doc: pdfjs.PDFDocumentProxy, bytes: number, plugin: FormulaPlugin, file: FormulaFile): PdfFormulaStore {
  const id = `${key}:${bytes}:${doc.numPages}`;
  let store = stores.get(id);
  if (store === undefined) {
    store = new PdfFormulaStore(key, doc, bytes, plugin, file);
    stores.set(id, store);
  } else store.connect(plugin, file);
  return store;
}

type Reply = { width: number; height: number; formulas: { box: number[]; display: boolean }[] };

function readReply(value: unknown): Reply {
  const record = (value ?? {}) as Partial<Reply>;
  if (typeof record.width !== "number" || typeof record.height !== "number" || !Array.isArray(record.formulas)) throw new Error("The plugin gave a bad reply.");
  return record as Reply;
}

function readTexts(value: unknown, count: number): string[] {
  const texts = (value as { texts?: unknown } | null)?.texts;
  return Array.from({ length: count }, (_, at) => (Array.isArray(texts) && typeof texts[at] === "string" ? (texts[at] as string) : ""));
}

/** One formula cut out of the page image, as a PNG data URL. */
function cut(canvas: HTMLCanvasElement, box: Box, scale: number): string {
  const left = Math.max(0, Math.floor(box.left * scale));
  const top = Math.max(0, Math.floor(box.top * scale));
  const width = Math.max(1, Math.min(canvas.width - left, Math.ceil(box.width * scale)));
  const height = Math.max(1, Math.min(canvas.height - top, Math.ceil(box.height * scale)));
  const piece = document.createElement("canvas");
  piece.width = width;
  piece.height = height;
  piece.getContext("2d")?.drawImage(canvas, left, top, width, height, 0, 0, width, height);
  const image = piece.toDataURL("image/png");
  piece.width = 0;
  piece.height = 0;
  return image;
}

/** The text of a cache file. */
export function fileText(found: ReadonlyMap<number, readonly PageFormula[]>, bytes: number, pages: number): string {
  const byPage = Object.fromEntries([...found].map(([page, formulas]) => [page, formulas.map(({ box, display, tex }) => ({ box, display, ...(tex === undefined ? {} : { tex }) }))]));
  return JSON.stringify({ version: CACHE_VERSION, bytes, pages, found: byPage });
}

/** The found formulas of a cache file, by page. Empty if the file is missing, of an other PDF, or not readable. */
export function readFile(text: string | null, bytes: number, pages: number): Map<number, PageFormula[]> {
  const out = new Map<number, PageFormula[]>();
  if (text === null) return out;
  try {
    const value = JSON.parse(text) as { version?: unknown; bytes?: unknown; pages?: unknown; found?: unknown };
    if (value.version !== CACHE_VERSION || value.bytes !== bytes || value.pages !== pages || typeof value.found !== "object" || value.found === null) return out;
    for (const [key, list] of Object.entries(value.found as Record<string, unknown>)) {
      const page = Number(key);
      if (!Number.isInteger(page) || page < 1 || page > pages || !Array.isArray(list)) continue;
      const formulas = list.flatMap((entry: { box?: Record<string, unknown>; display?: unknown; tex?: unknown }) =>
        entry?.box !== undefined && ["left", "top", "width", "height"].every((side) => typeof entry.box![side] === "number") && typeof entry.display === "boolean"
          ? [{ page, box: entry.box as unknown as Box, display: entry.display, ...(typeof entry.tex === "string" ? { tex: entry.tex } : {}) }]
          : [],
      );
      out.set(page, formulas);
    }
  } catch {
    return new Map();
  }
  return out;
}

/**
 * The range in the page text of each formula: the characters whose middle is in its box (`charBoxes`: the box of
 * each character, in the units of the formula boxes, in text order). A formula with no characters there (a picture)
 * has no range.
 */
export function formulaRanges<F extends { box: Box }>(formulas: readonly F[], charBoxes: readonly { offset: number; box: Box }[]): (F & { start: number; end: number })[] {
  const out: (F & { start: number; end: number })[] = [];
  for (const formula of formulas) {
    const { box } = formula;
    let start = Infinity;
    let end = -Infinity;
    for (const char of charBoxes) {
      const x = char.box.left + char.box.width / 2;
      const y = char.box.top + char.box.height / 2;
      if (x < box.left || x > box.left + box.width || y < box.top || y > box.top + box.height) continue;
      start = Math.min(start, char.offset);
      end = Math.max(end, char.offset + 1);
    }
    if (Number.isFinite(start)) out.push({ ...formula, start, end });
  }
  // In text order, without overlaps (the first one wins).
  out.sort((a, b) => a.start - b.start);
  const kept: (F & { start: number; end: number })[] = [];
  for (const formula of out) if (kept.length === 0 || formula.start >= kept[kept.length - 1]!.end) kept.push(formula);
  return kept;
}

/** A formula with a text range, for read aloud (formulas.ts). */
export function asFormula(formula: PageFormula & { start: number; end: number }): Formula {
  return { start: formula.start, end: formula.end, tex: formula.tex, display: formula.display };
}
