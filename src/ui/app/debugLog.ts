// The UI side of the session log (the file is written by the backend: src-tauri/src/debug_log.rs, SPEC 10).
// - logEvent(text): one line. Lines go to the backend in groups, each second. That call is also the heartbeat: if the
//   UI stops (a long task, an endless loop), the backend watchdog writes it in the log.
// - The UI also measures its own stops: a timer that comes late by STALL_MS or more writes how long the UI stopped,
//   and the last event before it.
// - No text of notes or pages: only actions, IDs, counts, durations, and errors. Quoted names are left out.

import { useEffect } from "react";
import type { Backend } from "../../io/backend";

const TICK_MS = 1000;
const STALL_MS = 1500;

let lines: string[] = [];
let lastEvent = "";

/** One event for the session log. */
export function logEvent(text: string): void {
  const line = withoutQuotes(text);
  lastEvent = line;
  if (lines.length < 500) lines.push(line);
}

/** An error for the session log: its message and the first lines of its stack. */
export function logError(where: string, error: unknown): void {
  const text = error instanceof Error ? `${error.name}: ${error.message} | ${(error.stack ?? "").split("\n").slice(1, 4).map((line) => line.trim()).join(" | ")}` : String(error);
  logEvent(`${where}: ${text}`);
}

/** Names in quotes ("…", “…”, 「…」) can be the user's words: the log has "…" in their place. */
function withoutQuotes(text: string): string {
  return text.replace(/"[^"]*"/g, '"…"').replace(/“[^”]*”/g, "“…”").replace(/「[^」]*」/g, "「…」");
}

/** Sends the events each second (the heartbeat), and logs errors and stops of the UI. */
export function useSessionLog(backend: Backend): void {
  useEffect(() => {
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const late = now - last - TICK_MS;
      last = now;
      if (late >= STALL_MS) logEvent(`The UI stopped for ${(late / 1000).toFixed(1)} s. Last event before: ${lastEvent || "none"}`);
      const sending = lines;
      lines = [];
      void backend.logEvents(sending).catch(() => undefined);
    }, TICK_MS);
    const onError = (event: ErrorEvent) => logError("Error", event.error ?? event.message);
    const onRejection = (event: PromiseRejectionEvent) => logError("Unhandled promise error", event.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [backend]);
}
