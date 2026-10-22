// A check that the board shows each card of its model (SPEC 7.1). React Flow hides a card that it has not measured
// (it has no fixed size: a folded card, a link object). Cards have gone missing that way before, and came back only
// when the board opened again: a board with hundreds of cards makes that hard to see.
// After the cards change, and the board is quiet: each card of the model must have its node, its element, and a size.
// A missing card is measured again (React Flow's updateNodeInternals), and the session log gets one line with the
// board ID, the card IDs, and the reason (IDs only, no text).

import { useEffect } from "react";
import { useUpdateNodeInternals, type Edge, type ReactFlowInstance } from "@xyflow/react";
import type { Id } from "../../core/types";
import { logEvent } from "../app/debugLog";
import type { BoardModel } from "./boardModel";
import type { FlowNode } from "./nodes";

/** The wait after a change: React Flow measures new cards in the next frames. */
const QUIET_MS = 1500;

/** Why a card of the model does not show, or null if it shows. */
function missingReason(flow: ReactFlowInstance<FlowNode, Edge>, nodeId: string): string | null {
  const internal = flow.getInternalNode(nodeId);
  if (internal === undefined) return "no-node";
  const element = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`);
  if (element === null) return "no-element";
  if (!(internal.measured.width ?? 0) || !(internal.measured.height ?? 0)) return "no-size";
  if (getComputedStyle(element).visibility === "hidden") return "hidden";
  return null;
}

export function useShownCheck(flow: ReactFlowInstance<FlowNode, Edge>, model: BoardModel, boardId: Id): void {
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const missing: { id: string; reason: string }[] = [];
      for (const node of model.nodes) {
        // A stub is a small marker of a link: not a card of the board.
        if (node.kind === "stub") continue;
        const reason = missingReason(flow, node.id);
        if (reason !== null) missing.push({ id: node.id, reason });
      }
      if (missing.length === 0) return;
      logEvent(`shown-check board=${boardId} missing=${missing.length}/${model.nodes.length} remeasure=${missing.slice(0, 30).map((entry) => `${entry.id}(${entry.reason})`).join(",")}`);
      updateNodeInternals(missing.map((entry) => entry.id));
      // Once more after the new measure: a card that still does not show is a different fault (the log says so).
      window.setTimeout(() => {
        const still = missing.filter((entry) => missingReason(flow, entry.id) !== null);
        if (still.length > 0) logEvent(`shown-check board=${boardId} still-missing=${still.length} ids=${still.slice(0, 30).map((entry) => `${entry.id}(${missingReason(flow, entry.id)})`).join(",")}`);
      }, QUIET_MS);
    }, QUIET_MS);
    return () => window.clearTimeout(timer);
  }, [flow, model, boardId, updateNodeInternals]);
}
