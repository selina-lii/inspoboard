// View history: back and forward through the boards and view modes, as in a browser.
// View history is view state. It is not saved and it is not part of undo.

import { useCallback, useState } from "react";
import type { Id } from "../../core/types";

export type ViewMode = "2d" | "3d";

/** One view: the boards from the root to the open board, and 2D or 3D. */
export type View = { path: Id[]; mode: ViewMode };

const MAX_ENTRIES = 200;

export type Navigation = {
  view: View;
  /** Goes to a new view. Views after the current one (for "forward") are dropped. */
  go(update: (current: View) => View): void;
  back(): void;
  forward(): void;
  canBack: boolean;
  canForward: boolean;
};

export function useNavigation(rootId: Id): Navigation {
  const [state, setState] = useState<{ entries: View[]; index: number }>({ entries: [{ path: [rootId], mode: "2d" }], index: 0 });
  const go = useCallback((update: (current: View) => View) => {
    setState(({ entries, index }) => {
      const current = entries[index]!;
      const next = update(current);
      if (sameView(current, next)) return { entries, index };
      const kept = [...entries.slice(Math.max(0, index + 1 - MAX_ENTRIES + 1), index + 1), next];
      return { entries: kept, index: kept.length - 1 };
    });
  }, []);
  const back = useCallback(() => setState((current) => ({ ...current, index: Math.max(0, current.index - 1) })), []);
  const forward = useCallback(() => setState((current) => ({ ...current, index: Math.min(current.entries.length - 1, current.index + 1) })), []);
  return {
    view: state.entries[state.index]!,
    go,
    back,
    forward,
    canBack: state.index > 0,
    canForward: state.index < state.entries.length - 1,
  };
}

function sameView(a: View, b: View): boolean {
  return a.mode === b.mode && a.path.length === b.path.length && a.path.every((id, index) => id === b.path[index]);
}
