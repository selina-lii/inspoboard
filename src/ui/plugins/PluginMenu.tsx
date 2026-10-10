// Tool bar buttons for plugins that transform text (for example a translator) or read text aloud. See docs/PLUGINS.md.
// The core knows nothing about what a plugin does. It shows the plugin options and sends item texts.

import { AudioLines, Globe, Languages, LoaderCircle, Puzzle, Sparkles, Wand2, X } from "lucide-react";
import { MovablePanel } from "../app/movable";
import { useEffect, useRef, useState, type ComponentType } from "react";
import type { Id } from "../../core/types";
import { useSession, useSessionState } from "../app/sessionContext";
import { isValidOption, type PluginOption } from "../../io/plugins";
import { NO_SKIP, type SpeechMarkdown, type SpeechSkip } from "../../io/settings";
import { usePlugins, type Plugin } from "./pluginsContext";
import { readableText, useSpeech } from "./speech";
import { formatListenTime, listenSeconds } from "./listenTime";
import { selectionOf } from "../editor/selections";
import { useWebPages } from "../web/WebPages";
import { useWorkspaceActions } from "../app/workspaceActions";
import { fileNameOf, multilingualMarkdown, translationsMarkdown } from "./exportOverlay";
import type { OverlayMap } from "./overlay";
import { selectedText, selectedTextItem, translateSelection } from "./SelectionTranslate";
import "./plugins.css";

/** `options`: the option values of the plugin. An icon can show the current option (see HanIcon). */
export type PluginIconType = ComponentType<{ size?: number; options?: Readonly<Record<string, string>> }>;

/**
 * The Chinese script icon: one character for the current target option. Target Simplified ("hans") shows 繁;
 * a Traditional target ("hant", "tw", "hk") shows 簡.
 */
function HanIcon({ size = 16, options }: { size?: number; options?: Readonly<Record<string, string>> }) {
  return (
    <span className="han-icon" style={{ fontSize: Math.round(size * 0.9), height: size }} aria-hidden>
      {options?.target === "hans" ? "繁" : "簡"}
    </span>
  );
}

/** Icons that a plugin can name in its "info" reply. */
export const PLUGIN_ICONS: Record<string, PluginIconType> = { languages: Languages, sparkles: Sparkles, wand: Wand2, speech: AudioLines, globe: Globe, han: HanIcon };

/** The capabilities that get a tool bar button. */
const MENU_CAPABILITIES = ["transform-text", "convert-text", "speak-text"];

export function pluginIcon(name: string | undefined): PluginIconType {
  return (name === undefined ? undefined : PLUGIN_ICONS[name]) ?? Puzzle;
}

type Props = {
  /** Items that the user selected, or the item of the open page. */
  selectedIds: readonly Id[];
  /** All items of the current board, in outline order. */
  boardItemIds(): Id[];
  /** What the user looks at: "page" or "board", and its name. For "Save multilingual version of this …". */
  scope: { kind: "page" | "board"; name: string };
};

export function PluginMenu({ selectedIds, boardItemIds, scope }: Props) {
  const { plugins } = usePlugins();
  const transformers = plugins.filter((plugin) => plugin.details !== null && plugin.capabilities.some((capability) => MENU_CAPABILITIES.includes(capability)));
  return (
    <>
      {transformers.map((plugin) => (
        <PluginButton key={plugin.name} plugin={plugin} selectedIds={selectedIds} boardItemIds={boardItemIds} scope={scope} />
      ))}
    </>
  );
}

