// Problems found when the app reads or checks a vault.
// The app shows problems to the user. It never repairs data by deleting it.

import type { Id } from "./types";

export type ProblemSeverity = "error" | "warning";

export type Problem = {
  /** An error makes the vault read-only. A warning does not. */
  severity: ProblemSeverity;
  code: string;
  message: string;
  /** Vault-relative file path. */
  path?: string;
  /** 1-based line number in the file. */
  line?: number;
  recordId?: Id;
};

export function hasErrors(problems: readonly Problem[]): boolean {
  return problems.some((problem) => problem.severity === "error");
}
