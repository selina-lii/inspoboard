// Files dropped on the window from the system (Finder). The window gets their full paths from the backend (the page
// itself does not see them). The drop goes to the element under the pointer:
// - A text field with `data-file-drop` (the address field of a link): its text becomes the path of the first file.
// - Else a "file-drop" DOM event bubbles up from that element. The board makes a link card for each file.

import { useEffect } from "react";
import type { Backend } from "../../io/backend";
import { logEvent } from "./debugLog";

export const FILE_DROP = "app-file-drop";
export type FileDrop = { paths: string[]; x: number; y: number };

export function useFileDrop(backend: Backend): void {
  useEffect(() => {
    const stop = backend.onFileDrop(deliver);
    return () => void stop.then((unlisten) => unlisten());
  }, [backend]);
}

function deliver(drop: FileDrop): void {
  const target = document.elementFromPoint(drop.x, drop.y);
  // The session log tells where a drop went, if a drop does nothing.
  logEvent(`File drop: ${drop.paths.length} file(s) at ${Math.round(drop.x)},${Math.round(drop.y)} on ${target === null ? "nothing" : `${target.tagName.toLowerCase()}.${[...target.classList].join(".")}`}`);
  if (target === null) return;
  const field = target.closest("[data-file-drop]");
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    if (field.readOnly || field.disabled) return;
    setFieldText(field, drop.paths[0]!);
    field.focus();
    return;
  }
  target.dispatchEvent(new CustomEvent<FileDrop>(FILE_DROP, { bubbles: true, detail: drop }));
}

/** Sets the text of a field so that React sees the change (as if the user typed it). */
function setFieldText(field: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")?.set?.call(field, text);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}
