// Gets the PDFium library (the PDF engine of Chrome; BSD license) for this computer into src-tauri/pdfium/, for the
// app build (SPEC 7.8, 9). Build time only: the app itself makes no network request. A pinned version with its
// SHA-256 (from the release page of bblanchon/pdfium-binaries). Nothing to do if the library is there.
// Run by `npm run dev` and `npm run build` (predev, prebuild).

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RELEASE = "chromium/8100";
const BUILDS = {
  "darwin-arm64": { asset: "pdfium-mac-arm64.tgz", sha256: "7ea647c7a7a9c1169be3f947000bc071ece2fade2cd6bd7e401e3675c6560cce", file: "lib/libpdfium.dylib" },
  "darwin-x64": { asset: "pdfium-mac-x64.tgz", sha256: "d513a0530a0f0c1ca9929ded06660e27edb9a108a7d18d9df55a5fb060b091c8", file: "lib/libpdfium.dylib" },
  "win32-x64": { asset: "pdfium-win-x64.tgz", sha256: "51621bcc1d9be9ea448f4b84b0516862b928e3968d3fca899af1a6d6e2848d6d", file: "bin/pdfium.dll" },
  "linux-x64": { asset: "pdfium-linux-x64.tgz", sha256: "1c1894a12d4d96ee01400c3874444126254180c5c7d2ab628576b67f8120320a", file: "lib/libpdfium.so" },
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "src-tauri/pdfium");
const build = BUILDS[`${process.platform}-${process.arch}`];
if (build === undefined) {
  console.log(`fetch-pdfium: no PDFium build for ${process.platform}-${process.arch}; PDFs draw with pdf.js.`);
  process.exit(0);
}
const library = join(target, build.file.split("/").pop());
if (existsSync(library)) process.exit(0);

const url = `https://github.com/bblanchon/pdfium-binaries/releases/download/${RELEASE}/${build.asset}`;
console.log(`fetch-pdfium: ${url}`);
const response = await fetch(url);
if (!response.ok) throw new Error(`fetch-pdfium: download failed (${response.status}).`);
const bytes = Buffer.from(await response.arrayBuffer());
const hash = createHash("sha256").update(bytes).digest("hex");
if (hash !== build.sha256) throw new Error(`fetch-pdfium: the file is not the pinned build (SHA-256 ${hash}).`);
const folder = mkdtempSync(join(tmpdir(), "pdfium-"));
try {
  writeFileSync(join(folder, build.asset), bytes);
  execFileSync("tar", ["-xzf", join(folder, build.asset), "-C", folder]);
  mkdirSync(target, { recursive: true });
  copyFileSync(join(folder, build.file), library);
  copyFileSync(join(folder, "LICENSE"), join(target, "LICENSE-pdfium.txt"));
  console.log(`fetch-pdfium: ${library}`);
} finally {
  rmSync(folder, { recursive: true, force: true });
}
