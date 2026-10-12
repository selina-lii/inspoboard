// The link bench: a small floating helper above all views (board, pages, web pages, PDFs), like a desktop pet.
// It has two slots and "Link" in the middle: put an item or a passage in each slot, then link them, wherever the two
// ends are. See docs/SPEC.md section 7.11.
// - Fill a slot: drag a card onto it, drag selected text onto it, "Selected text" (the last selection in any view),
//   "Search…" (all boards, names and texts), or "Send to link bench" (right-click a card or selected text).
// - Pick a slot (click it): then a drag of any card drags a ghost copy of it. The card does not move. A drop on the
//   bench puts the item in the picked slot (or in the slot under the pointer). Esc, or a click on the slot, stops it.
// - The left slot is the source, the right slot the target. ⇄ swaps them. A pin keeps a slot after "Link".
// - Folded, it is a round button with a dot for each full slot. Its place, and folded or open, stay in this window
//   (local storage): view state, not data.

import { ArrowRight, ArrowLeftRight, FileText, Globe, Link2, Minimize2, Pin, Search, TextSelect, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import { linkEnds, sameEnd, type PassageEnd } from "../../core/linkEnds";
import { pointEnds } from "../../core/inside";
import { titleOf } from "../board/boardModel";
import { lastPassage, usePassage } from "./passages";
import { useRunCommand, useSession, useSessionState, useStoreRevision } from "./sessionContext";
import { useWorkspaceActions } from "./workspaceActions";
import "./linkBench.css";

const SEND_EVENT = "inspoboard-link-bench";
/** The drag type of an item (a card or a list row) for the bench. */
export const BENCH_ITEM_TYPE = "application/x-inspoboard-item";
const STORAGE_KEY = "inspoboard.linkBench";

/** Puts an end in the bench: in `slot`, or in the first free slot (else the right slot). The bench opens. */
export function sendToBench(end: PassageEnd, slot?: 0 | 1): void {
  window.dispatchEvent(new CustomEvent<{ end: PassageEnd; slot?: 0 | 1 }>(SEND_EVENT, { detail: { end, slot } }));
}

/** The slot of the bench under a point of the window: 0, 1, or null. Board drags use it. */
export function benchSlotAt(clientX: number, clientY: number): 0 | 1 | "bench" | null {
  for (const element of document.elementsFromPoint(clientX, clientY)) {
    const slot = element.closest("[data-bench-slot]")?.getAttribute("data-bench-slot");
    if (slot === "0" || slot === "1") return Number(slot) as 0 | 1;
    if (element.closest(".link-bench") !== null) return "bench";
  }
  return null;
}

/** A function that gives the item of a pressed element (for example a board card), or null. Views register one. */
type ItemSource = (element: Element) => string | null;
const sources = new Set<ItemSource>();
/** Lets a view give the items of its elements for ghost drags to the bench. Returns the function that removes it. */
export function registerBenchSource(source: ItemSource): () => void {
  sources.add(source);
  return () => void sources.delete(source);
}
function itemOfElement(element: Element): string | null {
  if (element.closest(".link-bench, input, textarea, [contenteditable=true], .text-editor, .nodrag") !== null) return null;
  // The nearest marked item first (a comment in a page that is in a board card), then the views.
  const marked = element.closest("[data-item-id]")?.getAttribute("data-item-id");
  if (marked != null) return marked;
  for (const source of sources) {
    const id = source(element);
    if (id !== null) return id;
  }
  return null;
}

const HOVER_EVENT = "inspoboard-link-bench-hover";
/** A drag (for example of a board card) is over this part of the bench, or not (null). The bench shows it. */
export function hoverBench(slot: 0 | 1 | "bench" | null): void {
  window.dispatchEvent(new CustomEvent<0 | 1 | "bench" | null>(HOVER_EVENT, { detail: slot }));
}

type Stored = { x: number; y: number; open: boolean; hidden: boolean };

function readStored(): Stored {
  const fallback: Stored = { x: window.innerWidth - 84, y: window.innerHeight - 96, open: false, hidden: false };
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Stored> | null;
    if (value === null || typeof value !== "object") return fallback;
    return {
      x: typeof value.x === "number" ? value.x : fallback.x,
      y: typeof value.y === "number" ? value.y : fallback.y,
      open: value.open === true,
      hidden: value.hidden === true,
    };
  } catch {
    return fallback;
  }
}

