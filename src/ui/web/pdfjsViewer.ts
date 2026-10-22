// The pdf.js viewer components (pdfjs-dist/web/pdf_viewer.mjs: the page viewer of the Firefox PDF reader). That
// module reads the pdf.js library from globalThis.pdfjsLib: it is set here first, then the module loads.

import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
(globalThis as { pdfjsLib?: unknown }).pdfjsLib = pdfjs;

export const viewerModule = import("pdfjs-dist/web/pdf_viewer.mjs");
export { pdfjs };
