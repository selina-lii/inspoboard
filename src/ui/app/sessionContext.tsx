// React bindings for a session. Views read data only through these hooks.

import { logEvent } from "./debugLog";
import { createContext, useCallback, useContext, useSyncExternalStore } from "react";
import type { Command } from "../../core/commands";
import { withTrashMarks } from "../../core/trash";
import type { Session, SessionState } from "../../io/session";

const SessionContext = createContext<Session | null>(null);

export const SessionProvider = SessionContext.Provider;

/**
 * A change of the commands of one part of the UI, before they run: `after` runs when the command ran.
 * The board area uses it for processing maps (SPEC 7.16: copy on write).
 */
export type CommandScope = (command: Command) => { command: Command; after?: () => void };
const CommandScopeContext = createContext<CommandScope | null>(null);
export const CommandScopeProvider = CommandScopeContext.Provider;

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (session === null) throw new Error("useSession() needs a SessionProvider.");
  return session;
}

/** Re-renders the component after each store write. Returns the store revision. */
export function useStoreRevision(): number {
  const session = useSession();
  const subscribe = useCallback((listener: () => void) => session.store.subscribe(listener), [session]);
  return useSyncExternalStore(subscribe, () => session.store.getRevision());
}

export function useSessionState(): SessionState {
  const session = useSession();
  const subscribe = useCallback((listener: () => void) => session.subscribe(listener), [session]);
  return useSyncExternalStore(subscribe, () => session.getState());
}

export type HistoryState = { canUndo: boolean; canRedo: boolean; undoLabel?: string; redoLabel?: string };

export function useHistoryState(): HistoryState {
  const session = useSession();
  const subscribe = useCallback((listener: () => void) => session.history.subscribe(listener), [session]);
  const snapshot = useCallback(
    () => `${session.history.canUndo()}|${session.history.canRedo()}|${session.history.nextUndoLabel() ?? ""}|${session.history.nextRedoLabel() ?? ""}`,
    [session],
  );
  const key = useSyncExternalStore(subscribe, snapshot);
  const [canUndo, canRedo, undoLabel, redoLabel] = key.split("|");
  return { canUndo: canUndo === "true", canRedo: canRedo === "true", undoLabel, redoLabel };
}

/**
 * Returns a function that runs a command. In a read-only vault, it does nothing.
 * All views must change data through this function.
 */
export function useRunCommand(): (command: Command) => boolean {
  const session = useSession();
  const scope = useContext(CommandScopeContext);
  return useCallback(
    (input: Command) => {
      if (session.getState().readOnly) return false;
      const { command, after } = scope?.(input) ?? { command: input };
      // An item that loses its last card goes to the trash (and leaves it when it gets a card): see core/trash.ts.
      const start = performance.now();
      session.history.run(withTrashMarks(session.context, session.rootId, command));
      const ms = Math.round(performance.now() - start);
      logEvent(`Command: ${command.label} (${command.ops.length} changes${ms >= 50 ? `, ${ms} ms` : ""})`);
      after?.();
      return true;
    },
    [session, scope],
  );
}