function PluginButton({ plugin, selectedIds: boardSelection, boardItemIds, scope }: Props & { plugin: Plugin }) {
  const plugins = usePlugins();
  const speech = useSpeech();
  const { settings, readOnly: readOnlyVault } = useSessionState();
  const session = useSession();
  const web = useWebPages();
  const actions = useWorkspaceActions();
  const [open, setOpen] = useState(false);
  const transforms = plugin.capabilities.includes("transform-text");
  // "convert-text": the result replaces the text in the vault (undo gives it back). No view overlay.
  const converts = plugin.capabilities.includes("convert-text") && !transforms;
  const speaks = plugin.capabilities.includes("speak-text") && speech !== null;
  // No item selected on the board, but text selected in a note window or a card: that item is the current item.
  const textItem = open ? selectedTextItem() : null;
  const selectedIds = boardSelection.length === 0 && textItem !== null ? [textItem] : boardSelection;
  const readTarget = selectedIds.length === 1 ? selectedIds[0]! : null;
  const frame = useRef<HTMLSpanElement>(null);
  const details = plugin.details!;
  const Icon = pluginIcon(details.icon);
  const job = plugins.job?.plugin === plugin.name ? plugins.job : null;
  const options = plugins.optionsOf(plugin.name);
  const mine = [...plugins.overlay.values()].filter((overlay) => overlay.plugin === plugin.name);
  const shown = mine.filter((overlay) => overlay.shown).length;
  const hidden = mine.length - shown;
  const [saved, setSaved] = useState<string | null>(null);
  const save = async (name: string, content: string) => {
    try {
      const path = await session.exportText(name, content);
      if (path !== null) setSaved(path);
    } catch (problem) {
      plugins.setError(String(problem));
    }
  };
  const percent = job === null || job.total === 0 ? null : Math.round((100 * job.done) / job.total);

  // A click outside closes the menu.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (frame.current !== null && !frame.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span className="plugin-menu" ref={frame}>
      <button className={`icon-button${open ? " active" : ""}`} data-tip={details.title} onClick={() => setOpen((current) => !current)}>
        {job !== null ? <LoaderCircle size={16} className="spin" /> : <Icon size={16} options={options} />}
        {percent !== null && <span className="plugin-percent">{percent}%</span>}
      </button>
      {open && (
        <MovablePanel className="plugin-popover" titleClassName="plugin-popover-title" label={details.title} title={details.title}>
          {details.options.length > 0 && (
            <div className="plugin-options">
              {details.options.map((option) => (
                <OptionField key={option.key} option={option} value={options[option.key] ?? option.default} onChange={(value) => plugins.setOption(plugin.name, option.key, value)} />
              ))}
            </div>
          )}
          {speaks && job === null && (
            <>
              {/* The sentence that is read always has a highlight (it is the reading cursor). The subtitle is an addition. */}
              <label className="plugin-check">
                <input type="checkbox" checked={settings.speechMode === "subtitle"} onChange={(event) => speech.setMode(event.target.checked ? "subtitle" : "highlight")} />
                <span>Subtitle (in addition to the highlight)</span>
              </label>
              {settings.speechMode === "subtitle" && (
                <label className="plugin-check plugin-indent">
                  <input type="checkbox" checked={settings.subtitleFloating} onChange={(event) => void session.updateSettings({ subtitleFloating: event.target.checked })} />
                  <span>Float above all apps</span>
                </label>
              )}
              {settings.speechMode === "subtitle" && (
                <label className="plugin-check plugin-indent">
                  <input type="checkbox" checked={settings.subtitleBoth} onChange={(event) => void session.updateSettings({ subtitleBoth: event.target.checked })} />
                  <span>Show the translation too (if there is one)</span>
                </label>
              )}
              <label className="plugin-check plugin-select-row">
                <span>Voice-out mode</span>
                <select value={settings.speechMarkdown} onChange={(event) => void session.updateSettings({ speechMarkdown: event.target.value as SpeechMarkdown })}>
                  <option value="auto">Auto-detect</option>
                  <option value="markdown">Markdown</option>
                  <option value="paper">Paper (no references)</option>
                </select>
              </label>
              <label className="plugin-check plugin-select-row" data-tip="The voice makes audio while it reads. More audio ahead: fewer pauses, but more work and memory.">
                <span>Audio ahead</span>
                <select value={settings.speechAhead} onChange={(event) => void session.updateSettings({ speechAhead: event.target.value as "window" | "end" | "all" })}>
                  <option value="window">About 1 minute</option>
                  <option value="end">To the end, while it plays</option>
                  <option value="all">All audio first, then play</option>
                </select>
              </label>
              <SkipOptions />
              <div className="plugin-buttons">
                <button
                  className="primary"
                  disabled={readTarget === null && web?.page == null}
                  data-tip={readTarget === null && web?.page == null ? "Select one note or page, or open a web page" : undefined}
                  onClick={() => {
                    setOpen(false);
                    // An open web page or PDF: read it (from the selection, or from the top).
                    if (web?.page != null) {
                      web.reader.current?.readFromSelection();
                      return;
                    }
                    if (readTarget === null) return;
                    // A link object: save its page, open it, and read it.
                    const url = session.store.get("items", readTarget)?.url;
                    if (url !== undefined && url !== "") actions.openUrl(url, true);
                    else void speech.read(plugin.name, readTarget);
                  }}
                >
                  Read aloud
                </button>
                <button disabled={readTarget === null || plugins.job !== null} onClick={() => readTarget !== null && void speech.saveAudio(plugin.name, readTarget)}>
                  Save audio file…
                </button>
              </div>
              <ListenEstimate target={web?.page != null ? "page" : readTarget} rate={settings.speechRate} />
            </>
          )}
          {transforms && job === null && <SkipOptions field="translateSkip" title="Do not translate (keep as it is)" />}
          {transforms && job === null && web?.page != null && (
            // An open web page or PDF: its translation goes into a column at the right of the page.
            <div className="plugin-buttons">
              <button
                className="primary"
                disabled={plugins.job !== null}
                onClick={() => {
                  setOpen(false);
                  web.reader.current?.translate(plugin.name);
                }}
              >
                This page
              </button>
              {web.reader.current?.translated === true && <button onClick={() => web.reader.current?.hideTranslation()}>Hide translation</button>}
            </div>
          )}
          {!transforms || web?.page != null ? null : job === null ? (
            <div className="plugin-buttons">
              {/* With selected text, the first button translates only that text (the result shows in a panel). */}
              {selectedText() !== null && (
                <button
                  className="primary"
                  onClick={() => {
                    setOpen(false);
                    translateSelection();
                  }}
                >
                  Selected text
                </button>
              )}
              <button className={selectedText() === null ? "primary" : undefined} disabled={selectedIds.length === 0 || plugins.job !== null} onClick={() => void plugins.transform(plugin.name, selectedIds)}>
                {selectedIds.length <= 1 ? "Current item" : `Selected items (${selectedIds.length})`}
              </button>
              <button disabled={plugins.job !== null} onClick={() => void plugins.transform(plugin.name, boardItemIds())}>
                Whole board
              </button>
              {/* One button that flips: the cache stays, so both ways are at once. */}
              {shown > 0 ? (
                <button onClick={() => plugins.showOriginal([...plugins.overlay].filter(([, overlay]) => overlay.plugin === plugin.name).map(([id]) => id))}>
                  Show originals
                </button>
              ) : hidden > 0 ? (
                <button onClick={() => plugins.showTransformed({ plugin: plugin.name })}>{details.title === "Translate" ? "Show translations" : "Show results"}</button>
              ) : null}
            </div>
          ) : null}
          {converts && job === null && (
            <>
              <div className="plugin-buttons">
                <button className="primary" disabled={selectedIds.length === 0 || readOnlyVault || plugins.job !== null} onClick={() => void plugins.convert(plugin.name, selectedIds)}>
                  {selectedIds.length <= 1 ? "Current item" : `Selected items (${selectedIds.length})`}
                </button>
                <button disabled={readOnlyVault || plugins.job !== null} onClick={() => void plugins.convert(plugin.name, boardItemIds())}>
                  Whole board
                </button>
              </div>
              <div className="plugin-note muted">Changes the names and texts in place. ⌘Z undoes it.</div>
            </>
          )}
          {job !== null && (
            <div className="plugin-job">
              <progress max={Math.max(1, job.total)} value={job.done} />
              <span className="muted">{job.label !== "" ? job.label : `${Math.floor(job.done)} / ${job.total}`}</span>
              <button className="icon-button small" data-tip="Cancel" onClick={plugins.cancel}>
                <X size={14} />
              </button>
            </div>
          )}
          {speech?.error != null && <div className="plugin-error">{speech.error}</div>}
          {plugins.error !== null && <div className="plugin-error">{plugins.error}</div>}
          {transforms && mine.length > 0 && job === null && (
            <div className="plugin-save">
              <span className="plugin-skip-group">Save to a file</span>
              <button
                onClick={() => {
                  const ids = boardItemIds();
                  void save(fileNameOf(scope.name, "(multilingual)"), multilingualMarkdown(session.store, ids, overlayOf(plugins.overlay, plugin.name)));
                }}
              >
                {scope.kind === "page" ? "Multilingual version of this page…" : "Multilingual version of this board…"}
              </button>
              <button onClick={() => void save(fileNameOf(scope.name, "(all translations)"), translationsMarkdown(session.store, overlayOf(plugins.overlay, plugin.name)))}>
                {details.title === "Translate" ? `All translations of this session (${mine.length})…` : `All results of this session (${mine.length})…`}
              </button>
              {saved !== null && <span className="plugin-note muted">{`Saved: ${saved}`}</span>}
            </div>
          )}
          {transforms && (
            <div className="plugin-modes" role="group" aria-label="Show the result">
              <button className={settings.transformLayout === "replace" ? "active" : undefined} onClick={() => void session.updateSettings({ transformLayout: "replace" })}>
                In place of the text
              </button>
              <button className={settings.transformLayout === "side" ? "active" : undefined} onClick={() => void session.updateSettings({ transformLayout: "side" })}>
                Side by side
              </button>
            </div>
          )}
          {transforms && <div className="plugin-note muted">Results stay while the app is open. They are not saved in the vault. “Save to a file” writes a copy.</div>}
        </MovablePanel>
      )}
    </span>
  );
}

