// Clips in a lineage (SPEC 7.16): text that the user copies from an item A and pastes into an item B on a processing
// map gives B the source A. The last copied texts are kept in memory (with their items) to know where a paste came from.

import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import type { Id } from "../../../core/types";

/** A clip shorter than this is not a source (a word or two can come from anywhere). */
const MIN_CLIP = 12;
const KEEP = 12;
const recent: { text: string; from: Id }[] = [];

function remember(text: string, from: Id): void {
  const value = text.trim();
  if (value.length < MIN_CLIP) return;
  const at = recent.findIndex((clip) => clip.text === value);
  if (at !== -1) recent.splice(at, 1);
  recent.unshift({ text: value, from });
  recent.length = Math.min(recent.length, KEEP);
}

/** The items that a pasted text came from: each kept clip that is in it. */
export function sourcesOfPaste(pasted: string, into: Id): Id[] {
  const value = pasted.trim();
  if (value.length < MIN_CLIP) return [];
  return [...new Set(recent.filter((clip) => clip.from !== into && value.includes(clip.text)).map((clip) => clip.from))];
}

/** Editor extension: copy and cut remember the clip; a paste gives `onSources` the items that it came from. */
export function clipLineage(itemId: Id, onSources: (sources: Id[]) => void): Extension {
  const keep = (view: EditorView) => {
    const range = view.state.selection.main;
    if (!range.empty) remember(view.state.sliceDoc(range.from, range.to), itemId);
    return false;
  };
  return EditorView.domEventHandlers({
    copy: (_event, view) => keep(view),
    cut: (_event, view) => keep(view),
    paste: (event) => {
      const sources = sourcesOfPaste(event.clipboardData?.getData("text/plain") ?? "", itemId);
      if (sources.length > 0) onSources(sources);
      return false;
    },
  });
}
