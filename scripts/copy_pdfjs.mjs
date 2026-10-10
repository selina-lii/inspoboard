// Copies the PDF.js data files (character maps, standard fonts, color profiles, decoders) to public/pdfjs.
// The app loads them from there (no network). Runs before "dev" and "build". The folder is not in Git.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const source = join("node_modules", "pdfjs-dist");
const target = join("public", "pdfjs");
mkdirSync(target, { recursive: true });
for (const folder of ["cmaps", "standard_fonts", "iccs", "wasm"]) {
  if (existsSync(join(source, folder))) cpSync(join(source, folder), join(target, folder), { recursive: true });
}
