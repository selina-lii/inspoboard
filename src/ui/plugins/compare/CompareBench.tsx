// The compare bench (lab plugin "compare-text"): a small floating panel above all views, with the look of the link
// bench but its own feature. Two slots, Left and Right: put an item or a passage in each, then "Compare" opens the
// compare view (SPEC 7.15). It shows only while a compare plugin is installed.
// - Fill a slot: drag a card onto it, "Selected text", "Search…", "Send to compare bench" (right-click a card), or
//   pick the slot (click it) and then click a card. Esc, or a click on the slot, stops the pick.
// - Folded, it is a round button with a dot for each full slot. Its place, and folded, open, or hidden, stay in this
//   window (local storage): view state, not data.

import { ArrowLeftRight, Columns2, FileText, Globe, Minimize2, Search, TextSelect, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { PassageEnd } from "../../../core/linkEnds";
import { BENCH_ITEM_TYPE } from "../../app/LinkBench";
import { lastPassage, usePassage } from "../../app/passages";
import { useSession, useStoreRevision } from "../../app/sessionContext";
import { useWorkspaceActions } from "../../app/workspaceActions";
import { titleOf } from "../../board/boardModel";
import { usePlugins } from "../pluginsContext";
import "../plugins.css";
import "./compareBench.css";

type Slot = 0 | 1;
const SEND_EVENT = "inspoboard-compare-bench";
const TOGGLE_EVENT = "inspoboard-compare-bench-toggle";
/** A bench picked a slot: the other bench stops its pick (only one takes the next click on a card). */
export const BENCH_PICK_EVENT = "inspoboard-bench-pick";
const STORAGE_KEY = "inspoboard.compareBench";

/** Puts an end in the compare bench: in `slot`, or in the first free slot (else the right slot). The bench opens. */
export function sendToCompareBench(end: PassageEnd, slot?: Slot): void {
  window.dispatchEvent(new CustomEvent<{ end: PassageEnd; slot?: Slot }>(SEND_EVENT, { detail: { end, slot } }));
}

/** The More menu: shows or hides the compare bench. */
export function toggleCompareBench(): void {
  window.dispatchEvent(new Event(TOGGLE_EVENT));
}

/** The slot of the compare bench under a point of the window: 0, 1, "bench" (elsewhere on it), or null. Board drags use it. */
export function compareSlotAt(clientX: number, clientY: number): Slot | "bench" | null {
  for (const element of document.elementsFromPoint(clientX, clientY)) {
    const slot = element.closest("[data-compare-slot]")?.getAttribute("data-compare-slot");
    if (slot === "0" || slot === "1") return Number(slot) as Slot;
    if (element.closest(".compare-bench") !== null) return "bench";
  }
  return null;
}

type Stored = { x: number; y: number; open: boolean; hidden: boolean };

function readStored(): Stored {
  // At first: folded, at the left of the link bench.
  const fallback: Stored = { x: window.innerWidth - 148, y: window.innerHeight - 96, open: false, hidden: false };
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Stored> | null;
    if (value === null || typeof value !== "object") return fallback;
    return { x: typeof value.x === "number" ? value.x : fallback.x, y: typeof value.y === "number" ? value.y : fallback.y, open: value.open === true, hidden: value.hidden === true };
  } catch {
    return fallback;
  }
}

function writeStored(value: Stored): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // No storage: the bench works, it does not keep its place.
  }
}

/** The item of a pressed element (a card, a comment, a row with `data-item-id`), or null. */
function itemOfElement(element: Element): string | null {
  if (element.closest(".compare-bench, .link-bench, input, textarea, [contenteditable=true], .nodrag") !== null) return null;
  return element.closest("[data-item-id]")?.getAttribute("data-item-id") ?? element.closest(".react-flow__node")?.querySelector("[data-item-id]")?.getAttribute("data-item-id") ?? null;
}

export function CompareBench() {
  const plugins = usePlugins();
  const installed = plugins.plugins.some((plugin) => plugin.details !== null && plugin.capabilities.includes("compare-text"));
  return installed ? <Bench /> : null;
}

