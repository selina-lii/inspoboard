// Test helpers. Tests only read the fixture vault. They never write to it.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { GraphIndex } from "../src/core/graph";
import { History } from "../src/core/commands";
import { decodeVault, type VaultFiles } from "../src/core/format";
import type { ActionContext } from "../src/core/actions";
import { Store } from "../src/core/store";

// A fixed copy of the test vault. data/vault is for manual tests and can change.
export const TEST_VAULT = join(import.meta.dirname, "fixtures", "vault");

export const ROOT = "a1b2c3d4e5f6";
export const TOOL_RESEARCH = "k3f9a2m7q1xz";
export const IDEAS = "n7w2p9x4c8v1";
export const DATA_INTEGRITY = "m4q8z1r6t3y9";
export const STAR_STAMP = "s4h7d2j8f6g3";
export const RELATION = "l5t8r2k9m3q6";

/** Reads all files of the test vault into memory. */
export function readTestVault(): VaultFiles {
  const files: VaultFiles = new Map();
  const walk = (folder: string): void => {
    for (const name of readdirSync(folder)) {
      const full = join(folder, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.set(relative(TEST_VAULT, full).split(sep).join("/"), readFileSync(full, "utf8"));
    }
  };
  walk(TEST_VAULT);
  return files;
}

/** Makes deterministic IDs: id000000001, id000000002, ... */
export function counterIds(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `id${String(next).padStart(10, "0")}`;
  };
}

export type TestContext = ActionContext & { history: History };

export function contextFor(store: Store): TestContext {
  const graph = new GraphIndex(store);
  return { store, graph, history: new History(store), newId: counterIds(), now: () => "2026-10-07T12:00:00.000Z" };
}

export function loadTestContext(): TestContext {
  const { store, problems } = decodeVault(readTestVault());
  if (problems.some((problem) => problem.severity === "error")) {
    throw new Error(`Test vault has errors: ${JSON.stringify(problems)}`);
  }
  return contextFor(store);
}
