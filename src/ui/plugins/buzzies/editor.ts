// Buzzies mode in a page editor (SPEC 7.13). The editor reads changes of its text in the DOM as typing, so the
// text itself never changes: while the mode is on, each word shows as a widget with its buzzed glyphs (the same
// glyphs as everywhere: buzz.ts). The widgets go when the mode ends, and the words show again. The blur style needs
// no widgets: the text blurs in CSS. The user can type as usual: the text of the editor stays the real text.

import { Prec, RangeSetBuilder, StateEffect } from "@codemirror/state";
import { Decoration, ViewPlugin, WidgetType, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import { buzzText } from "./buzz";
import { buzzPhase, buzzStyle, onBuzzPhase, registerBuzzNode, unregisterBuzzNode } from "./buzzies";

const phaseChanged = StateEffect.define<null>();

class BuzzWordWidget extends WidgetType {
  constructor(readonly word: string) {
    super();
  }
  override eq(other: BuzzWordWidget): boolean {
    return other.word === this.word;
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "buzz-word";
    const text = document.createTextNode(buzzText(this.word));
    span.append(text);
    registerBuzzNode(text, this.word);
    return span;
  }
  override destroy(dom: HTMLElement): void {
    if (dom.firstChild instanceof Text) unregisterBuzzNode(dom.firstChild);
  }
}

function build(view: EditorView): DecorationSet {
  if (buzzPhase() === "off" || buzzStyle() === "blur") return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.sliceDoc(from, to);
    for (const match of text.matchAll(/\S+/gu)) {
      builder.add(from + match.index, from + match.index + match[0].length, Decoration.replace({ widget: new BuzzWordWidget(match[0]) }));
    }
  }
  return builder.finish();
}

/** The editor extension. Lowest precedence: pictures and other widgets of the editor stay (they blur in CSS). */
export const buzzEditor = Prec.lowest(
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      unsubscribe: () => void;
      constructor(view: EditorView) {
        this.decorations = build(view);
        this.unsubscribe = onBuzzPhase(() => view.dispatch({ effects: phaseChanged.of(null) }));
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(phaseChanged)))) {
          this.decorations = build(update.view);
        }
      }
      destroy() {
        this.unsubscribe();
      }
    },
    { decorations: (plugin) => plugin.decorations },
  ),
);
