#!/usr/bin/env node
// The feature manager: reads manage/features.md (one table row per feature) and uses it to manage the tests.
//
//   node manage/features.mjs list [query]      the features (all, or the ones that match)
//   node manage/features.mjs check             problems in the list; features with no test; tests that no feature uses
//   node manage/features.mjs test <query…>     runs the tests of the matching features (--dry: only shows the commands)
//   node manage/features.mjs manual <query…>   the checks by hand of the matching features (a checklist)
//
// A query matches an ID ("pdf.cache"), the start of an ID ("pdf" → pdf.*), or a word in the name or the text.
// Test names: "speech" = tests/speech.test.ts; "cargo:<folder>" = cargo test in that folder;
// "node:<folder>" = npm test in that folder. This script changes no file.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIST = join(root, "manage/features.md");

/** The rows of all tables: {area, id, name, what, tests[], manual, spec}. */
function readFeatures() {
  const features = [];
  let area = "";
  for (const line of readFileSync(LIST, "utf8").split("\n")) {
    if (line.startsWith("## ")) area = line.slice(3).trim();
    if (!line.startsWith("|") || line.startsWith("|---") || line.startsWith("| ID ")) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 6) continue;
    const [id, name, what, tests, manual, spec] = cells;
    features.push({ area, id, name, what, tests: tests === "—" ? [] : tests.split(",").map((test) => test.trim()).filter(Boolean), manual: manual === "—" ? "" : manual, spec });
  }
  return features;
}

function matches(feature, query) {
  const q = query.toLowerCase();
  const word = new RegExp(`(^|[^\\p{L}\\p{N}])${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "u");
  return feature.id === q || feature.id.startsWith(`${q}.`) || word.test(`${feature.name} ${feature.what}`.toLowerCase());
}

function select(features, queries) {
  if (queries.length === 0) return features;
  return features.filter((feature) => queries.some((query) => matches(feature, query)));
}

/** Where a test name points: a vitest file, or a folder for cargo or npm. */
function testTarget(test) {
  if (test.startsWith("cargo:")) return { kind: "cargo", path: test.slice(6) };
  if (test.startsWith("node:")) return { kind: "node", path: test.slice(5) };
  return { kind: "vitest", path: `tests/${test}.test.ts` };
}

function testExists(test) {
  const target = testTarget(test);
  if (target.kind === "cargo") return existsSync(join(root, target.path, "Cargo.toml"));
  if (target.kind === "node") return existsSync(join(root, target.path, "package.json"));
  return existsSync(join(root, target.path));
}

function list(queries) {
  const features = select(readFeatures(), queries);
  let area = "";
  for (const feature of features) {
    if (feature.area !== area) console.log(`\n${(area = feature.area)}`);
    const tests = feature.tests.length === 0 ? "no test" : feature.tests.join(", ");
    console.log(`  ${feature.id.padEnd(18)} ${feature.name} — ${tests}`);
  }
  console.log(`\n${features.length} features`);
}

function check() {
  const features = readFeatures();
  const problems = [];
  const seen = new Set();
  for (const feature of features) {
    if (seen.has(feature.id)) problems.push(`Two features have the ID "${feature.id}".`);
    seen.add(feature.id);
    for (const test of feature.tests) if (!testExists(test)) problems.push(`${feature.id}: the test "${test}" is not there (${testTarget(test).path}).`);
  }
  const used = new Set(features.flatMap((feature) => feature.tests));
  const files = readdirSync(join(root, "tests")).filter((name) => name.endsWith(".test.ts")).map((name) => name.replace(/\.test\.ts$/, ""));
  const unused = files.filter((name) => !used.has(name));
  const untested = features.filter((feature) => feature.tests.length === 0);
  console.log(`${features.length} features, ${features.length - untested.length} with tests.`);
  if (untested.length > 0) {
    console.log(`\nNo automated test (${untested.length}): check these by hand after a change.`);
    for (const feature of untested) console.log(`  ${feature.id.padEnd(18)} ${feature.name}`);
  }
  if (unused.length > 0) console.log(`\nTest files that no feature names: ${unused.join(", ")}`);
  if (problems.length > 0) {
    console.log("\nProblems:");
    for (const problem of problems) console.log(`  ${problem}`);
    process.exitCode = 1;
  } else console.log("\nNo problems in the list.");
}

function test(queries, dry) {
  const features = select(readFeatures(), queries);
  if (features.length === 0) {
    console.log(`No feature matches: ${queries.join(" ")}`);
    process.exitCode = 1;
    return;
  }
  const tests = [...new Set(features.flatMap((feature) => feature.tests))];
  console.log(`Features: ${features.map((feature) => feature.id).join(", ")}`);
  const manual = features.filter((feature) => feature.tests.length === 0).map((feature) => feature.id);
  if (manual.length > 0) console.log(`No automated test (check by hand): ${manual.join(", ")}`);
  const runs = [];
  const vitest = tests.filter((name) => testTarget(name).kind === "vitest").map((name) => testTarget(name).path);
  if (vitest.length > 0) runs.push({ command: "npx", args: ["vitest", "run", ...vitest], cwd: root });
  for (const name of tests) {
    const target = testTarget(name);
    if (target.kind === "cargo") runs.push({ command: "cargo", args: ["test", "--release"], cwd: join(root, target.path) });
    if (target.kind === "node") runs.push({ command: "npm", args: ["test"], cwd: join(root, target.path) });
  }
  let failed = false;
  for (const run of runs) {
    console.log(`\n$ (${run.cwd.slice(root.length + 1) || "."}) ${run.command} ${run.args.join(" ")}`);
    if (dry) continue;
    const result = spawnSync(run.command, run.args, { cwd: run.cwd, stdio: "inherit" });
    if (result.status !== 0) failed = true;
  }
  if (failed) process.exitCode = 1;
}

function manual(queries) {
  const features = select(readFeatures(), queries).filter((feature) => feature.manual !== "");
  console.log(`Check by hand (${features.length}):`);
  for (const feature of features) console.log(`- [ ] ${feature.name} (${feature.id}): ${feature.manual}`);
}

const [command = "list", ...rest] = process.argv.slice(2);
const dry = rest.includes("--dry");
const queries = rest.filter((arg) => arg !== "--dry");
if (command === "list") list(queries);
else if (command === "check") check();
else if (command === "test") test(queries, dry);
else if (command === "manual") manual(queries);
else {
  console.log("Commands: list [query], check, test <query…> [--dry], manual <query…>");
  process.exitCode = 1;
}
