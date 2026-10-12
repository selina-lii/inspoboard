// Text editor for the body text of one item. This is the CodeMirror adapter.
// - Each editor has its own undo stack (CodeMirror history). See docs/SPEC.md section 5.2.
// - Changes go to the store with writeText(). They are not global commands.
// - If the store text changes from outside (a reload from disk), the editor shows the new text.

import { defaultKeymap, history, indentWithTab, redo, undo, undoDepth } from "@codemirror/commands";
import { sendToBench } from "../app/LinkBench";
import { reportPassage } from "../app/passages";
import { markdown } from "@codemirror/lang-markdown";
import { Annotation, EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { Transaction } from "@codemirror/state";
import { Link2, Plus } from "lucide-react";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { writeText } from "../../core/actions";
import type { Id } from "../../core/types";
import { useRunCommand, useSession, useSessionState } from "../app/sessionContext";
import { announceNewComment, commentCommand } from "../windows/CommentColumn";
import { withScheme } from "../web/savedPages";
import { ContextMenu, type MenuRequest } from "../app/ContextMenu";
import { useJump, useWorkspaceActions, type WorkspaceActions } from "../app/workspaceActions";
import { useSpeech } from "../plugins/speech";
import { formattingKeys } from "./formatting";
import { editorTheme, flashField, linkTargetAt, livePreview, setFlash, webUrlAt } from "./livePreview";
import { useWebPages } from "../web/WebPages";
import { Download, Globe, MessageSquarePlus, RefreshCw } from "lucide-react";
import { rememberSelection } from "./selections";
import { markAt, markField, markTheme, setMarkRanges } from "./marks";
import { spacerField } from "./spacers";
import { imageInput, imagePreview, imageSource } from "./images";
import { linkCard } from "./linkCard";
import { describeTarget } from "../app/textLinks";
import { t } from "../i18n/i18n";
import { urlOf } from "../app/vaultImages";
import { ScribbleLayer, useMarks } from "../windows/marks";
import { Highlighter, Eraser } from "lucide-react";

/** Marks a transaction that came from the store. It must not go back to the store. */
const fromStore = Annotation.define<boolean>();

/** Functions that a parent can call, for example from a tool bar button. */
export type TextEditorApi = {
  linkSelection(): void;
  focus(): void;
  /** Highlights the selected text (marks). False if no text is selected. */
  highlightSelection(): boolean;
  /** The CodeMirror view (for side-by-side alignment). */
  view(): EditorView | null;
};

type Props = {
  itemId: Id;
  readOnly: boolean;
  apiRef?: MutableRefObject<TextEditorApi | null>;
  autoFocus?: boolean;
  /** Called when the layout of the text changes (an edit, a new width, fonts). */
  onLayout?: () => void;
};

export function TextEditor({ itemId, readOnly, apiRef, autoFocus, onLayout }: Props) {
  const layoutListener = useRef(onLayout);
  layoutListener.current = onLayout;
  const session = useSession();
  const host = useRef<HTMLDivElement>(null);
  const actions = useRef<WorkspaceActions>(useWorkspaceActions());
  actions.current = useWorkspaceActions();
  const viewRef = useRef<EditorView | null>(null);
  const [menu, setMenu] = useState<MenuRequest | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const marksValue = useMarks();
  const marks = useRef(marksValue);
  marks.current = marksValue;
  const [scrollHost, setScrollHost] = useState<HTMLElement | null>(null);
  const web = useRef(useWebPages());
  web.current = useWebPages();
  const runCommand = useRunCommand();
  const userName = useSessionState().settings.userName;
  /** Selected text: "Comment" and "Add web link…". */
  const selectionEntries = useRef<(view: EditorView) => MenuRequest["entries"]>(() => []);
  selectionEntries.current = (view) => {
    if (view.state.readOnly) return [];
    const range = view.state.selection.main;
    const label = view.state.sliceDoc(range.from, range.to);
    // The caret in a highlight: "Remove highlight".
    const hit = marks.current === null ? undefined : markAt(view.state.field(markField).ranges, range.head);
    if (label.trim() === "") {
      return hit === undefined ? [] : [{ label: "Remove highlight", icon: <Eraser size={14} />, onSelect: () => marks.current?.removeHighlight(hit.id) }];
    }
    const entries: MenuRequest["entries"] = [];
    if (marks.current !== null) {
      entries.push({
        label: "Highlight",
        icon: <Highlighter size={14} />,
        onSelect: () => marks.current?.addHighlight(range.from, range.to, view.state.doc.toString()),
      });
    }
    entries.push(
      {
        label: "Comment",
        icon: <MessageSquarePlus size={14} />,
        onSelect: () => {
          const { command, itemId: commentId } = commentCommand(session.context, session.rootId, itemId, userName, label, range.from);
          if (runCommand(command)) announceNewComment(itemId, commentId);
        },
      },
    );
    entries.push({ label: "Send to link bench", icon: <Link2 size={14} />, onSelect: () => sendToBench({ itemId, quote: label, range: { from: range.from, to: range.to } }) });
    if (!label.includes("\n") && !label.includes("]")) {
      entries.push({
        label: "Add web link…",
        icon: <Globe size={14} />,
        onSelect: async () => {
          const values = await actions.current.askFields({ title: `Web link for “${label}”`, submit: "Add link", fields: [{ key: "url", label: "Web address", value: "", placeholder: "https://…", pattern: /\S/ }] });
          if (values === null) return;
          view.dispatch({ changes: { from: range.from, to: range.to, insert: `[${label}](${withScheme(values.url!)})` } });
        },
      });
    }
    return entries;
  };
  const showMenu = useRef<(view: EditorView, x: number, y: number, at?: number) => boolean>(() => false);
  showMenu.current = (view, x, y, at) => {
    const links = linkMenu(view, itemId, actions.current);
    const url = at === undefined ? null : webUrlAt(view.state, at);
    const pages = url === null || web.current === null ? [] : webMenu(url, web.current);
    const entries = [...pages, ...links, ...selectionEntries.current(view)];
    if (entries.length === 0) return false;
    setMenu({ x, y, entries });
    return true;
  };
  const jump = useJump(itemId);
  // While this item is read aloud, a click on a sentence goes to that sentence.
  const speech = useRef(useSpeech());
  speech.current = useSpeech();

  useEffect(() => {
    const store = session.store;
    const initial = store.get("texts", itemId)?.body ?? "";
    /** True while the app history runs an undo or redo of this editor: that change is no new step. */
    let replaying = false;
    /** After the editor closes, its steps in the app history do nothing. */
    let destroyed = false;
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initial,
        extensions: [
          history(),
          keymap.of([
            {
              key: "Mod-k",
              run: (editorView) => {
                const at = editorView.coordsAtPos(editorView.state.selection.main.to);
                return showMenu.current(editorView, at?.left ?? 0, at?.bottom ?? 0);
              },
            },
            // One undo history for the page: text, marks, comments, notes, and the name (the app history).
            { key: "Mod-z", run: () => (session.history.undo(), true), preventDefault: true },
            { key: "Mod-Shift-z", run: () => (session.history.redo(), true), preventDefault: true },
            { key: "Mod-y", run: () => (session.history.redo(), true), preventDefault: true },
            // ⌘B bold, ⌘I italic, ⌘U underline (formatting.ts).
            ...(readOnly ? [] : formattingKeys),
            ...defaultKeymap,
            indentWithTab,
          ]),
          markdown(),
          livePreview,
          // A link to an item: a hover card with its name, place, and passage, and a "Go to" button.
          linkCard(
            (target) => describeTarget(session.store, session.graph, session.rootId, target),
            (target) => (target.kind === "link" ? actions.current.followLink(target.id) : actions.current.openRecord(target.id)),
            t,
          ),
          imagePreview,
          imageSource.of((path) => urlOf(session, path)),
          imageInput(
            (name, bytes) => session.saveImageBytes(name, bytes),
            (message) => setImageError(`The image could not be added: ${message}`),
          ),
          flashField,
          markField,
          markTheme,
          spacerField,
          editorTheme,
          EditorView.lineWrapping,
          // Each line gets its own direction: right-to-left for Arabic or Hebrew, left-to-right for others.
          EditorView.perLineTextDirection.of(true),
          EditorState.readOnly.of(readOnly),
          placeholder("Write here…"),
          EditorView.updateListener.of((update) => {
            if (update.geometryChanged || update.heightChanged || update.docChanged) layoutListener.current?.();
            if (update.selectionSet) {
              const { from, to } = update.state.selection.main;
              rememberSelection(itemId, from, to);
              // The link bench can take the selected passage (with its place in the text).
              if (update.view.hasFocus) reportPassage(from < to ? { itemId, quote: update.state.sliceDoc(from, to), range: { from, to } } : null, itemId);
            }
            // Edits move the highlights. Save their new ranges.
            if (update.docChanged && update.state.field(markField).ranges.length > 0) {
              marks.current?.moveHighlights(update.state.field(markField).ranges, update.state.doc.toString());
            }
            if (!update.docChanged) return;
            if (update.transactions.some((transaction) => transaction.annotation(fromStore) === true)) return;
            // A new step of the editor history (typing pauses group the keys): one step in the app history. Its undo
            // and redo run the editor's own undo and redo, so the cursor comes back too.
            if (!replaying && undoDepth(update.state) > undoDepth(update.startState)) {
              const replay = (run: (target: EditorView) => boolean) => {
                if (destroyed) return;
                replaying = true;
                try {
                  run(update.view);
                } finally {
                  replaying = false;
                }
              };
              session.history.recordView("Edit text", { undo: () => replay(undo), redo: () => replay(redo) });
            }
            if (!store.has("items", itemId)) return;
            writeText(store, itemId, update.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            // Highlight tool: each selection gets a highlight.
            mouseup: (_event, editorView) => {
              const mark = marks.current;
              if (mark?.mode !== "highlight") return false;
              window.setTimeout(() => {
                const range = editorView.state.selection.main;
                if (range.empty) return;
                mark.addHighlight(range.from, range.to, editorView.state.doc.toString());
                editorView.dispatch({ selection: { anchor: range.to } });
              }, 0);
              return false;
            },
            mousedown: (event, editorView) => {
              // Eraser: a click on a highlight removes it.
              if (marks.current?.mode === "erase" && event.button === 0) {
                const position = editorView.posAtCoords({ x: event.clientX, y: event.clientY });
                const hit = position === null ? undefined : markAt(editorView.state.field(markField).ranges, position);
                if (hit !== undefined) {
                  event.preventDefault();
                  marks.current.removeHighlight(hit.id);
                  return true;
                }
              }
              const reading = speech.current?.state;
              if (reading != null && reading.sourceId === itemId && reading.side === "original" && !reading.preparing && event.button === 0 && !(event.metaKey || event.ctrlKey)) {
                const position = editorView.posAtCoords({ x: event.clientX, y: event.clientY });
                if (position !== null) speech.current?.clickSeek(position);
                return false;
              }
              if (!(event.metaKey || event.ctrlKey) || event.button !== 0) return false;
              const position = editorView.posAtCoords({ x: event.clientX, y: event.clientY });
              const url = position === null ? null : webUrlAt(editorView.state, position);
              if (url !== null && web.current !== null) {
                event.preventDefault();
                void web.current.jumpTo(url);
                return true;
              }
              const target = position === null ? null : linkTargetAt(editorView.state, position);
              if (target === null) return false;
              event.preventDefault();
              if (target.kind === "link") actions.current.followLink(target.id);
              else actions.current.openRecord(target.id);
              return true;
            },
            // Right-click: "Read web page" on a web address, "Create link to…" on selected text.
            contextmenu: (event, editorView) => {
              const position = editorView.posAtCoords({ x: event.clientX, y: event.clientY }) ?? undefined;
              if (!showMenu.current(editorView, event.clientX, event.clientY, position)) return false;
              event.preventDefault();
              return true;
            },
          }),
        ],
      }),
    });

    const unsubscribe = store.subscribe((changes) => {
      if (!changes.some((change) => change.table === "texts" && change.id === itemId)) return;
      const body = store.get("texts", itemId)?.body ?? "";
      const current = view.state.doc.toString();
      if (body === current) return;
      view.dispatch({
        changes: { from: 0, to: current.length, insert: body },
        annotations: [fromStore.of(true), Transaction.addToHistory.of(false)],
      });
    });

    viewRef.current = view;
    setScrollHost(view.scrollDOM);
    if (apiRef !== undefined) {
      apiRef.current = {
        highlightSelection: () => {
          const range = view.state.selection.main;
          if (range.empty || marks.current === null) return false;
          marks.current.addHighlight(range.from, range.to, view.state.doc.toString());
          return true;
        },
        linkSelection: () => {
          const at = view.coordsAtPos(view.state.selection.main.to);
          showMenu.current(view, at?.left ?? 0, at?.bottom ?? 0);
        },
        focus: () => view.focus(),
        view: () => view,
      };
    }
    if (autoFocus === true) view.focus();

    return () => {
      unsubscribe();
      setScrollHost(null);
      if (apiRef !== undefined) apiRef.current = null;
      viewRef.current = null;
      destroyed = true;
      view.destroy();
    };
  }, [session, itemId, readOnly, apiRef, autoFocus]);

  // The highlights of the marks file, placed in the current text.
  const markNotes = marksValue?.notes;
  useEffect(() => {
    const view = viewRef.current;
    if (view === null || markNotes === undefined || marks.current === null) return;
    view.dispatch({ effects: setMarkRanges.of(marks.current.rangesIn(view.state.doc.toString())) });
  }, [markNotes, scrollHost]);

  // A jump to this item: mark the range in yellow, select it, and scroll to it.
  useEffect(() => {
    const view = viewRef.current;
    if (jump === null || view === null) return;
    const length = view.state.doc.length;
    const from = Math.min(jump.from, length);
    const to = Math.min(Math.max(jump.to, from), length);
    view.dispatch({ effects: [setFlash.of({ from, to }), EditorView.scrollIntoView(from, { y: "center" })], selection: { anchor: from, head: to } });
  }, [jump]);

  return (
    <>
      <div className={`text-editor${marksValue !== null && marksValue.mode !== "none" ? ` marking-${marksValue.mode}` : ""}`} data-item-id={itemId} ref={host} />
      {scrollHost !== null && marksValue !== null && <ScribbleLayer host={scrollHost} />}
      {menu !== null && <ContextMenu request={menu} onClose={() => setMenu(null)} />}
      {imageError !== null && (
        <div className="editor-error" role="alert">
          <span>{imageError}</span>
          <button className="icon-button small" data-tip="Close" onClick={() => setImageError(null)}>
            ×
          </button>
        </div>
      )}
    </>
  );
}

