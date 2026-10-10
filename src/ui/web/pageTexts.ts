// The texts of saved web pages and PDFs, for the board search (⌘F). See docs/SPEC.md section 7.4.
// - A link object whose page is saved in the vault (web/<key>.html or web/<key>.pdf) is searched in its page text.
// - The app reads the files when a search opens and keeps the texts in memory while the vault is open (no cache file).
//   A page that is saved again is read again.

import type { Id } from "../../core/types";
import type { Session } from "../../io/session";
import { isWebUrl, pagePath, pdfPath, webKey } from "./savedPages";

const caches = new WeakMap<Session, Map<string, Promise<string | null>>>();

function cacheOf(session: Session): Map<string, Promise<string | null>> {
  let cache = caches.get(session);
  if (cache === undefined) {
    cache = new Map();
    caches.set(session, cache);
  }
  return cache;
}

/** After a new save of a page: its text is read again at the next search. */
export function forgetPageText(session: Session, key: string): void {
  cacheOf(session).delete(key);
}

/** The text of a saved HTML page: without scripts and styles, blocks on their own lines. */
export function htmlText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const element of doc.querySelectorAll("script, style, noscript, template, svg")) element.remove();
  for (const element of doc.querySelectorAll("p, div, li, h1, h2, h3, h4, h5, h6, br, tr, section, article, blockquote, figcaption, pre")) element.append("\n");
  return (doc.body?.textContent ?? "").replace(/[ \t ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

async function readText(session: Session, key: string): Promise<string | null> {
  const html = await session.readWebFile(pagePath(key)).catch(() => null);
  if (html !== null) return htmlText(html);
  try {
    const data = await session.readWebBytes(pdfPath(key));
    const { pdfPlainText } = await import("./pdfText");
    return await pdfPlainText(data);
  } catch {
    return null;
  }
}

/** The page texts of all link objects with a saved page, by the ID of the link object. */
export async function savedPageTexts(session: Session): Promise<Map<Id, string>> {
  const cache = cacheOf(session);
  const result = new Map<Id, string>();
  await Promise.all(
    [...session.store.all("items")].map(async (item) => {
      if (item.url === undefined || !isWebUrl(item.url)) return;
      const key = await webKey(item.url);
      let text = cache.get(key);
      if (text === undefined) {
        text = readText(session, key);
        cache.set(key, text);
      }
      const value = await text;
      if (value !== null && value !== "") result.set(item.id, value);
    }),
  );
  return result;
}
