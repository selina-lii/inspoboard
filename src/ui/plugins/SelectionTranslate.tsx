// "Translate" for selected text: a small button shows near the selection. A click sends only the selected text
// to the first plugin that transforms text. The result shows in a panel. It is never saved.
// The panel stays open (also after clicks and new selections) until the user clicks its X.
// Frames (a saved web page) report their selection with offerSelection().

import { Languages, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { transformTexts } from "../../io/plugins";
import { OptionField } from "./PluginMenu";
import { usePluginHost, usePlugins } from "./pluginsContext";
import "./plugins.css";

type Offer = { text: string; x: number; y: number; /** The item that holds the text, if any. */ itemId?: string };

const OFFER_EVENT = "inspoboard-selection";
const TRANSLATE_EVENT = "inspoboard-translate-selection";

/** The text that is selected now (in the app or in a frame), also while the panel is open. Null: no selection. */
let liveSelection: Offer | null = null;

/** The selected text, for the plugin menu ("Selected text" or "Current item"). */
export function selectedText(): string | null {
  return liveSelection?.text ?? null;
}

/** The item that holds the selected text (a note window, a card), or null. */
export function selectedTextItem(): string | null {
  return liveSelection?.itemId ?? null;
}

/** Translates the selected text and shows the result in the panel (the plugin menu calls this). */
export function translateSelection(): void {
  window.dispatchEvent(new Event(TRANSLATE_EVENT));
}

/** A frame reports a selection: its text and its end point in the coordinates of the app window. Empty text: none. */
export function offerSelection(text: string, x: number, y: number): void {
  window.dispatchEvent(new CustomEvent<Offer>(OFFER_EVENT, { detail: { text, x, y } }));
}

/** Text selections in these elements get the button. Not in text fields: those have their own menu. */
const READABLE = ".text-editor, .transformed-text, .document-view, .card-text, .card-preview, .pdf-pages";
const MAX_LENGTH = 5000;

export function SelectionTranslate() {
  const plugins = usePlugins();
  const hostValue = usePluginHost();
  const plugin = plugins.plugins.find((entry) => entry.details !== null && entry.capabilities.includes("transform-text"));
  const [offer, setOffer] = useState<Offer | null>(null);
  const [result, setResult] = useState<{ text: string | null; error: string | null } | null>(null);
  /** The panel position after the user moved it (drag its top bar). Null: under the selection. */
  const [moved, setMoved] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const run = useRef(0);
  const translateRef = useRef<(text: string) => void>(() => undefined);
  /** True while the result panel is open: then selections do not change it. */
  const panelOpen = useRef(false);
  panelOpen.current = result !== null;

  useEffect(() => {
    if (plugin === undefined) return;
    const read = () => {
      const selection = window.getSelection();
      if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return null;
      const range = selection.getRangeAt(0);
      const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
      if (start?.closest(READABLE) == null || start.closest("input, textarea") !== null) return null;
      const text = selection.toString().trim();
      if (text === "") return null;
      const rects = range.getClientRects();
      const last = rects[rects.length - 1] ?? range.getBoundingClientRect();
      const itemId = start.closest("[data-item-id]")?.getAttribute("data-item-id") ?? undefined;
      return { text: text.slice(0, MAX_LENGTH), x: last.right, y: last.bottom, itemId: itemId === "" ? undefined : itemId };
    };
    const onPointerUp = (event: Event) => {
      const target = event.target as Element | null;
      // Clicks in the panel or in the plugin menu do not change the selection that they work on.
      if (frame.current?.contains(target) === true || (target instanceof Element && target.closest(".plugin-menu") !== null)) return;
      // After the click: the selection is final then.
      window.setTimeout(() => {
        const next = read();
        liveSelection = next;
        if (panelOpen.current) return;
        setOffer(next);
        if (next === null) setResult(null);
      }, 0);
    };
    const onOffer = (event: Event) => {
      const detail = (event as CustomEvent<Offer>).detail;
      const next = detail.text.trim() === "" ? null : { ...detail, text: detail.text.trim().slice(0, MAX_LENGTH) };
      liveSelection = next;
      if (panelOpen.current) return;
      setOffer(next);
      if (next === null) setResult(null);
    };
    const onTranslate = () => {
      if (liveSelection === null) return;
      setOffer(liveSelection);
      setMoved(null);
      translateRef.current(liveSelection.text);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      // Escape hides the button. The panel closes only with its X.
      if (event.key === "Escape" && !panelOpen.current) {
        setOffer(null);
        setResult(null);
      }
    };
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("keyup", onPointerUp);
    window.addEventListener(OFFER_EVENT, onOffer);
    window.addEventListener(TRANSLATE_EVENT, onTranslate);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      liveSelection = null;
      window.removeEventListener(TRANSLATE_EVENT, onTranslate);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("keyup", onPointerUp);
      window.removeEventListener(OFFER_EVENT, onOffer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [plugin]);

  const translate = async (text: string, values: Record<string, string>) => {
    if (plugin === undefined || hostValue === null) return;
    const number = ++run.current;
    setResult({ text: null, error: null });
    try {
      // The plugins host of the app: "Do not translate" applies here too.
      const [translated] = await transformTexts(plugins.transformHost ?? hostValue.host, plugin.name, [text], values);
      if (number === run.current) setResult({ text: translated ?? "", error: null });
    } catch (problem) {
      if (number === run.current) setResult({ text: null, error: String(problem) });
    }
  };
  translateRef.current = (text) => void translate(text, plugin === undefined ? {} : plugins.optionsOf(plugin.name));

  if (plugin === undefined || offer === null || hostValue === null) return null;
  const details = plugin.details!;
  const options = plugins.optionsOf(plugin.name);

  const left = moved?.x ?? Math.max(8, Math.min(offer.x, window.innerWidth - 340));
  const top = moved?.y ?? Math.min(offer.y + 6, window.innerHeight - 60);
  const close = () => {
    setOffer(null);
    setResult(null);
    setMoved(null);
  };
  return (
    <div ref={frame} className="selection-translate" style={{ left, top }} onPointerDown={(event) => event.preventDefault()}>
      {result === null ? (
        <button className="selection-translate-button" onClick={() => void translate(offer.text, options)}>
          <Languages size={13} />
          {details.title === "Translate" ? "Translate" : details.title}
        </button>
      ) : (
        <div className="selection-translate-panel" onPointerDown={(event) => event.stopPropagation()}>
          <div
            className="selection-translate-head"
            onPointerDown={(event) => {
              if ((event.target as HTMLElement).closest("input, select, button") !== null) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = { dx: event.clientX - left, dy: event.clientY - top };
            }}
            onPointerMove={(event) => {
              if (drag.current === null) return;
              const x = Math.max(0, Math.min(window.innerWidth - 80, event.clientX - drag.current.dx));
              const y = Math.max(0, Math.min(window.innerHeight - 40, event.clientY - drag.current.dy));
              setMoved({ x, y });
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
          >
            <div className="plugin-options compact">
              {details.options.map((option) => (
                <OptionField
                  key={option.key}
                  option={option}
                  value={options[option.key] ?? option.default}
                  onChange={(value) => {
                    plugins.setOption(plugin.name, option.key, value);
                    void translate(offer.text, { ...options, [option.key]: value });
                  }}
                />
              ))}
            </div>
            <button
              className="icon-button small"
              data-tip="Close the translation"
              data-tip-end
              onClick={close}
            >
              <X size={14} />
            </button>
          </div>
          {result.error !== null ? (
            <div className="plugin-error">{result.error}</div>
          ) : result.text === null ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <div className="selection-translate-text" dir="auto">
              {result.text}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
