// Buzzies mode (built-in plugin, SPEC 7.13): the user's text on the screen is hidden, and icons, pictures, and
// scribbles blur. The screen shows the structure of the vault, not its words (for screenshots and for work in public).
// - Two styles: "glyphs" (each text becomes symbols and blocks, buzz.ts) and "blur" (the text blurs evenly).
// - The app works as usual: clicks, drags, keys, and the editor. The mode never changes the store, the files, or
//   the history. In the glyph style, the screen has glyphs in place of text, so a selection or a copy of screen text
//   (not of an editor or a field) is blocked: glyphs never go into an item. Esc (not in a text field), the chip, or
//   the entry again ends it.
// - Only the user's text is hidden: UI text of the app ("3D", tool names) stays readable.
// - Glyphs: each text node gets its buzzed text. New text (a new label, a hover) is buzzed at once. At the end,
//   each node gets its text back. Blur: the element of each text node gets `data-buzz-blur` (CSS blurs it).
// - The text of a page editor is not changed in the DOM (the editor would read it as typing): the editor shows
//   each word as a buzzed widget (editor.ts), or blurs. Its other widgets (pictures, link cards) are DOM.
// - Saved web pages (frames of the same origin) are hidden too.
// - Animation (glyphs): each text scatters in (random start, a few random glyphs, then its buzzed glyphs), about 0.5 s.

import { buzzText, hashOf, noiseGlyph } from "./buzz";
import { isUiText, t } from "../../i18n/i18n";
import { isUserText } from "../../i18n/domTranslate";
import "./buzzies.css";

export type BuzzPhase = "off" | "on" | "leaving";
export type BuzzStyle = "glyphs" | "blur";
export const BUZZ_STYLES: readonly BuzzStyle[] = ["glyphs", "blur"];

/** Timing (ms): the random start, the delay of each next character, the time to settle, one glyph step. */
const SPREAD = 250;
const PER_CHAR = 4;
const SETTLE = 140;
const STEP = 70;
const TICK = 33;

let phase: BuzzPhase = "off";
let style: BuzzStyle = "glyphs";
const listeners = new Set<() => void>();

export function buzzPhase(): BuzzPhase {
  return phase;
}

/** The style of the mode now (the last one, while it is off). */
export function buzzStyle(): BuzzStyle {
  return style;
}

export function onBuzzPhase(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function setPhase(next: BuzzPhase): void {
  phase = next;
  document.documentElement.classList.toggle("buzzies", next !== "off");
  document.documentElement.classList.toggle("buzz-blur", next !== "off" && style === "blur");
  for (const listener of listeners) listener();
}

/** Starts the mode (in a style) or ends it. */
export function toggleBuzzies(next: BuzzStyle = style): void {
  if (phase === "off") startBuzzies(next);
  else if (phase === "on") stopBuzzies();
}

// ---- The text nodes ----

type Entry = { original: string; shown: string };
const entries = new Map<Text, Entry>();
/** Blur style: the elements with `data-buzz-blur`. */
const blurred = new Set<Element>();

/** True if buzzies mode may change this text node in the DOM. */
function canBuzz(node: Text): boolean {
  if (node.data.trim() === "") return false;
  const parent = node.parentElement;
  if (parent === null || parent.closest("script, style, noscript, textarea, [data-buzz-skip], .buzz-word") !== null) return false;
  // UI text of the app ("3D", "Settings", a tool name) stays readable: only the user's text is buzzed. A text
  // that is not a UI text of the language packs is buzzed (names, texts, dates: nothing of the vault shows).
  // A saved web page (a frame) is all user text.
  if (node.ownerDocument === document && !isUserText(parent) && isUiText(node.data)) return false;
  // In an editor: only text in its widgets (the editor does not read changes there).
  const editor = parent.closest(".cm-content");
  if (editor === null) return true;
  const widget = parent.closest('[contenteditable="false"]');
  return widget !== null && widget !== editor && editor.contains(widget);
}

function write(node: Text, entry: Entry, text: string): void {
  entry.shown = text;
  if (node.data !== text) node.data = text;
}

/** Buzzes a text node: with the animation, or at once. */
function buzzNode(node: Text, animated: boolean): void {
  if (!canBuzz(node)) return;
  if (style === "blur") {
    if (!node.parentElement!.hasAttribute("data-buzz-blur")) {
      node.parentElement!.setAttribute("data-buzz-blur", "");
      blurred.add(node.parentElement!);
    }
    return;
  }
  const known = entries.get(node);
  const original = known !== undefined && node.data === known.shown ? known.original : node.data;
  const entry: Entry = { original, shown: node.data };
  entries.set(node, entry);
  if (animated) animate(node, entry, buzzText(original));
  else {
    runs.delete(node);
    write(node, entry, buzzText(original));
  }
}

function buzzTree(root: Node, animated: boolean): void {
  if (root.nodeType === Node.TEXT_NODE) {
    buzzNode(root as Text, animated);
    return;
  }
  const walker = (root.ownerDocument ?? document).createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) nodes.push(node as Text);
  for (const node of nodes) buzzNode(node, animated);
}

