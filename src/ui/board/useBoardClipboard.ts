// Copy and paste on the board (⌘C / ⌘V, or Ctrl): small items and pages (core/clipboard.ts). A paste goes under the
// pointer, or next to the copied cards. A pasted link of a media source becomes a media item (SPEC 7.14).

import type { Edge, ReactFlowInstance } from "@xyflow/react";
import type { Command } from "../../core/commands";
import type { Session } from "../../io/session";
import type { Settings } from "../../io/settings";
import { createMediaItem, mediaKindOf } from "../../core/media";
import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from "react";
import type { Id } from "../../core/types";
import { isTextTarget } from "../app/dom";
import { isComposing, shortcutKey } from "../app/keys";
import type { FlowNode } from "./nodes";
import { copyCards, pasteCards, type CopiedCard } from "../../core/clipboard";
import { copyWebFiles } from "../web/webHomes";


type ClipboardEnv = {
  wrapper: RefObject<HTMLDivElement | null>;
  flow: ReactFlowInstance<FlowNode, Edge>;
  session: Session;
  boardId: Id;
  readOnly: boolean;
  runCommand(command: Command): boolean;
  pendingSelection: MutableRefObject<Set<string> | null>;
  mediaSources: Settings["mediaSources"];
};

/** The copied cards (⌘C), for ⌘V on any board. In memory only, while the app is open. */
let copiedCards: { cards: CopiedCard[]; pastes: number } | null = null;

/** Copy and paste of cards on this board. Returns the short notice after a copy (or null). */
export function useBoardClipboard({ wrapper, flow, session, boardId, readOnly, runCommand, pendingSelection, mediaSources: sources }: ClipboardEnv): string | null {
  const mediaSources = useRef(sources);
  mediaSources.current = sources;
  // Copy and paste (⌘C / ⌘V, or Ctrl): small items and pages (core/clipboard.ts). A paste goes under the pointer,
  // or next to the copied cards. The keys and the copy/paste events (Edit menu) both work: one runs, not both.
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  useEffect(() => {
    const element = wrapper.current;
    if (element === null) return;
    const move = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
    };
    const leave = () => {
      pointer.current = null;
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerleave", leave);
    return () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerleave", leave);
    };
  }, []);
  useEffect(() => {
    if (copyNotice === null) return;
    const timer = window.setTimeout(() => setCopyNotice(null), 2500);
    return () => window.clearTimeout(timer);
  }, [copyNotice]);
  useEffect(() => {
    /** Text is selected or typed: copy and paste are for the text. */
    const forText = (target: EventTarget | null) => isTextTarget(target) || (window.getSelection()?.isCollapsed === false);
    let lastRun = 0;
    const copy = (): string | null => {
      const placeIds = flow.getNodes().filter((node) => node.selected).flatMap((node) => (node.data.node.placeId === null ? [] : [node.data.node.placeId]));
      if (placeIds.length === 0) return null;
      const cards = copyCards(session, placeIds);
      if (cards.length === 0) {
        setCopyNotice("Only small items and pages can be copied for now.");
        return null;
      }
      const text = cards.map((card) => [card.item.name, card.body].filter((part) => part.trim() !== "").join("\n")).join("\n\n");
      copiedCards = { cards, pastes: 0 };
      setCopyNotice(cards.length < placeIds.length ? `Copied ${cards.length} of ${placeIds.length}: only small items and pages can be copied for now.` : cards.length > 1 ? `Copied ${cards.length} items` : "Copied 1 item");
      return text;
    };
    const paste = (): boolean => {
      const clip = copiedCards;
      if (clip === null || readOnly) return false;
      clip.pastes += 1;
      const left = Math.min(...clip.cards.map((card) => card.place.x));
      const top = Math.min(...clip.cards.map((card) => card.place.y));
      const at = pointer.current !== null ? flow.screenToFlowPosition(pointer.current) : { x: left + 24 * clip.pastes, y: top + 24 * clip.pastes };
      const { command, placeIds, webCopies } = pasteCards(session.context, clip.cards, boardId, at);
      pendingSelection.current = new Set(placeIds);
      if (!runCommand(command)) return true;
      // A link object is a full copy (SPEC 1.1): its saved page or PDF and its notes are copied too.
      for (const copy of webCopies) void copyWebFiles(session, copy.from, copy.to).catch((problem: unknown) => console.error(problem));
      return true;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || forText(event.target) || isComposing(event)) return;
      const key = shortcutKey(event);
      if (key === "c") {
        const text = copy();
        if (text === null) return;
        lastRun = Date.now();
        event.preventDefault();
        navigator.clipboard?.writeText(text).catch(() => undefined);
      } else if (key === "v" && paste()) {
        lastRun = Date.now();
        event.preventDefault();
      }
    };
    const onCopy = (event: ClipboardEvent) => {
      if (Date.now() - lastRun < 300 || forText(event.target)) return;
      const text = copy();
      if (text === null) return;
      event.preventDefault();
      event.clipboardData?.setData("text/plain", text);
    };
    /** A link of a media source (Settings › Media sources): a new media item at the pointer (SPEC 7.14). */
    const pasteMedia = (text: string): boolean => {
      const url = text.trim();
      if (readOnly || url === "" || /\s/.test(url)) return false;
      const kind = mediaKindOf(url, mediaSources.current);
      if (kind === null) return false;
      const at = flow.screenToFlowPosition(pointer.current ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 });
      const { command, placeId } = createMediaItem(session.context, { boardId, x: Math.round(at.x), y: Math.round(at.y), kind, url });
      pendingSelection.current = new Set([placeId]);
      runCommand(command);
      return true;
    };
    const onPaste = (event: ClipboardEvent) => {
      if (Date.now() - lastRun < 300 || forText(event.target)) return;
      if (paste() || pasteMedia(event.clipboardData?.getData("text/plain") ?? "")) event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
    };
  }, [flow, session, boardId, readOnly, runCommand]);

  return copyNotice;
}
