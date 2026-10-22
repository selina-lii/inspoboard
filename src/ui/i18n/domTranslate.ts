// Shows the UI in the UI language: it replaces the English text of the UI on the screen.
// - It changes only the screen (text nodes and the attributes in ATTRIBUTES). React state and the vault do not change,
//   and nothing reads this text back.
// - User text is never changed: text in SKIP (cards, page titles, comments, web pages, PDFs, editors, inputs)
//   and in an element with translate="no" stays as it is.
// - When React writes a new English text, the observer replaces it again. The source text of each node is kept,
//   so a change back to English shows the source text.

import { setUiLanguage, translate, uiLanguage, type UiLanguage } from "./i18n";

/** Attributes that hold UI text. Tooltips use data-tip. */
const ATTRIBUTES = ["data-tip", "title", "placeholder", "aria-label"] as const;

/** Elements that hold user text. Their text is never translated. */
const SKIP = [
  '[translate="no"]',
  "input",
  "textarea",
  "script",
  "style",
  '[contenteditable="true"]',
  ".cm-editor",
  ".card-text",
  ".card-preview",
  // A name of the user. An empty name shows a UI word ("Untitled", "Calendar"): class "untitled".
  ".card-name:not(.untitled)",
  ".card-subtitle",
  ".compare-name",
  ".compare-cell",
  ".quote-source",
  ".group-name:not(.untitled)",
  ".center-edge-label",
  ".text-page-title",
  ".editor-window-title",
  ".split-title",
  ".reader-title",
  ".reader-page",
  ".reader-item-text",
  ".pdf-pages",
  ".page-note-text",
  ".comment-text",
  ".transformed-text",
  ".selection-translate-text",
  ".speech-subtitle",
  ".aligned-text",
  ".aligned-result",
  ".galaxy-labels",
  ".breadcrumb",
].join(",");

/**
 * UI text inside user text: the editor placeholder ("Write here…"), a placeholder word for an empty name or text
 * (class "untitled": "Untitled", "Empty text"), and the day count of a calendar in the galaxy.
 */
const ALLOW = ".cm-placeholder, .untitled, .galaxy-count";

type Shown = { source: string; shown: string };

export class DomTranslator {
  private texts = new WeakMap<Text, Shown>();
  private attributes = new WeakMap<Element, Map<string, Shown>>();
  private observer: MutationObserver;

  constructor(private root: Element) {
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") this.text(mutation.target as Text);
        else if (mutation.type === "attributes") this.attribute(mutation.target as Element, mutation.attributeName!);
        else for (const node of mutation.addedNodes) this.walk(node);
      }
    });
  }

  /** Translates all text under the root now, and each change later. */
  start(): void {
    this.walk(this.root);
    this.observer.observe(this.root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRIBUTES] });
  }

  /** After a change of the UI language: shows all text again in the new language. */
  refresh(): void {
    this.walk(this.root);
  }

  stop(): void {
    this.observer.disconnect();
  }

  private walk(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      this.text(node as Text);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    if (skipped(element)) {
      // The attributes of a user-text element are UI text too (tooltips). Its text is not.
      for (const name of ATTRIBUTES) if (element.hasAttribute(name)) this.attribute(element, name);
      for (const allowed of element.querySelectorAll(ALLOW)) this.walk(allowed);
      return;
    }
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (child) => (child.nodeType === Node.ELEMENT_NODE && child !== element && skipped(child as Element) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let child: Node | null = walker.currentNode; child !== null; child = walker.nextNode()) {
      if (child.nodeType === Node.TEXT_NODE) this.text(child as Text);
      else for (const name of ATTRIBUTES) if ((child as Element).hasAttribute(name)) this.attribute(child as Element, name);
    }
  }

  private text(node: Text): void {
    const parent = node.parentElement;
    if (parent === null || skipped(parent)) return;
    const current = node.nodeValue ?? "";
    const known = this.texts.get(node);
    // Our own text: keep its source. Else React wrote a new text: it is the new source.
    const source = known !== undefined && current === known.shown ? known.source : current;
    const shown = translate(source);
    this.texts.set(node, { source, shown });
    if (shown !== current) node.nodeValue = shown;
  }

  private attribute(element: Element, name: string): void {
    const current = element.getAttribute(name);
    if (current === null) return;
    // A title on user text can be user text (a full name): only tooltips and labels of the UI change there.
    if (name === "title" && skipped(element)) return;
    let map = this.attributes.get(element);
    if (map === undefined) {
      map = new Map();
      this.attributes.set(element, map);
    }
    const known = map.get(name);
    const source = known !== undefined && current === known.shown ? known.source : current;
    const shown = translate(source);
    map.set(name, { source, shown });
    if (shown !== current) element.setAttribute(name, shown);
  }
}

/** True if the element holds user text (not UI text): the translator never changes it, and buzzies mode buzzes it. */
export function isUserText(element: Element): boolean {
  return skipped(element);
}

function skipped(element: Element): boolean {
  return element.closest(SKIP) !== null && element.closest(ALLOW) === null;
}

let translator: DomTranslator | null = null;

/** Sets the UI language and shows the UI in it. English stops the translator (the source text shows again). */
export function applyUiLanguage(language: UiLanguage): void {
  if (language === uiLanguage()) return;
  setUiLanguage(language);
  if (translator === null) {
    translator = new DomTranslator(document.body);
    translator.start();
  } else translator.refresh();
}