/** A text node of an editor widget (editor.ts): it shows `original` buzzed. Its widget made it with the buzzed text. */
export function registerBuzzNode(node: Text, original: string): void {
  const entry: Entry = { original, shown: node.data };
  entries.set(node, entry);
  // The widget is new while the mode starts: it animates in too.
  if (phase === "on" && performance.now() < enteringUntil) {
    write(node, entry, original);
    animate(node, entry, buzzText(original));
  }
}

export function unregisterBuzzNode(node: Text): void {
  entries.delete(node);
  runs.delete(node);
}

// ---- The animation ----

type Run = { node: Text; entry: Entry; from: string[]; to: string[]; start: number; salt: number };
let runs = new Map<Text, Run>();
let timer = 0;
let whenDone: (() => void) | null = null;
/** New editor widgets animate in until this time. */
let enteringUntil = 0;
let motionQuery: MediaQueryList | null | undefined;
const reducedMotion = () => (motionQuery ??= window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null)?.matches === true;

function animate(node: Text, entry: Entry, target: string): void {
  if (reducedMotion()) {
    write(node, entry, target);
    return;
  }
  const from = [...node.data];
  const to = [...target];
  runs.set(node, { node, entry, from, to, start: performance.now() + Math.random() * SPREAD, salt: hashOf(entry.original) });
  if (timer === 0) timer = window.setInterval(tick, TICK);
}

function tick(): void {
  const now = performance.now();
  const next = new Map<Text, Run>();
  for (const run of runs.values()) {
    let busy = false;
    const out = run.to.map((ch, at) => {
      const local = now - run.start - at * PER_CHAR;
      if (local >= SETTLE) return ch;
      busy = true;
      if (local < 0) return run.from[at] ?? ch;
      return noiseGlyph(ch, hashOf(String(at), run.salt + Math.floor(local / STEP)));
    });
    if (run.node.isConnected || entries.has(run.node)) write(run.node, run.entry, out.join(""));
    if (busy) next.set(run.node, run);
  }
  runs = next;
  if (runs.size > 0) return;
  window.clearInterval(timer);
  timer = 0;
  const done = whenDone;
  whenDone = null;
  done?.();
}

// ---- Documents (the app, and frames of saved web pages) ----

const observers: MutationObserver[] = [];
const frameDocuments = new Set<Document>();
const frameCleanups: (() => void)[] = [];

function observe(doc: Document): void {
  if (doc.body === null) return;
  const observer = new MutationObserver((records) => {
    if (phase !== "on") return;
    for (const record of records) {
      if (record.type === "characterData") {
        const node = record.target as Text;
        if (style === "blur") {
          buzzNode(node, false);
          continue;
        }
        const entry = entries.get(node);
        if (entry !== undefined && node.data === entry.shown) continue;
        // New text from the app: buzz it at once (it never shows in clear).
        if (entry !== undefined) entry.original = node.data;
        buzzNode(node, false);
      } else {
        for (const added of record.addedNodes) {
          buzzTree(added, false);
          if (added instanceof Element) for (const frame of added.matches("iframe") ? [added] : added.querySelectorAll("iframe")) attachFrame(frame as HTMLIFrameElement);
        }
      }
    }
  });
  observer.observe(doc.body, { childList: true, subtree: true, characterData: true });
  observers.push(observer);
}

const FRAME_STYLE = `
img, svg, canvas, video, picture { filter: blur(10px) !important; }
input, textarea, select { filter: blur(4px) !important; }
[data-buzz-blur] { filter: blur(6px) !important; }
`;

