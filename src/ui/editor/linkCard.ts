// The hover card of a link to an item in a text: the name of the linked item, where it lives, the linked passage,
// and a "Go to" button. ⌘-click on the link goes there too. See docs/SPEC.md section 7.5.

import { hoverTooltip, type EditorView } from "@codemirror/view";
import type { LinkEnd } from "../app/textLinks";
import { linkTargetAt } from "./livePreview";

type Target = { kind: "item" | "link"; id: string };

/**
 * `describe`: the linked item of a target (null: it is gone). `open`: goes to it. `label`: the UI text (translated).
 */
export function linkCard(describe: (target: Target) => LinkEnd | null, open: (target: Target) => void, label: (text: string) => string) {
  return hoverTooltip(
    (view: EditorView, position: number) => {
      const target = linkTargetAt(view.state, position);
      if (target === null) return null;
      return {
        pos: position,
        above: true,
        create: () => {
          const dom = document.createElement("div");
          dom.className = "cm-link-card";
          const end = describe(target);
          if (end === null) {
            dom.textContent = label("The linked item is gone.");
            return { dom };
          }
          const head = document.createElement("div");
          head.className = "cm-link-card-head";
          const title = document.createElement("span");
          title.className = "cm-link-card-title";
          title.textContent = end.title;
          title.dir = "auto";
          const go = document.createElement("button");
          go.type = "button";
          go.className = "cm-link-card-go";
          go.textContent = label("Go to");
          go.title = label("Go to the linked item (⌘-click the link)");
          go.addEventListener("mousedown", (event) => event.preventDefault());
          go.addEventListener("click", () => open(target));
          head.append(title, go);
          dom.append(head);
          if (end.path !== "") {
            const path = document.createElement("div");
            path.className = "cm-link-card-path";
            path.textContent = end.path;
            dom.append(path);
          }
          if (end.excerpt !== "") {
            const excerpt = document.createElement("div");
            excerpt.className = "cm-link-card-excerpt";
            excerpt.dir = "auto";
            excerpt.textContent = end.excerpt.length > 160 ? `${end.excerpt.slice(0, 160)}…` : end.excerpt;
            dom.append(excerpt);
          }
          return { dom };
        },
      };
    },
    { hoverTime: 250 },
  );
}
