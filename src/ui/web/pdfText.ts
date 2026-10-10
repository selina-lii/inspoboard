// The plain text of a PDF, for search. PDF.js is large: this module loads only when a search needs it.

import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** The text of all pages, one line for each text line of a page. */
export async function pdfPlainText(data: ArrayBuffer): Promise<string> {
  const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)), cMapUrl: "/pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "/pdfjs/standard_fonts/", wasmUrl: "/pdfjs/wasm/", iccUrl: "/pdfjs/iccs/" });
  const doc = await task.promise;
  try {
    const pages: string[] = [];
    for (let number = 1; number <= doc.numPages; number += 1) {
      const content = await (await doc.getPage(number)).getTextContent();
      pages.push(content.items.map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : "")).join(""));
    }
    return pages.join("\n");
  } finally {
    void task.destroy();
  }
}