/**
 * The "Create link to…" entries for the selected text. None if no text is selected.
 * The selection must be on one line and must not contain "]" (a Markdown link label).
 */
function linkMenu(view: EditorView, itemId: Id, actions: WorkspaceActions): MenuRequest["entries"] {
  if (view.state.readOnly) return [];
  const range = view.state.selection.main;
  const label = view.state.sliceDoc(range.from, range.to);
  if (label.trim() === "" || label.includes("\n") || label.includes("]")) return [];
  const create = (mode: "new" | "existing") => () => actions.createTextLink({ sourceId: itemId, label, from: range.from, to: range.to, mode });
  return [
    { label: "Create link to a new page", icon: <Plus size={14} />, onSelect: create("new") },
    { label: "Create link to an existing item…", icon: <Link2 size={14} />, onSelect: create("existing") },
  ];
}

/** Entries for a web address: open it in the web browser, download it and open it locally, or download it again. */
function webMenu(url: string, web: NonNullable<ReturnType<typeof useWebPages>>): MenuRequest["entries"] {
  const entries: MenuRequest["entries"] = [
    { label: "Open in web browser", icon: <Globe size={14} />, onSelect: () => void web.openInBrowser(url) },
    { label: "Download and open website locally", icon: <Download size={14} />, onSelect: () => void web.openWebPage(url) },
  ];
  if (web.canSave) entries.push({ label: "Save web page again", icon: <RefreshCw size={14} />, onSelect: () => void web.openWebPage(url, true) });
  return entries;
}
