// View history: back and forward through the boards and view modes, as in a browser.
// View history is view state. It is not saved and it is not part of undo.
// Each entry keeps a snapshot of the view when it was left (the open windows, the board view, the scroll places):
// back and forward give it again, so a return shows exactly what was there (SPEC 7.1).

import { useCallback, useRef, useState } from "react";
import type { Id } from "../../core/types";

export type ViewMode = "2d" | "3d";

/** One view: the boards from the root to the open board, and 2D or 3D. */
export type View = { path: Id[]; mode: ViewMode };

const MAX_ENTRIES = 200;

type Entry<S> = { view: View; snapshot?: S };

export type Navigation<S = unknown> = {
  view: View;
  /** Goes to a new view. Views after the current one (for "forward") are dropped. `force`: a new entry also for the same view (a jump). */
  go(update: (current: View) => View, force?: boolean): void;
  back(): void;
  forward(): void;
  canBack: boolean;
  canForward: boolean;
  /** After back or forward: the snapshot of the view that shows now, to give again (a new object each time). Else null. */
  arrived: { snapshot: S | undefined } | null;
};

/** The history: its entries and the one that shows. `arrived`: set by back and forward (the snapshot to give again). */
export type History<S> = { entries: Entry<S>[]; index: number; arrived: { snapshot: S | undefined } | null };

/** A new view after the current one (its snapshot is kept). Views after it are dropped. */
export function historyGo<S>({ entries, index }: History<S>, update: (current: View) => View, snapshot: S, force = false): History<S> {
  const current = entries[index]!;
  const next = update(current.view);
  if (!force && sameView(current.view, next)) return { entries, index, arrived: null };
  const kept = [...entries.slice(Math.max(0, index + 1 - MAX_ENTRIES + 1), index), { ...current, snapshot }, { view: next }];
  return { entries: kept, index: kept.length - 1, arrived: null };
}

/** One step back (-1) or forward (1). The view that is left keeps its snapshot. */
export function historyStep<S>({ entries, index }: History<S>, delta: -1 | 1, snapshot: S): History<S> {
  const target = Math.min(entries.length - 1, Math.max(0, index + delta));
  if (target === index) return { entries, index, arrived: null };
  const kept = entries.map((entry, at) => (at === index ? { ...entry, snapshot } : entry));
  return { entries: kept, index: target, arrived: { snapshot: kept[target]!.snapshot } };
}

/** `capture`: the snapshot of the view that shows now (called when it is left). */
export function useNavigation<S>(rootId: Id, capture: () => S): Navigation<S> {
  const [state, setState] = useState<History<S>>({ entries: [{ view: { path: [rootId], mode: "2d" } }], index: 0, arrived: null });
  const captureRef = useRef(capture);
  captureRef.current = capture;
  const go = useCallback((update: (current: View) => View, force = false) => {
    const snapshot = captureRef.current();
    setState((current) => historyGo(current, update, snapshot, force));
  }, []);
  const back = useCallback(() => {
    const snapshot = captureRef.current();
    setState((current) => historyStep(current, -1, snapshot));
  }, []);
  const forward = useCallback(() => {
    const snapshot = captureRef.current();
    setState((current) => historyStep(current, 1, snapshot));
  }, []);
  return {
    view: state.entries[state.index]!.view,
    go,
    back,
    forward,
    canBack: state.index > 0,
    canForward: state.index < state.entries.length - 1,
    arrived: state.arrived,
  };
}

function sameView(a: View, b: View): boolean {
  return a.mode === b.mode && a.path.length === b.path.length && a.path.every((id, index) => id === b.path[index]);
}
