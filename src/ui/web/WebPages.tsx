// Web pages: save a page with the web plugin, then read it in the app. See docs/SPEC.md sections 1.1 and 7.8.
// - A saved page or PDF is the copy of a document: it belongs to one link object (webHomes.ts). Its file is
//   web/<link object ID>.html (or .pdf). Opening it again needs no network and no plugin.
// - A page that opens with no link object (the globe button, a web address in a text, a PDF file) gets one: the
//   link object of that address that was made first, or a new one on the current board (one undo step).
// - The reader shows the page without scripts.
// - Highlights and scribbles go to a separate file (web/<link object ID>.notes.json). The page file does not change.
//   Small items (comments, notes, …) on the page are vault items inside the link object (core/inside.ts).

import { LoaderCircle, X } from "lucide-react";
import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { useSession } from "../app/sessionContext";
import { usePlugins } from "../plugins/pluginsContext";
import { fileNameOfPath, isLocalPath, isPdfPath, isWebUrl, normalizeUrl, pagePath, pdfPath } from "./savedPages";
import { oldestLinkObject } from "./webHomes";
import type { Id } from "../../core/types";
import type { ReadMode } from "../plugins/speech";
import { WebReader } from "./WebReader";
import { isAnnotated } from "./annotatedPages";
import { forgetPageText } from "./pageTexts";
import { t } from "../i18n/i18n";
// PDF.js is large: the PDF reader loads when the first PDF opens.
const PdfReader = lazy(() => import("./PdfReader").then((module) => ({ default: module.PdfReader })));
import "./web.css";

/**
 * An open page or PDF:
 * - `key`: the link object (its ID): the key of its notes (web/<key>.notes.json) and of its small items.
 * - `itemId`: the link object (the home of the small items on the page).
 * - `autoRead`: start to read aloud from the top when the page is ready (for example "Read aloud" on a link object).
 * - `find`: find this text in the page when it is ready (a hit of the board search).
 */
type PageBase = { key: string; itemId: Id; url: string; autoRead?: boolean; find?: string };
export type HtmlPage = PageBase & { kind: "html"; html: string };
export type PdfPage = PageBase & { kind: "pdf"; title: string; data: ArrayBuffer };

/** What the open reader can do for the plugin menu: read aloud, and translate the page. */
export type ReaderApi = {
  /** Read aloud: from the start, only the selected text, or from the selected text to the end. */
  read(mode: ReadMode): void;
  /** True if text of the page is selected. */
  hasSelection(): boolean;
  /** The text that "Read aloud" reads: from the selected text to the end, or all (for the time estimate). */
  textToRead(): { text: string; fromSelection: boolean };
  /** Translates the page (paragraph by paragraph) into a column at the right of the page. */
  translate(plugin: string): void;
  hideTranslation(): void;
  /** True while the translation column shows. */
  translated: boolean;
};
export type WebPage = HtmlPage | PdfPage;

type WebPagesValue = {
  page: WebPage | null;
  /**
   * Opens the copy of a link object (`itemId`; without it: the link object of the address, or a new one). Without a
   * copy (or with `again`), the web plugin saves the page first. `read`: then read it aloud.
   */
  openWebPage(url: string, again?: boolean, read?: boolean, find?: string, itemId?: Id): Promise<void>;
  /**
   * A click on a link: a web address opens in the web browser (nothing is saved). A page with notes opens its saved
   * copy (annotatedPages.ts). A local file opens as with openWebPage.
   */
  jumpTo(url: string, itemId?: Id): Promise<void>;
  /** Opens a web address in the web browser, also for a page with notes (the link menu). */
  openInBrowser(url: string): Promise<void>;
  /** The open reader registers itself here. The "Read aloud" button of the plugin menu uses it. */
  reader: MutableRefObject<ReaderApi | null>;
  close(): void;
  /** A file dialog: a PDF from this computer goes into the vault, then it opens. No plugin needed. */
  openPdfFile(): Promise<void>;
  /** True if a plugin can save pages. */
  canSave: boolean;
  /** The place in the main tool bar for the reader tools (see ReaderToolSlot). */
  toolSlot: HTMLElement | null;
  setToolSlot(element: HTMLElement | null): void;
  /** "Save again from the web" of the open page (null: none). It is in the "More" menu (⋯) of the top bar. */
  saveAgain: (() => void) | null;
  setSaveAgain(run: (() => void) | null): void;
};

const WebPagesContext = createContext<WebPagesValue | null>(null);

export function useWebPages(): WebPagesValue | null {
  return useContext(WebPagesContext);
}

type Status = { kind: "saving"; url: string } | { kind: "error"; message: string } | null;

/**
 * `makeHome`: the link object of an address for the current board (one undo step), or null (read-only vault). The
 * workspace gives it. `existing`: the item of the address (made before, maybe on an other board): the current board
 * gets a shadow of it (a reference card: a click opens that same item), not a new item. Null: a new link object.
 */
