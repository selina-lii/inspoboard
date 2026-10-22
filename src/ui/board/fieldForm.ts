// The edit form of a card (a name, the link fields, the media fields): Enter saves, Escape cancels, and a form that
// goes away without Enter or Escape (a click elsewhere, the card scrolls away) saves.

import { useEffect, useRef, type KeyboardEvent } from "react";
import { isComposing } from "../app/keys";

/** `save`: writes the fields (it can read the current state). `onEnd`: closes the form. */
export function useFieldForm(save: () => void, onEnd: () => void) {
  const done = useRef(false);
  const latest = useRef({ save, onEnd });
  latest.current = { save, onEnd };
  useEffect(
    () => () => {
      if (!done.current) latest.current.save();
    },
    [],
  );
  /** Closes the form one time: with `commit`, it saves first. */
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) latest.current.save();
    latest.current.onEnd();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (isComposing(event)) return;
    if (event.key === "Enter") finish(true);
    if (event.key === "Escape") finish(false);
  };
  return { finish, onKeyDown };
}