function Bench() {
  const session = useSession();
  const actions = useWorkspaceActions();
  useStoreRevision();
  const passage = usePassage();
  const [stored, setStored] = useState<Stored>(readStored);
  const [slots, setSlots] = useState<[PassageEnd | null, PassageEnd | null]>([null, null]);
  const [message, setMessage] = useState<string | null>(null);
  const [over, setOver] = useState<Slot | null>(null);
  const [armed, setArmed] = useState<Slot | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);

  const update = useCallback((changes: Partial<Stored>) => {
    setStored((current) => {
      const next = { ...current, ...changes };
      writeStored(next);
      return next;
    });
  }, []);

  // Keep the bench in the window.
  const clamp = useCallback(() => {
    const box = panel.current?.getBoundingClientRect();
    const width = box?.width ?? 56;
    const height = box?.height ?? 56;
    setStored((current) => {
      const x = Math.min(Math.max(8, current.x), Math.max(8, window.innerWidth - width - 8));
      const y = Math.min(Math.max(8, current.y), Math.max(8, window.innerHeight - height - 8));
      return x === current.x && y === current.y ? current : { ...current, x, y };
    });
  }, []);
  useEffect(() => {
    clamp();
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, [clamp, stored.open]);

  const put = useCallback(
    (end: PassageEnd, slot?: Slot) => {
      setSlots((current) => {
        const next: [PassageEnd | null, PassageEnd | null] = [...current];
        next[slot ?? (current[0] === null ? 0 : 1)] = end;
        return next;
      });
      setMessage(null);
      update({ open: true, hidden: false });
    },
    [update],
  );

  useEffect(() => {
    const onSend = (event: Event) => {
      const { end, slot } = (event as CustomEvent<{ end: PassageEnd; slot?: Slot }>).detail;
      put(end, slot);
    };
    const onToggle = () =>
      setStored((current) => {
        const next = { ...current, hidden: !current.hidden };
        writeStored(next);
        return next;
      });
    // The link bench picked a slot: this bench stops its pick.
    const onPick = (event: Event) => (event as CustomEvent<string>).detail !== "compare" && setArmed(null);
    window.addEventListener(SEND_EVENT, onSend);
    window.addEventListener(TOGGLE_EVENT, onToggle);
    window.addEventListener(BENCH_PICK_EVENT, onPick);
    return () => {
      window.removeEventListener(SEND_EVENT, onSend);
      window.removeEventListener(TOGGLE_EVENT, onToggle);
      window.removeEventListener(BENCH_PICK_EVENT, onPick);
    };
  }, [put]);

  // A pick never stays on unseen: it ends when the bench folds or hides.
  useEffect(() => {
    if (!stored.open || stored.hidden) setArmed(null);
  }, [stored.open, stored.hidden]);

  // A picked slot: a click on a card puts it in the slot. The view does not get that click (no select, no open).
  useEffect(() => {
    if (armed === null) return;
    window.dispatchEvent(new CustomEvent<string>(BENCH_PICK_EVENT, { detail: "compare" }));
    let pressed: string | null = null;
    const swallow = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const itemId = itemOfElement(event.target as Element);
      if (itemId === null || !session.store.has("items", itemId)) return;
      swallow(event);
      pressed = itemId;
    };
    const onUp = (event: PointerEvent) => {
      if (pressed === null) return;
      swallow(event);
      put({ itemId: pressed }, armed);
      pressed = null;
      setArmed(null);
    };
    const onMouse = (event: Event) => pressed !== null && swallow(event);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      swallow(event);
      setArmed(null);
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    for (const type of ["mousedown", "mouseup", "click", "dblclick"]) window.addEventListener(type, onMouse, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
      for (const type of ["mousedown", "mouseup", "click", "dblclick"]) window.removeEventListener(type, onMouse, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [armed, put, session]);

  // A slot whose item is gone empties.
  useEffect(() => {
    setSlots((current) => {
      const next = current.map((end) => (end !== null && !session.store.has("items", end.itemId) ? null : end)) as [PassageEnd | null, PassageEnd | null];
      return next[0] === current[0] && next[1] === current[1] ? current : next;
    });
  });

  if (stored.hidden) return null;

  // Move: drag the bench by its head (or the folded button). A press without a move on the folded button opens it.
  const onPointerDown = (event: ReactPointerEvent) => {
    if (event.button !== 0 || (event.target as Element).closest("button:not(.compare-bench-pet), input, [data-compare-slot]") !== null) return;
    drag.current = { dx: event.clientX - stored.x, dy: event.clientY - stored.y, moved: false };
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent) => {
    const state = drag.current;
    if (state === null) return;
    const x = event.clientX - state.dx;
    const y = event.clientY - state.dy;
    if (!state.moved && Math.hypot(x - stored.x, y - stored.y) < 3) return;
    state.moved = true;
    setStored((current) => ({ ...current, x, y }));
  };
  const onPointerUp = () => {
    const state = drag.current;
    drag.current = null;
    if (state !== null && !state.moved && !stored.open) {
      update({ open: true });
      return;
    }
    if (state?.moved === true) {
      clamp();
      setStored((current) => {
        writeStored(current);
        return current;
      });
    }
  };

  // Drops: a list row (its item), or dragged selected text (the last selected passage, if it is that text).
  const dropProps = (slot: Slot) => ({
    onDragOver: (event: DragEvent) => {
      event.preventDefault();
      setOver(slot);
    },
    onDragLeave: () => setOver((current) => (current === slot ? null : current)),
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      setOver(null);
      const itemId = event.dataTransfer.getData(BENCH_ITEM_TYPE);
      if (itemId !== "" && session.store.has("items", itemId)) return put({ itemId }, slot);
      const text = event.dataTransfer.getData("text/plain").trim();
      const last = lastPassage();
      if (text !== "" && last !== null && last.quote.trim() === text) return put(last, slot);
      setMessage("Drop a card, or text that you selected in a note, a page, a web page, or a PDF.");
    },
  });

  const search = async (slot: Slot) => {
    const found = await actions.searchLinkTarget("Compare with… (search all boards)");
    if (found !== null) put({ itemId: found.itemId, quote: found.quote }, slot);
  };

  const filled = slots.filter((end) => end !== null).length;

  if (!stored.open) {
    return (
      <div ref={panel} className="compare-bench folded" style={{ left: stored.x, top: stored.y }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onDragOver={(event) => (event.preventDefault(), update({ open: true }))}>
        <button className="compare-bench-pet" data-tip="Compare bench (lab): two items side by side" onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && update({ open: true })}>
          <Columns2 size={20} />
          <span className="compare-bench-dots" aria-hidden="true">
            <span className={slots[0] !== null ? "full" : ""} />
            <span className={slots[1] !== null ? "full" : ""} />
          </span>
        </button>
      </div>
    );
  }

  const slotView = (slot: Slot) => {
    const end = slots[slot];
    const item = end === null ? undefined : session.store.get("items", end.itemId);
    const web = item?.url !== undefined && item.url !== "";
    return (
      <div
        className={`compare-bench-slot${end === null ? " empty" : ""}${over === slot ? " over" : ""}${armed === slot ? " armed" : ""}`}
        data-compare-slot={slot}
        data-tip={armed === slot ? undefined : "Click, then click a card"}
        onClick={(event) => {
          if ((event.target as Element).closest("button") !== null) return;
          setArmed((current) => (current === slot ? null : slot));
        }}
        {...dropProps(slot)}
      >
        <div className="compare-bench-slot-head">
          <span className="compare-bench-slot-role">{slot === 0 ? "Left side" : "Right side"}</span>
          {end !== null && (
            <button className="icon-button small" data-tip="Empty this slot" onClick={() => setSlots((current) => (slot === 0 ? [null, current[1]] : [current[0], null]))}>
              <X size={12} />
            </button>
          )}
        </div>
        {end === null ? (
          <>
            <div className="compare-bench-hint">{armed === slot ? "Click a card" : "Click, then click a card"}</div>
            <div className="compare-bench-fill">
              <button disabled={passage === null} data-tip={passage === null ? "Select text in a note, a page, a web page, or a PDF first" : `Selected text: “${shorten(passage.quote, 80)}”`} onClick={() => passage !== null && put(passage, slot)}>
                <TextSelect size={13} /> Selected text
              </button>
              <button data-tip="Find an item or a passage in all boards" onClick={() => void search(slot)}>
                <Search size={13} /> Search…
              </button>
            </div>
          </>
        ) : (
          <button className="compare-bench-end" data-tip="Show it" onClick={() => actions.openAt(end.itemId, end.quote !== undefined ? { quote: end.quote } : {})}>
            <span className="compare-bench-end-title">
              {web ? <Globe size={12} /> : <FileText size={12} />}
              <span translate="no" dir="auto">{titleOf(session.store, end.itemId)}</span>
            </span>
            {end.quote !== undefined && end.quote !== "" ? (
              <span className="compare-bench-end-quote" translate="no" dir="auto">
                “{shorten(end.quote, 140)}”
              </span>
            ) : (
              <span className="compare-bench-end-kind">Whole item</span>
            )}
          </button>
        )}
      </div>
    );
  };

  return (
    <div ref={panel} className="compare-bench open" style={{ left: stored.x, top: stored.y }} role="dialog" aria-label="Compare bench">
      <div className="compare-bench-head" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        <Columns2 size={14} />
        <span className="compare-bench-title">Compare bench</span>
        <span className="plugin-lab" data-tip="Experimental: it can change or go away.">Lab</span>
        <span className="compare-bench-count muted">{`${filled} / 2`}</span>
        <button className="icon-button small" data-tip="Fold the bench" onClick={() => update({ open: false })}>
          <Minimize2 size={12} />
        </button>
        <button className="icon-button small" data-tip="Hide the bench (More ⋯ › Compare bench shows it)" onClick={() => update({ hidden: true })}>
          <X size={12} />
        </button>
      </div>
      <div className="compare-bench-body">
        {slotView(0)}
        <div className="compare-bench-middle">
          <button className="primary compare-bench-link" disabled={slots[0] === null || slots[1] === null} data-tip={slots[0] !== null && slots[1] !== null ? "Show the two side by side with their differences" : "Fill both slots first"} onClick={() => actions.compare(slots[0]!, slots[1]!)}>
            Compare
          </button>
          <button className="icon-button small" data-tip="Swap the two sides" disabled={filled === 0} onClick={() => setSlots((current) => [current[1], current[0]])}>
            <ArrowLeftRight size={13} />
          </button>
        </div>
        {slotView(1)}
      </div>
      {armed !== null && slots[armed] !== null && <div className="compare-bench-message">Click a card to replace this side. Esc: stop.</div>}
      {message !== null && <div className="compare-bench-message">{message}</div>}
    </div>
  );
}

function shorten(text: string, length: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length)}…` : flat;
}