export function WebPagesProvider({ children, makeHome }: { children: ReactNode; makeHome(url: string, name: string, existing: Id | null): Id | null }) {
  const session = useSession();
  const plugins = usePlugins();
  const [page, setPage] = useState<WebPage | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const saver = plugins.plugins.find((plugin) => plugin.details !== null && plugin.capabilities.includes("save-page")) ?? null;
  const pluginsRef = useRef(plugins);
  pluginsRef.current = plugins;

  // A new vault: no page.
  useEffect(() => setPage(null), [session]);

  const reader = useRef<ReaderApi | null>(null);
  const [toolSlot, setToolSlot] = useState<HTMLElement | null>(null);
  const [saveAgain, setSaveAgainState] = useState<(() => void) | null>(null);
  const setSaveAgain = useCallback((run: (() => void) | null) => setSaveAgainState(() => run), []);
  const makeHomeRef = useRef(makeHome);
  makeHomeRef.current = makeHome;
  /** The link object of a page: the given one, else the first one of the address (with a shadow here), else a new one. */
  const homeOf = useCallback(
    (url: string, itemId: Id | undefined, name: string): Id => {
      if (itemId !== undefined && session.store.has("items", itemId)) return itemId;
      const home = makeHomeRef.current(url, name, oldestLinkObject(session.store, url));
      if (home === null) throw new Error("The vault is read-only: the page cannot get a link object.");
      return home;
    },
    [session],
  );
  const openWebPage = useCallback(
    async (url: string, again = false, read = false, find?: string, itemId?: Id) => {
      // A local file: a PDF opens in the reader (a copy goes into the vault); any other file shows in Finder.
      if (isLocalPath(url)) {
        setStatus(null);
        try {
          if (!isPdfPath(url)) {
            await session.revealFile(url);
            return;
          }
          const home = homeOf(url.trim(), itemId, fileNameOfPath(url));
          // Its own copy, else a new copy of the file.
          let data = await session.readWebBytes(pdfPath(home)).catch(() => null);
          if (data === null) {
            await session.importPdfFrom(url, home);
            data = await session.readWebBytes(pdfPath(home));
          }
          setPage({ kind: "pdf", key: home, itemId: home, url: url.trim(), title: fileNameOfPath(url), data, autoRead: read, find });
        } catch (problem) {
          setStatus({ kind: "error", message: String(problem).replace(/^Error: /, "") });
        }
        return;
      }
      if (!isWebUrl(url)) {
        setStatus({ kind: "error", message: `"${url}" is not a web address (http or https).` });
        return;
      }
      setStatus(null);
      try {
        const known = itemId !== undefined && session.store.has("items", itemId) ? itemId : oldestLinkObject(session.store, url);
        const saved = again || known === null ? null : await loadSaved(session, known, url);
        if (saved !== null) {
          setPage({ ...saved, autoRead: read, find });
          setStatus(null);
          return;
        }
        if (saver === null) throw new Error("This page is not saved. To save web pages, install the Web pages plugin (Settings → Plugins).");
        setStatus({ kind: "saving", url });
        const result = (await pluginsRef.current.callWithProgress(saver.name, "save_page", { url: normalizeUrl(url) }, true)) as Record<string, unknown> | undefined;
        const title = typeof result?.title === "string" ? result.title : "";
        // The copy belongs to a link object: the given one, the first one of the address, or a new one.
        const home = homeOf(url, known ?? undefined, title);
        if (result?.kind === "pdf" && typeof result.data === "string") {
          const bytes = base64Bytes(result.data);
          await session.writeWebBytes(pdfPath(home), bytes);
          forgetPageText(session, home);
          setPage({ kind: "pdf", key: home, itemId: home, url: normalizeUrl(url), title: title !== "" ? title : url, data: bytes.buffer, autoRead: read });
        } else {
          if (typeof result?.html !== "string" || result.html === "") throw new Error("The plugin gave no page.");
          await session.writeWebFile(pagePath(home), result.html);
          forgetPageText(session, home);
          setPage({ kind: "html", key: home, itemId: home, url: normalizeUrl(url), html: result.html, autoRead: read });
        }
        setStatus(null);
      } catch (problem) {
        setStatus({ kind: "error", message: String(problem).replace(/^Error: /, "") });
      }
    },
    [session, saver, homeOf],
  );

  const openInBrowser = useCallback(
    async (url: string) => {
      setStatus(null);
      try {
        await session.openInBrowser(normalizeUrl(url));
      } catch (problem) {
        setStatus({ kind: "error", message: String(problem).replace(/^Error: /, "") });
      }
    },
    [session],
  );

  const jumpTo = useCallback(
    async (url: string, itemId?: Id) => {
      if (isLocalPath(url) || !isWebUrl(url)) return openWebPage(url, false, false, undefined, itemId);
      // A page with notes: always its saved copy, so the notes stay on their text.
      const home = itemId !== undefined && session.store.has("items", itemId) ? itemId : oldestLinkObject(session.store, url);
      if (home !== null && (await isAnnotated(session, home, url))) return openWebPage(url, false, false, undefined, home);
      return openInBrowser(url);
    },
    [session, openWebPage, openInBrowser],
  );

  // "Open a PDF file…": the PDF gets a link object (its path) and a copy in the vault.
  const openPdfFile = useCallback(async () => {
    setStatus(null);
    try {
      const path = await session.choosePdf();
      if (path !== null) await openWebPage(path);
    } catch (problem) {
      setStatus({ kind: "error", message: String(problem).replace(/^Error: /, "") });
    }
  }, [session, openWebPage]);

  const value = useMemo<WebPagesValue>(
    () => ({ page, openWebPage, jumpTo, openInBrowser, openPdfFile, close: () => setPage(null), canSave: saver !== null, reader, toolSlot, setToolSlot, saveAgain, setSaveAgain }),
    [page, openWebPage, jumpTo, openInBrowser, openPdfFile, saver, toolSlot, saveAgain, setSaveAgain],
  );

  return (
    <WebPagesContext.Provider value={value}>
      {children}
      <WebStatus status={status} onClose={() => setStatus(null)} />
    </WebPagesContext.Provider>
  );
}

