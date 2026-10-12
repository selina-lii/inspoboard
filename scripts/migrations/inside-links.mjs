// One-time migration of a vault: small items inside pages and saved web pages (SPEC 1.1). See the README next to this
// file. The logic is in src/core/migrate/insideLinks.ts (the same code as the app: the same file format and checks).
//
// Use:  node scripts/migrations/inside-links.mjs "<vault folder>"            (dry run: it shows the plan, writes nothing)
//       node scripts/migrations/inside-links.mjs "<vault folder>" --apply    (backup, then write)
//
// Data safety:
// - A dry run writes nothing.
// - --apply first copies the whole vault folder (all but its .backup folder) to "<vault>/.backup/<time>_before-migration"
//   (the backup menu of the app lists it, and can delete it). Then it writes only the
//   changed table files, the new text files, and the new web files (atomic: a temporary file, then a rename).
// - It never deletes a file. A web copy never replaces a file that is there.
// - The app must be closed (the process in the vault lock file must not run).
// - After the writes, it reads the vault again and checks it.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const folderArg = args.find((arg) => !arg.startsWith("--"));
if (folderArg === undefined) {
  console.log('Use: node scripts/migrations/inside-links.mjs "<vault folder>" [--apply]');
  process.exit(2);
}
const vault = resolve(folderArg.replace(/^~(?=\/|$)/, homedir()));
if (!existsSync(join(vault, "vault.json"))) {
  console.error(`"${vault}" is not a vault folder (it has no vault.json).`);
  process.exit(2);
}
// The app must be closed. Its lock file (.inspoboard/lock) has the process ID of the app that opened the vault last.
const lockFile = join(vault, ".inspoboard", "lock");
if (existsSync(lockFile)) {
  const pid = Number.parseInt(readFileSync(lockFile, "utf8").trim(), 10);
  let running = false;
  if (Number.isInteger(pid) && pid > 0) {
    try {
      process.kill(pid, 0);
      const name = execFileSync("ps", ["-p", String(pid), "-o", "comm="], { encoding: "utf8" }).trim().toLowerCase();
      running = name.includes("inspoboard");
    } catch {
      running = false;
    }
  }
  if (running) {
    console.error(`The vault is open in Inspoboard (process ${pid}). Close the app first, then run this again.`);
    process.exit(2);
  }
}

// The migration code of the app, bundled for Node (rolldown is a dev dependency of the app).
const { build } = await import("rolldown");
const out = mkdtempSync(join(tmpdir(), "inspoboard-migrate-"));
await build({ input: join(repo, "src/core/migrate/insideLinks.ts"), output: { file: join(out, "insideLinks.mjs"), format: "es" }, platform: "node", logLevel: "warn" });
const { planInsideMigration } = await import(pathToFileURL(join(out, "insideLinks.mjs")).href);
rmSync(out, { recursive: true, force: true });

/** The vault files that the app reads: vault.json, table/*.jsonl, items/*.md. */
function readVaultFiles() {
  const files = new Map();
  files.set("vault.json", readFileSync(join(vault, "vault.json"), "utf8"));
  for (const folder of ["table", "items"]) {
    const full = join(vault, folder);
    if (!existsSync(full)) continue;
    for (const name of readdirSync(full)) {
      if ((folder === "table" && name.endsWith(".jsonl")) || (folder === "items" && name.endsWith(".md"))) files.set(`${folder}/${name}`, readFileSync(join(full, name), "utf8"));
    }
  }
  return files;
}

const webFolder = join(vault, "web");
const webNames = existsSync(webFolder) ? readdirSync(webFolder).filter((name) => !name.startsWith(".")) : [];
const web = { names: webNames, readText: (name) => (existsSync(join(webFolder, name)) ? readFileSync(join(webFolder, name), "utf8") : null) };

// A local PDF: its old shared copy is the PDF in web/ with the same content.
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const legacyPdfs = new Map();
for (const name of webNames) if (/^[0-9a-f]{24}\.pdf$/.test(name)) legacyPdfs.set(sha(join(webFolder, name)), name.slice(0, 24));
async function localPdfKey(url) {
  try {
    const path = url.startsWith("file://") ? fileURLToPath(url) : url.replace(/^~(?=\/|$)/, homedir());
    if (!path.toLowerCase().endsWith(".pdf") || !existsSync(path)) return null;
    return legacyPdfs.get(sha(path)) ?? null;
  } catch {
    return null;
  }
}

const before = readVaultFiles();
const plan = await planInsideMigration(before, web, localPdfKey, new Date().toISOString());
console.log(`Vault: ${vault}`);
console.log(plan.report.map((line) => `• ${line}`).join("\n"));
if (!plan.ok) process.exit(1);
const changedFiles = [...plan.files].filter(([path, content]) => before.get(path) !== content);
const nothing = changedFiles.length === 0 && plan.web.length === 0;
if (nothing) {
  console.log("Nothing changes.");
  process.exit(0);
}
console.log(`\nFiles to write: ${changedFiles.length} vault files, ${plan.web.length} web files.`);
for (const [path] of changedFiles) console.log(`  ${before.has(path) ? "change" : "new   "} ${path}`);
for (const step of plan.web) console.log(step.op === "copy" ? `  copy   web/${step.from} -> web/${step.to}` : `  write  web/${step.name}`);
if (!apply) {
  console.log("\nDry run: nothing was written. To migrate, run this again with --apply (it makes a backup first).");
  process.exit(0);
}

// Backup of the whole vault folder (not its .backup folder), in .backup: the backup menu of the app shows it.
const now = new Date();
const pad = (value) => String(value).padStart(2, "0");
const stamp = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}_${pad(now.getUTCHours())}-${pad(now.getUTCMinutes())}-${pad(now.getUTCSeconds())}`;
const backup = join(vault, ".backup", `${stamp}_before-migration`);
console.log(`\nBackup: ${backup}`);
mkdirSync(backup, { recursive: true });
for (const name of readdirSync(vault)) {
  if (name === ".backup") continue;
  cpSync(join(vault, name), join(backup, name), { recursive: true, errorOnExist: true, force: false });
}

const writeAtomic = (path, content) => {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.migrate-${process.pid}`;
  writeFileSync(temporary, content);
  renameSync(temporary, path);
};
for (const [path, content] of changedFiles) writeAtomic(join(vault, path), content);
for (const step of plan.web) {
  if (step.op === "copy") {
    const target = join(webFolder, step.to);
    if (existsSync(target)) continue;
    copyFileSync(join(webFolder, step.from), `${target}.migrate-${process.pid}`);
    renameSync(`${target}.migrate-${process.pid}`, target);
  } else {
    writeAtomic(join(webFolder, step.name), step.content);
  }
}

// Check: the vault reads again with no errors, and a second plan has nothing to do.
const again = await planInsideMigration(readVaultFiles(), { names: readdirSync(webFolder).filter((name) => !name.startsWith(".")), readText: web.readText }, localPdfKey, new Date().toISOString());
const rest = [...again.files].filter(([path, content]) => readVaultFiles().get(path) !== content).length + again.web.length;
if (!again.ok || rest !== 0) {
  console.error(`\nThe check after the migration found a problem. Your data is in the backup: ${backup}`);
  console.error(again.report.join("\n"));
  process.exit(1);
}
console.log("\nDone. The vault reads with no errors. Open it in the app. The backup stays until you delete it (the backup button of the app lists it).");
void statSync;
