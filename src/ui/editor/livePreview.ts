// Live preview for Markdown. See docs/SPEC.md section 7.5.
// Marks (#, *, `, [](...)) are hidden on lines without the cursor.
// Only decorations change. The text stays byte for byte the same.

import { syntaxTree } from "@codemirror/language";
import { StateEffect, StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";

const HIDDEN_MARKS = new Set(["HeaderMark", "EmphasisMark", "CodeMark", "StrikethroughMark", "LinkMark", "URL"]);

const STYLE_OF_NODE: Record<string, string> = {
  StrongEmphasis: "cm-md-strong",
  Emphasis: "cm-md-em",
  InlineCode: "cm-md-code",
  Strikethrough: "cm-md-strike",
  Link: "cm-md-link",
};

const hide = Decoration.replace({});

type TreeNode = ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]>;

/**
 * True if a Link node is a real link: it has an address "(...)" or a reference label "[text][label]".
 * Plain "[text]" (for example a checklist-like "[ ]" or a note in brackets) shows as plain text with its brackets.
 */
function isRealLink(node: TreeNode): boolean {
  return node.getChild("URL") !== null || node.getChild("LinkLabel") !== null;
}

function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let line = first; line <= last; line += 1) lines.add(line);
  }
  return lines;
}

function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const active = activeLines(state);
  const ranges: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;
        const heading = /^ATXHeading(\d)$/.exec(name);
        if (heading) {
          const line = state.doc.lineAt(node.from);
          ranges.push(Decoration.line({ class: `cm-md-h${heading[1]}` }).range(line.from));
          return;
        }
        // "[text]" without a target is plain text: no link style, and its brackets stay.
        if (name === "Link" && !isRealLink(node.node)) return;
        if (name === "LinkMark" && node.node.parent?.name === "Link" && !isRealLink(node.node.parent)) return;
        const style = STYLE_OF_NODE[name];
        if (style !== undefined && node.to > node.from) {
          ranges.push(Decoration.mark({ class: style }).range(node.from, node.to));
        }
        if (HIDDEN_MARKS.has(name) && node.to > node.from) {
          const line = state.doc.lineAt(node.from).number;
          const sameLine = state.doc.lineAt(node.to).number === line;
          if (sameLine && !active.has(line)) {
            // A heading mark also hides the space after it.
            const end = name === "HeaderMark" && state.doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
            ranges.push(hide.range(node.from, end));
          }
        }
      },
    });
  }
  return Decoration.set(ranges, true);
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** The target of a link at a position: an item (item:<id>) or a relation link (link:<id>). Null if none. */
export function linkTargetAt(state: EditorState, position: number): { kind: "item" | "link"; id: string } | null {
  let node = syntaxTree(state).resolveInner(position, 1);
  while (node.parent !== null && node.name !== "Link") node = node.parent;
  if (node.name !== "Link") return null;
  const url = node.getChild("URL");
  if (url === null) return null;
  const match = /^(item|link):([0-9a-z]{12})$/.exec(state.doc.sliceString(url.from, url.to));
  return match ? { kind: match[1] as "item" | "link", id: match[2]! } : null;
}

/** A web address at a position: the target of a Markdown link, or a plain "https://…" in the text. Null if none. */
export function webUrlAt(state: EditorState, position: number): string | null {
  let node = syntaxTree(state).resolveInner(position, 1);
  while (node.parent !== null && node.name !== "Link" && node.name !== "Autolink") node = node.parent;
  if (node.name === "Link" || node.name === "Autolink") {
    const url = node.getChild("URL");
    const target = url === null ? "" : state.doc.sliceString(url.from, url.to);
    if (/^https?:\/\//i.test(target)) return target;
  }
  const line = state.doc.lineAt(position);
  for (const match of line.text.matchAll(/https?:\/\/[^\s<>()[\]"']+/gi)) {
    const from = line.from + match.index;
    // A sentence end after the address is not a part of it.
    const address = match[0].replace(/[.,;:!?]+$/, "");
    if (position >= from && position <= from + address.length) return address;
  }
  return null;
}

/** A yellow mark on a text range: the target of a jump (a search hit or a link location). */
export const setFlash = StateEffect.define<{ from: number; to: number } | null>();

export const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setFlash)) continue;
      next = effect.value === null || effect.value.to <= effect.value.from ? Decoration.none : Decoration.set([flashMark.range(effect.value.from, effect.value.to)]);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const flashMark = Decoration.mark({ class: "cm-flash" });

export const editorTheme = EditorView.theme(
  {
    "&": { height: "100%", color: "var(--text)", backgroundColor: "transparent", fontSize: "14px" },
    ".cm-content": { fontFamily: "var(--font-ui)", lineHeight: "1.6", padding: "12px 16px", caretColor: "var(--accent)" },
    ".cm-scroller": { overflow: "auto" },
    "&.cm-focused": { outline: "none" },
    ".cm-cursor": { borderLeftColor: "var(--accent)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "var(--accent-soft) !important" },
    ".cm-md-h1": { fontSize: "1.6em", fontWeight: "700" },
    ".cm-md-h2": { fontSize: "1.35em", fontWeight: "700" },
    ".cm-md-h3": { fontSize: "1.15em", fontWeight: "600" },
    ".cm-md-h4, .cm-md-h5, .cm-md-h6": { fontWeight: "600" },
    ".cm-md-strong": { fontWeight: "700" },
    ".cm-md-em": { fontStyle: "italic" },
    ".cm-md-strike": { textDecoration: "line-through" },
    ".cm-md-code": { fontFamily: "var(--font-mono)", fontSize: "0.9em", backgroundColor: "var(--bg-raised)", borderRadius: "3px" },
    ".cm-md-link": { color: "var(--accent)", cursor: "pointer" },
    ".cm-flash": { backgroundColor: "rgba(255, 214, 10, 0.45)", color: "var(--text)", borderRadius: "2px" },
  },
  { dark: true },
);