function WebStatus({ status, onClose }: { status: Status; onClose(): void }) {
  const plugins = usePlugins();
  if (status === null) return null;
  const job = plugins.job;
  return (
    <div className={`web-status${status.kind === "error" ? " error" : ""}`} role="status">
      {status.kind === "saving" ? (
        <>
          <LoaderCircle size={14} className="spin" />
          <span>{job !== null && job.label !== "" ? job.label : `Saving ${status.url}…`}</span>
          <button onClick={plugins.cancel}>Cancel</button>
        </>
      ) : (
        <>
          <span>{status.message}</span>
          <button className="icon-button small" data-tip="Close" data-tip-end onClick={onClose}>
            <X size={14} />
          </button>
        </>
      )}
    </div>
  );
}

/** Gives the open function to the workspace (its actions are outside this provider). */
const SAVE_AGAIN_WARNING =
  "This page has your notes. Saving it again replaces the saved copy (the old copy is not kept). Highlights find their text again; scribbles, comments, and notes stay at their places and can be off their text if the page changed.\n\nSave the page again?";

export function WebOpener({ openRef, jumpRef, browserRef, openPageRef }: { openRef: MutableRefObject<(url: string, read?: boolean, find?: string, itemId?: Id) => void>; jumpRef: MutableRefObject<(url: string, itemId?: Id) => void>; browserRef: MutableRefObject<(url: string) => void>; openPageRef: MutableRefObject<boolean> }) {
  const web = useWebPages();
  openPageRef.current = web?.page != null;
  openRef.current = (url, read, find, itemId) => void web?.openWebPage(url, false, read === true, find, itemId);
  jumpRef.current = (url, itemId) => void web?.jumpTo(url, itemId);
  browserRef.current = (url) => void web?.openInBrowser(url);
  return null;
}

/** The place in the main tool bar where the open reader shows its tools. */
export function ReaderToolSlot() {
  const web = useWebPages();
  return <span className="reader-tool-slot" ref={web?.setToolSlot} />;
}


/** Shows its children only while no page is open (the board tools: the reader has its own tools then). */
export function WhenNoPage({ children }: { children: ReactNode }) {
  const web = useWebPages();
  return web?.page == null ? <>{children}</> : null;
}

/** The reader above the board, while a page is open. */
export function WebReaderLayer() {
  const web = useWebPages();
  const session = useSession();
  if (web?.page == null) return null;
  const page = web.page;
  const again =
    page.url !== "" && web.canSave
      ? () =>
          void (async () => {
            // A page with notes: the new copy replaces the saved one. Scribbles, comments, and notes keep their places
            // on the canvas, so they can move off their text if the page changed. Ask first.
            if ((await isAnnotated(session, page.itemId, page.url)) && !window.confirm(t(SAVE_AGAIN_WARNING))) return;
            await web.openWebPage(page.url, true, false, undefined, page.itemId);
          })()
      : undefined;
  if (page.kind === "pdf") {
    return (
      <Suspense fallback={<div className="web-reader pdf-loading muted">Opening the PDF reader…</div>}>
        <PdfReader key={page.key} page={page} onClose={web.close} onSaveAgain={again} />
      </Suspense>
    );
  }
  return <WebReader key={page.key} page={page} onClose={web.close} onSaveAgain={again ?? (() => undefined)} />;
}

/** The copy (HTML or PDF) of a link object. Null if it has none. */
async function loadSaved(session: ReturnType<typeof useSession>, home: Id, url: string): Promise<WebPage | null> {
  const base = { key: home, itemId: home, url: normalizeUrl(url) };
  const name = () => {
    try {
      return decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? url);
    } catch {
      return url;
    }
  };
  const html = await session.readWebFile(pagePath(home));
  if (html !== null) return { ...base, kind: "html", html };
  const data = await session.readWebBytes(pdfPath(home)).catch(() => null);
  if (data !== null) return { ...base, kind: "pdf", title: name(), data };
  return null;
}

function base64Bytes(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

