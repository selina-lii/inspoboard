// Web pages: save a page with the web plugin, then read it in the app. See docs/SPEC.md section 7.8.
// - A saved page is one file in the vault (web/<key>.html). Opening it again needs no network and no plugin.
// - The reader shows the page without scripts. A click on text reads aloud from there.
// - Highlights and scribbles go to a separate file (web/<key>.notes.json). The page file does not change.

import { Globe, LoaderCircle, X } from "lucide-react";
import { MovablePanel } from "../app/movable";
import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { useSession } from "../app/sessionContext";
import { usePlugins } from "../plugins/pluginsContext";
import { fileNameOfPath, isLocalPath, isPdfPath, isWebUrl, normalizeUrl, pagePath, pdfPath, webKey } from "./savedPages";
import { WebReader } from "./WebReader";
import { isAnnotated } from "./annotatedPages";
import { forgetPageText } from "./pageTexts";
import { t } from "../i18n/i18n";
// PDF.js is large: the PDF reader loads when the first PDF opens.
const PdfReader = lazy(() => import("./PdfReader").then((module) => ({ default: module.PdfReader })));
import "./web.css";

/** `autoRead`: start to read aloud from the top when the page is ready (for example "Read aloud" on a link object). */
/** `find`: find this text in the page when it is ready (a hit of the board search). */
export type HtmlPage = { kind: "html"; key: string; url: string; html: string; autoRead?: boolean; find?: string };
export type PdfPage = { kind: "pdf"; key: string; url: string; title: string; data: ArrayBuffer; autoRead?: boolean; find?: string };

/** What the open reader can do for the plugin menu: read aloud, and translate the page. */
export type ReaderApi = {
  readFromSelection(): void;
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
  /** Opens the saved copy of a page. Without one (or with `again`), the web plugin saves the page first. `read`: then read it aloud. */
  openWebPage(url: string, again?: boolean, read?: boolean, find?: string): Promise<void>;
  /**
   * A click on a link: a web address opens in the web browser (nothing is saved). A page with notes opens its saved
   * copy (annotatedPages.ts). A local file opens as with openWebPage.
   */
  jumpTo(url: string): Promise<void>;
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
};

const WebPagesContext = createContext<WebPagesValue | null>(null);

export function useWebPages(): WebPagesValue | null {
  return useContext(WebPagesContext);
}

type Status = { kind: "saving"; url: string } | { kind: "error"; message: string } | null;