function writeStored(value: Stored): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // No storage (a private window): the bench works, it does not keep its place.
  }
}

/** The top bar button: shows or hides the bench. */
const TOGGLE_EVENT = "inspoboard-link-bench-toggle";
export function toggleBench(): void {
  window.dispatchEvent(new Event(TOGGLE_EVENT));
}

export function LinkBench() {
  const session = useSession();
  const actions = useWorkspaceActions();
  const runCommand = useRunCommand();
  const { readOnly } = useSessionState();
  useStoreRevision();
  const passage = usePassage();
  const [stored, setStored] = useState<Stored>(readStored);
  const [slots, setSlots] = useState<[PassageEnd | null, PassageEnd | null]>([null, null]);
  const [pinned, setPinned] = useState<[boolean, boolean]>([false, false]);
  const [message, setMessage] = useState<string | null>(null);
  const [over, setOver] = useState<0 | 1 | null>(null);
  const [armed, setArmed] = useState<0 | 1 | null>(null);
  const [ghost, setGhost] = useState<{ itemId: string; x: number; y: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);

  const update = useCallback((changes: Partial<Stored>) => {
    setStored((current) => {
      const next = { ...current, ...changes };
      writeStored(next);
      return next;
    });
  }, []);

  // Keep the bench in the window (after a resize, or a place from a larger screen).
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

  const put = useCallback((end: PassageEnd, slot?: 0 | 1) => {
    setSlots((current) => {
      const next: [PassageEnd | null, PassageEnd | null] = [...current];
      const at = slot ?? (current[0] === null ? 0 : current[1] === null ? 1 : 1);
      next[at] = end;
      return next;
    });
    setMessage(null);
    update({ open: true, hidden: false });
  }, [update]);

  useEffect(() => {
    const onSend = (event: Event) => {
      const { end, slot } = (event as CustomEvent<{ end: PassageEnd; slot?: 0 | 1 }>).detail;
      put(end, slot);
    };
    const onToggle = () => setStored((current) => {
      const next = { ...current, hidden: !current.hidden };
      writeStored(next);
      return next;
    });
    const onHover = (event: Event) => {
      const slot = (event as CustomEvent<0 | 1 | "bench" | null>).detail;
      setOver(slot === 0 || slot === 1 ? slot : null);
      // A drag over the folded bench opens it.
      if (slot === "bench") setStored((current) => (current.open ? current : { ...current, open: true }));
    };
    window.addEventListener(SEND_EVENT, onSend);
    window.addEventListener(TOGGLE_EVENT, onToggle);
    window.addEventListener(HOVER_EVENT, onHover);
    return () => {
      window.removeEventListener(SEND_EVENT, onSend);
      window.removeEventListener(TOGGLE_EVENT, onToggle);
      window.removeEventListener(HOVER_EVENT, onHover);
    };
  }, [put]);

  // A picked slot: a press on a card starts a ghost drag. The view does not get the press (the card does not move).
  useEffect(() => {
    if (armed === null) return;
    let pressed: { itemId: string; x: number; y: number; moved: boolean } | null = null;
    // True from the release of a press on a card to the end of that event task (its mouseup and click).
    let justDropped = false;
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
      pressed = { itemId, x: event.clientX, y: event.clientY, moved: false };
    };
    const onMove = (event: PointerEvent) => {
      if (pressed === null) return;
      swallow(event);
      if (!pressed.moved && Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) < 4) return;
      pressed.moved = true;
      setGhost({ itemId: pressed.itemId, x: event.clientX, y: event.clientY });
      const slot = benchSlotAt(event.clientX, event.clientY);
      setOver(slot === 0 || slot === 1 ? slot : slot === "bench" ? armed : null);
    };
    const onUp = (event: PointerEvent) => {
      if (pressed === null) return;
      swallow(event);
      const { itemId, moved } = pressed;
      pressed = null;
      setGhost(null);
      setOver(null);
      if (!moved) return;
      const slot = benchSlotAt(event.clientX, event.clientY);
      if (slot === null) return;
      put({ itemId }, slot === "bench" ? armed : slot);
      setArmed(null);
    };
    // The mouse events and the click of a press on a card stay away from the view (no move, no select, no open).
    const onMouse = (event: MouseEvent) => {
      if (pressed !== null || (event.type !== "mousedown" && justDropped)) swallow(event);
    };
    const onUpMark = () => {
      if (pressed === null) return;
      justDropped = true;
      window.setTimeout(() => (justDropped = false), 0);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      swallow(event);
      pressed = null;
      setGhost(null);
      setOver(null);
      setArmed(null);
    };
    window.addEventListener("pointerup", onUpMark, true);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    for (const type of ["mousedown", "mousemove", "mouseup", "click", "dblclick", "dragstart"]) window.addEventListener(type, onMouse as EventListener, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerup", onUpMark, true);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      for (const type of ["mousedown", "mousemove", "mouseup", "click", "dblclick", "dragstart"]) window.removeEventListener(type, onMouse as EventListener, true);
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

  // Move: drag the bench by its head (or the folded button). A click (no move) on the folded button opens it.
  const onPointerDown = (event: ReactPointerEvent) => {
    if (event.button !== 0 || (event.target as Element).closest("button:not(.link-bench-pet), input, [data-bench-slot]") !== null) return;
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
    // The folded button: a press without a move opens the bench (the pointer capture takes the click).
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

  // Drops: a card or a list row (its item), or dragged selected text (the last selected passage, if it is that text).
  const endOfDrop = (event: DragEvent): PassageEnd | null => {
    const itemId = event.dataTransfer.getData(BENCH_ITEM_TYPE);
    if (itemId !== "" && session.store.has("items", itemId)) return { itemId };
    const text = event.dataTransfer.getData("text/plain").trim();
    const last = lastPassage();
    if (text !== "" && last !== null && last.quote.trim() === text) return last;
    return null;
  };
  const dropProps = (slot: 0 | 1) => ({
    onDragOver: (event: DragEvent) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "link";
      setOver(slot);
    },
    onDragLeave: () => setOver((current) => (current === slot ? null : current)),
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      setOver(null);
      const end = endOfDrop(event);
      if (end !== null) put(end, slot);
      else setMessage("Drop a card, or text that you selected in a note, a page, a web page, or a PDF.");
    },
  });

  const search = async (slot: 0 | 1) => {
    const found = await actions.searchLinkTarget();
    if (found !== null) put({ itemId: found.itemId, quote: found.quote }, slot);
  };

  const ready = slots[0] !== null && slots[1] !== null && !sameEnd(slots[0], slots[1]);
  // A small item and text of its own home (page, web page, PDF): the item points to the text (SPEC 1.1).
  const pointing = ready ? pointEnds(session.context, slots[0]!, slots[1]!) : null;
  const link = () => {
    if (!ready || readOnly) return;
    try {
      const command = pointEnds(session.context, slots[0]!, slots[1]!) ?? linkEnds(session.context, slots[0]!, slots[1]!).command;
      if (!runCommand(command)) return;
      setSlots((current) => [pinned[0] ? current[0] : null, pinned[1] ? current[1] : null]);
      setMessage(pointing !== null ? "The item points to the text now. ⌘Z undoes it." : "Linked. ⌘Z undoes it.");
    } catch (problem) {
      setMessage(String(problem).replace(/^Error: /, ""));
    }
  };

  const filled = slots.filter((end) => end !== null).length;

  if (!stored.open) {
    return (
      <div
        ref={panel}
        className="link-bench folded"
        style={{ left: stored.x, top: stored.y }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDragOver={(event) => {
          // Dragging something onto the folded bench opens it.
          event.preventDefault();
          update({ open: true });
        }}
      >
        <button
          className="link-bench-pet"
          data-tip="Link bench: link any two items or passages"
          // Keyboard (Enter, Space): opens the bench. A pointer press opens it in onPointerUp.
          onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && update({ open: true })}
        >
          <Link2 size={20} />
          <span className="link-bench-dots" aria-hidden="true">
            <span className={slots[0] !== null ? "full" : ""} />
            <span className={slots[1] !== null ? "full" : ""} />
          </span>
        </button>
      </div>
    );
  }

  const slotView = (slot: 0 | 1) => {
    const end = slots[slot];
    const item = end === null ? undefined : session.store.get("items", end.itemId);
    const web = item?.url !== undefined && item.url !== "";
    return (
      <div
        className={`link-bench-slot${end === null ? " empty" : ""}${over === slot ? " over" : ""}${armed === slot ? " armed" : ""}`}
        data-bench-slot={slot}
        data-tip={armed === slot ? undefined : slot === 0 ? "Click to pick a reference" : "Click to pick a target"}
        onClick={(event) => {
          if ((event.target as Element).closest("button") !== null) return;
          setArmed((current) => (current === slot ? null : slot));
        }}
        {...dropProps(slot)}
      >
        <div className="link-bench-slot-head">
          <span className="link-bench-slot-role">{slot === 0 ? "From" : "To"}</span>
          {end !== null && (
            <>
              <button
                className={`icon-button small${pinned[slot] ? " active" : ""}`}
                data-tip={pinned[slot] ? "Pinned: stays after Link" : "Pin: keep it after Link"}
                onClick={() => setPinned((current) => (slot === 0 ? [!current[0], current[1]] : [current[0], !current[1]]))}
              >
                <Pin size={12} />
              </button>
              <button className="icon-button small" data-tip="Empty this slot" onClick={() => setSlots((current) => (slot === 0 ? [null, current[1]] : [current[0], null]))}>
                <X size={12} />
              </button>
            </>
          )}
        </div>
        {end === null ? (
          <>
            <div className="link-bench-hint">{armed === slot ? "Drag an item here" : slot === 0 ? "Click to pick a reference" : "Click to pick a target"}</div>
            <div className="link-bench-fill">
              <button disabled={passage === null} data-tip={passage === null ? "Select text in a note, a page, a web page, or a PDF first" : `Selected text: “${shorten(passage.quote, 80)}”`} onClick={() => passage !== null && put(passage, slot)}>
                <TextSelect size={13} /> Selected text
              </button>
              <button data-tip="Find an item or a passage in all boards" onClick={() => void search(slot)}>
                <Search size={13} /> Search…
              </button>
            </div>
          </>
        ) : (
          <button className="link-bench-end" data-tip="Show it" onClick={() => actions.openAt(end.itemId, end.quote !== undefined ? { quote: end.quote } : {})}>
            <span className="link-bench-end-title">
              {web ? <Globe size={12} /> : <FileText size={12} />}
              <span translate="no" dir="auto">{titleOf(session.store, end.itemId)}</span>
            </span>
            {end.quote !== undefined && end.quote !== "" && (
              <span className="link-bench-end-quote" translate="no" dir="auto">
                “{shorten(end.quote, 140)}”
              </span>
            )}
            {(end.quote === undefined || end.quote === "") && <span className="link-bench-end-kind">Whole item</span>}
          </button>
        )}
      </div>
    );
  };

  return (
    <div ref={panel} className="link-bench open" style={{ left: stored.x, top: stored.y }} role="dialog" aria-label="Link bench">
      <div className="link-bench-head" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        <Link2 size={14} />
        <span className="link-bench-title">Link bench</span>
        <span className="link-bench-count muted">{`${filled} / 2`}</span>
        <button className="icon-button small" data-tip="Fold the bench" onClick={() => update({ open: false })}>
          <Minimize2 size={12} />
        </button>
        <button className="icon-button small" data-tip="Hide the bench (the link bench button in the top bar shows it)" onClick={() => update({ hidden: true })}>
          <X size={12} />
        </button>
      </div>
      <div className="link-bench-body">
        {slotView(0)}
        <div className="link-bench-middle">
          <ArrowRight size={16} className="muted" />
          <button className="primary link-bench-link" disabled={!ready || readOnly} data-tip={pointing !== null ? "The item points to the selected text of its page (⌘Z undoes it)" : ready ? "Link the two ends (⌘Z undoes it)" : "Fill both slots first"} onClick={link}>
            {pointing !== null ? "Point to text" : "Link"}
          </button>
          <button className="icon-button small" data-tip="Swap the two ends" disabled={filled === 0} onClick={() => setSlots((current) => [current[1], current[0]])}>
            <ArrowLeftRight size={13} />
          </button>
        </div>
        {slotView(1)}
      </div>
      {armed !== null && slots[armed] !== null && <div className="link-bench-message">Drag a card here to replace this end. Esc: stop.</div>}
      {message !== null && <div className="link-bench-message">{message}</div>}
      {ghost !== null && (
        <div className="link-bench-ghost" style={{ left: ghost.x + 12, top: ghost.y + 12 }} translate="no" dir="auto">
          <FileText size={12} /> {titleOf(session.store, ghost.itemId)}
        </div>
      )}
    </div>
  );
}

function shorten(text: string, length: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length)}…` : flat;
}