/** "About 12 min to listen": the text that Read aloud would read (from the selection, or all), at the current speed. */
function ListenEstimate({ target, rate }: { target: Id | "page" | null; rate: number }) {
  const session = useSession();
  const plugins = usePlugins();
  const web = useWebPages();
  if (target === null) return null;
  let text = "";
  let fromSelection = false;
  if (target === "page") {
    const read = web?.reader.current?.textToRead();
    if (read === undefined) return null;
    ({ text, fromSelection } = read);
  } else {
    const readable = readableText(session.store.get("texts", target)?.body ?? "", plugins.overlay.get(target));
    const selection = readable.side === "original" ? selectionOf(target) : undefined;
    fromSelection = selection !== undefined && selection.to > selection.from;
    text = fromSelection ? readable.text.slice(selection!.from) : readable.text;
  }
  if (text.trim() === "") return null;
  return (
    <div className="plugin-note muted">
      {fromSelection
        ? `${formatListenTime(listenSeconds(text, rate))} to listen from the selected text at ${rate.toFixed(2)}×`
        : `${formatListenTime(listenSeconds(text, rate))} to listen at ${rate.toFixed(2)}×`}
    </div>
  );
}

/** The results of one plugin. */
function overlayOf(overlay: OverlayMap, plugin: string): OverlayMap {
  return new Map([...overlay].filter(([, entry]) => entry.plugin === plugin));
}