export function WebPagesProvider({ children }: { children: ReactNode }) {
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
  const openWebPage = useCallback(
    async (url: string, again = false, read = false, find?: string) => {
      // A local file: a PDF opens in the reader (a copy goes into the vault); any other file shows in Finder.
      if (isLocalPath(url)) {
        setStatus(null);
        try {
          if (isPdfPath(url)) {
            const key = await session.importPdfFrom(url);
            const data = await session.readWebBytes(pdfPath(key));
            setPage({ kind: "pdf", key, url: url.trim(), title: fileNameOfPath(url), data, autoRead: read });
          } else {
            await session.revealFile(url);
          }
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
      const key = await webKey(url);
      try {
        const saved = again ? null : await loadSaved(session, key, url);
        if (saved !== null) {
          setPage({ ...saved, autoRead: read, find });
          setStatus(null);
          return;
        }
        if (saver === null) throw new Error("This page is not saved. To save web pages, install the Web pages plugin (Settings → Plugins).");
        setStatus({ kind: "saving", url });
        const result = (await pluginsRef.current.callWithProgress(saver.name, "save_page", { url: normalizeUrl(url) }, true)) as Record<string, unknown> | undefined;
        if (result?.kind === "pdf" && typeof result.data === "string") {
          const bytes = base64Bytes(result.data);
          await session.writeWebBytes(pdfPath(key), bytes);
          forgetPageText(session, key);
          setPage({ kind: "pdf", key, url: normalizeUrl(url), title: typeof result.title === "string" ? result.title : url, data: bytes.buffer, autoRead: read });
        } else {
          if (typeof result?.html !== "string" || result.html === "") throw new Error("The plugin gave no page.");
          await session.writeWebFile(pagePath(key), result.html);
          forgetPageText(session, key);
          setPage({ kind: "html", key, url: normalizeUrl(url), html: result.html, autoRead: read });
        }
        setStatus(null);
      } catch (problem) {
        setStatus({ kind: "error", message: String(problem).replace(/^Error: /, "") });
      }
    },
    [session, saver],
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
    async (url: string) => {
      if (isLocalPath(url) || !isWebUrl(url)) return openWebPage(url);
      // A page with notes: always its saved copy, so the notes stay on their text.
      if (await isAnnotated(session, url)) return openWebPage(url);
      return openInBrowser(url);
    },
    [session, openWebPage, openInBrowser],
  );

  const openPdfFile = useCallback(async () => {
    setStatus(null);
    try {
      const key = await session.importPdf();
      if (key === null) return;
      const data = await session.readWebBytes(pdfPath(key));
      setPage({ kind: "pdf", key, url: "", title: "PDF", data });
    } catch (problem) {
      setStatus({ kind: "error", message: String(problem).replace(/^Error: /, "") });
    }
  }, [session]);

  const value = useMemo<WebPagesValue>(
    () => ({ page, openWebPage, jumpTo, openInBrowser, openPdfFile, close: () => setPage(null), canSave: saver !== null, reader, toolSlot, setToolSlot }),
    [page, openWebPage, jumpTo, openInBrowser, openPdfFile, saver, toolSlot],
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

export function WebOpener({ openRef, jumpRef, browserRef }: { openRef: MutableRefObject<(url: string, read?: boolean, find?: string) => void>; jumpRef: MutableRefObject<(url: string) => void>; browserRef: MutableRefObject<(url: string) => void> }) {
  const web = useWebPages();
  openRef.current = (url, read, find) => void web?.openWebPage(url, false, read === true, find);
  jumpRef.current = (url) => void web?.jumpTo(url);
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
            if ((await isAnnotated(session, page.url)) && !window.confirm(t(SAVE_AGAIN_WARNING))) return;
            await web.openWebPage(page.url, true);
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

/** A saved page (HTML) or PDF of an address, or null. */
async function loadSaved(session: ReturnType<typeof useSession>, key: string, url: string): Promise<WebPage | null> {
  const html = await session.readWebFile(pagePath(key));
  if (html !== null) return { kind: "html", key, url: normalizeUrl(url), html };
  try {
    const data = await session.readWebBytes(pdfPath(key));
    const name = new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? url;
    return { kind: "pdf", key, url: normalizeUrl(url), title: decodeURIComponent(name), data };
  } catch {
    return null;
  }
}

function base64Bytes(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** A tool bar button: type an address, then save and read the page. */
export function WebButton() {
  const web = useWebPages();
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const frame = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (frame.current !== null && !frame.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);
  if (web === null) return null;
  const submit = () => {
    const url = /^[a-z]+:\/\//i.test(address.trim()) ? address.trim() : `https://${address.trim()}`;
    setOpen(false);
    void web.openWebPage(url);
  };
  return (
    <span className="plugin-menu" ref={frame}>
      <button className={`icon-button${open ? " active" : ""}`} data-tip="Read a web page or a PDF" onClick={() => setOpen((current) => !current)}>
        <Globe size={16} />
      </button>
      {open && (
        <MovablePanel className="plugin-popover" titleClassName="plugin-popover-title" label="Read a web page" title="Read a web page or a PDF">
          <input
            disabled={!web.canSave}
            autoFocus
            placeholder="https://…"
            value={address}
            spellCheck={false}
            onChange={(event) => setAddress(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && address.trim() !== "") submit();
              if (event.key === "Escape") setOpen(false);
            }}
          />
          <div className="plugin-buttons">
            <button className="primary" disabled={address.trim() === "" || !web.canSave} onClick={submit}>
              Save and read
            </button>
            <button
              onClick={() => {
                setOpen(false);
                void web.openPdfFile();
              }}
            >
              Open a PDF file…
            </button>
          </div>
          <div className="plugin-note muted">
            {web.canSave
              ? "The page (or PDF) is saved in the vault as one file. Later it opens without network. ⌘-click a web link in a note to open it too."
              : "To save web pages, install the Web pages plugin (Settings → Plugins). PDF files from this computer open without it."}
          </div>
        </MovablePanel>
      )}
    </span>
  );
}
