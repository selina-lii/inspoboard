// The plain text of a PDF, for search and compare. PDF.js is large: this module loads only when one needs it.

import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const OPTIONS = { cMapUrl: "/pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "/pdfjs/standard_fonts/", wasmUrl: "/pdfjs/wasm/", iccUrl: "/pdfjs/iccs/" };

/**
 * A piece of the text and its box on its page. `start` and `end` are indexes in the text. The box is in page units
 * (scale 1, from the top-left corner of the page).
 */
export type PlacedRun = { start: number; end: number; page: number; left: number; top: number; width: number; height: number; font: string };

/** The text of a PDF with the place of each piece. `pages`: the size of each page in page units. */
export type PlacedText = { text: string; pages: { width: number; height: number }[]; runs: PlacedRun[] };

/** The text of all pages, one line for each text line of a page. */
export async function pdfPlainText(data: ArrayBuffer): Promise<string> {
  return (await pdfPlacedText(data)).text;
}

/** The text of all pages (as pdfPlainText) and the box of each text piece. */
export async function pdfPlacedText(data: ArrayBuffer): Promise<PlacedText> {
  const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)), ...OPTIONS });
  const doc = await task.promise;
  try {
    let text = "";
    const pages: PlacedText["pages"] = [];
    const runs: PlacedRun[] = [];
    for (let number = 1; number <= doc.numPages; number += 1) {
      if (number > 1) text += "\n";
      const page = await doc.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      pages.push({ width: viewport.width, height: viewport.height });
      const content = await textContentOf(page);
      for (const item of content.items) {
        if (!("str" in item)) continue;
        if (item.str !== "") {
          // The box of the text, as the text layer of pdf.js places it: the baseline point, up by the font height.
          const [, , c, d, x, y] = pdfjs.Util.transform(viewport.transform, item.transform) as number[];
          const height = Math.hypot(c!, d!);
          // The font family (serif, sans-serif, monospace): for the width of a part of the run.
          const font = content.styles[item.fontName]?.fontFamily ?? "serif";
          runs.push({ start: text.length, end: text.length + item.str.length, page: number, left: x!, top: y! - height, width: item.width, height, font });
        }
        text += item.str + (item.hasEOL ? "\n" : "");
      }
    }
    return { text, pages, runs };
  } finally {
    void task.destroy();
  }
}

/** The text items of a page, with the styles of their fonts. */
export type PageTextContent = { items: Awaited<ReturnType<pdfjs.PDFPageProxy["getTextContent"]>>["items"]; styles: Record<string, { fontFamily: string; ascent?: number; descent?: number; vertical?: boolean }> };

/**
 * The text items of a page. Not `page.getTextContent()`: it reads its stream with `for await`, and WebKit (the app
 * window on macOS) cannot iterate a ReadableStream that way ("undefined is not a function"). A reader can.
 * `params`: as streamTextContent (the reader uses the params of the pdf.js text layer, so the items are the same).
 */
export async function textContentOf(page: pdfjs.PDFPageProxy, params?: { includeMarkedContent?: boolean; disableNormalization?: boolean }): Promise<PageTextContent> {
  const reader = page.streamTextContent(params).getReader() as ReadableStreamDefaultReader<PageTextContent>;
  const items: PageTextContent["items"] = [];
  const styles: PageTextContent["styles"] = {};
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    items.push(...value.items);
    Object.assign(styles, value.styles);
  }
  return { items, styles };
}

/** An open PDF that draws its pages into canvases (when the backend cannot draw them: no PDFium). */
export async function openPdfPages(data: ArrayBuffer): Promise<{ draw(page: number, canvas: HTMLCanvasElement, width: number): Promise<void>; close(): void }> {
  const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)), ...OPTIONS });
  const doc = await task.promise;
  return {
    draw: async (number, canvas, width) => {
      const page = await doc.getPage(number);
      const ratio = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      await page.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] }).promise;
    },
    close: () => void task.destroy(),
  };
}