/** A plugin option: a select box, or a text field that saves a valid value on Enter or when it loses focus. */
export function OptionField({ option, value, onChange }: { option: PluginOption; value: string; onChange(value: string): void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  if (option.kind === "choice") {
    return (
      <label>
        <span>{option.label}</span>
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          {option.choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  const valid = isValidOption(option, draft);
  const commit = () => {
    if (valid && draft !== value) onChange(draft.trim());
    else if (!valid) setDraft(value);
  };
  return (
    <label>
      <span>{option.label}</span>
      <span className="option-text">
      <input
        className={valid ? undefined : "invalid"}
        value={draft}
        placeholder={option.placeholder}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") setDraft(value);
        }}
      />
      {option.unit !== "" && <span className="option-unit">{option.unit}</span>}
      </span>
    </label>
  );
}

/** Skip options for read-aloud, with an example of each. */
const SKIP_CHOICES: { key: keyof SpeechSkip; label: string; example: string; group: "text" | "list" }[] = [
  { key: "authorDate", label: "Author–date citations", example: "(Smith, 2020) · (Lee & Park, 2019, p. 4) · Smith (2020) — APA, Harvard, Chicago", group: "text" },
  { key: "authorPage", label: "Author–page citations", example: "(Smith 23) · (Lee and Park 4–6) — MLA", group: "text" },
  { key: "numbered", label: "Numbered citations", example: "[1] · [2, 5–7] · (3) · growth.¹² — IEEE, Vancouver", group: "text" },
  { key: "parentheses", label: "All text in parentheses", example: "(like this)", group: "text" },
  { key: "brackets", label: "All text in square brackets", example: "[like this]", group: "text" },
  { key: "referenceList", label: "The whole reference list", example: "after a “References”, “Bibliography”, or “Works cited” heading", group: "list" },
  { key: "referenceAuthors", label: "Authors", example: "Smith, J. A., & Lee, K. (2020). Title… → (2020). Title…", group: "list" },
  { key: "referenceDates", label: "Years and dates", example: "(2020) · 2019. · Mar. 2020", group: "list" },
  { key: "referencePages", label: "Page numbers", example: "pp. 45–67 · 12(3), 45–67 · 2020;12:45-67", group: "list" },
  { key: "referenceLinks", label: "Links and DOIs", example: "https://doi.org/10.1000/xyz · doi:10.1000/xyz", group: "list" },
];

/**
 * The parts to skip, with an example of each: "Do not read" (read-aloud leaves them out) or "Do not translate"
 * (a translation keeps them as they are). Each has its own setting.
 */
function SkipOptions({ field = "speechSkip", title = "Do not read" }: { field?: "speechSkip" | "translateSkip"; title?: string }) {
  const session = useSession();
  const skip = useSessionState().settings[field];
  const count = SKIP_CHOICES.filter((choice) => skip[choice.key]).length;
  const set = (key: keyof SpeechSkip, value: boolean) => void session.updateSettings({ [field]: { ...NO_SKIP, ...skip, [key]: value } });
  const row = (choice: (typeof SKIP_CHOICES)[number]) => (
    <label key={choice.key} className="plugin-check" title={choice.example}>
      <input type="checkbox" checked={skip[choice.key]} disabled={choice.group === "list" && choice.key !== "referenceList" && skip.referenceList} onChange={(event) => set(choice.key, event.target.checked)} />
      <span>
        {choice.label}
        <span className="plugin-example">{choice.example}</span>
      </span>
    </label>
  );
  return (
    <details className="plugin-skip">
      <summary>{title}{count > 0 ? ` (${count})` : ""}</summary>
      <div className="plugin-skip-group">In the text</div>
      {SKIP_CHOICES.filter((choice) => choice.group === "text").map(row)}
      <div className="plugin-skip-group">In the reference list</div>
      {SKIP_CHOICES.filter((choice) => choice.group === "list").map(row)}
    </details>
  );
}