function attachFrame(frame: HTMLIFrameElement): void {
  const attach = () => {
    if (phase !== "on") return;
    let doc: Document | null = null;
    try {
      doc = frame.contentDocument;
    } catch {
      doc = null;
    }
    if (doc === null || doc.body === null || frameDocuments.has(doc)) return;
    frameDocuments.add(doc);
    const style = doc.createElement("style");
    style.dataset.buzzStyle = "";
    style.textContent = FRAME_STYLE;
    doc.head?.append(style);
    buzzTree(doc.body, true);
    observe(doc);
    if (frame.contentWindow !== null) block(frame.contentWindow);
  };
  frame.addEventListener("load", attach);
  frameCleanups.push(() => frame.removeEventListener("load", attach));
  attach();
}

// ---- Input while the mode is on ----

/** Glyph style: these work on the text of the screen (glyphs), so they are blocked outside editors and fields. */
const SCREEN_TEXT = ["selectstart", "copy", "cut", "dragstart"];

/** True if the target is a text field or an editor: its text is real (not the glyphs of the screen). */
function inRealText(target: Element | null): boolean {
  return target?.closest("input, textarea, select, .cm-editor") != null;
}

function blocker(event: Event): void {
  const target = event.target instanceof Element ? event.target : event.target instanceof Node ? event.target.parentElement : null;
  if (event instanceof KeyboardEvent) {
    // Esc ends the mode (in a text field, Esc stays the field's).
    if (event.key === "Escape" && !inRealText(target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      stopBuzzies();
    }
    return;
  }
  if (style !== "glyphs" || inRealText(target) || target?.closest("[data-buzz-chip]") != null) return;
  // A drag of a card is not a text drag: only a drag of selected screen text is blocked.
  if (event.type === "dragstart" && !(window.getSelection()?.toString() ?? "")) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

const BLOCKED = ["keydown", ...SCREEN_TEXT];
const blockedWindows = new Set<Window>();

function block(target: Window): void {
  if (blockedWindows.has(target)) return;
  blockedWindows.add(target);
  for (const type of BLOCKED) target.addEventListener(type, blocker, true);
}

function unblockAll(): void {
  for (const target of blockedWindows) for (const type of BLOCKED) target.removeEventListener(type, blocker, true);
  blockedWindows.clear();
}

// ---- The chip: the only control while the mode is on ----

let chip: HTMLDivElement | null = null;

function showChip(): void {
  chip = document.createElement("div");
  chip.className = "buzz-chip";
  chip.dataset.buzzChip = "";
  chip.dataset.buzzSkip = "";
  const label = document.createElement("span");
  label.textContent = t("Buzzies mode");
  // The other style, at once (for this time; Settings › Plugins sets the style to start with).
  const other = document.createElement("button");
  other.textContent = style === "glyphs" ? t("Blur") : t("Glyphs");
  other.addEventListener("click", () => {
    const next: BuzzStyle = style === "glyphs" ? "blur" : "glyphs";
    endNow();
    startBuzzies(next, false);
  });
  const button = document.createElement("button");
  button.textContent = t("Show the text (Esc)");
  button.addEventListener("click", () => stopBuzzies());
  chip.append(label, other, button);
  document.body.append(chip);
}

// ---- Start and end ----

function startBuzzies(next: BuzzStyle, animated = true): void {
  if (phase !== "off") return;
  style = next;
  setPhase("on");
  enteringUntil = animated ? performance.now() + SPREAD + 200 : 0;
  if (style === "glyphs") window.getSelection()?.removeAllRanges();
  block(window);
  showChip();
  buzzTree(document.body, animated);
  observe(document);
  for (const frame of document.querySelectorAll("iframe")) attachFrame(frame);
}

/** Ends the mode at once (no animation). */
function endNow(): void {
  for (const observer of observers.splice(0)) observer.disconnect();
  for (const cleanup of frameCleanups.splice(0)) cleanup();
  runs.clear();
  finish();
}

function finish(): void {
  for (const [node, entry] of entries) write(node, entry, entry.original);
  entries.clear();
  for (const element of blurred) element.removeAttribute("data-buzz-blur");
  blurred.clear();
  for (const doc of frameDocuments) doc.querySelectorAll("style[data-buzz-style]").forEach((element) => element.remove());
  frameDocuments.clear();
  unblockAll();
  chip?.remove();
  chip = null;
  setPhase("off");
}

function stopBuzzies(): void {
  if (phase !== "on") return;
  setPhase("leaving");
  for (const observer of observers.splice(0)) observer.disconnect();
  for (const cleanup of frameCleanups.splice(0)) cleanup();
  for (const [node, entry] of entries) {
    if (node.isConnected) animate(node, entry, entry.original);
    else entries.delete(node);
  }
  if (runs.size === 0) finish();
  else whenDone = finish;
}
