// A menu, a list, or a panel that closes on a click outside it or on Esc.

import { useEffect, useRef, type RefObject } from "react";

/**
 * While `open`: a press outside `frame`, or Esc, calls `onClose`.
 * - `capture`: listen before other handlers (a menu over the board), and Esc goes no further.
 * - `blur`: the window losing the focus closes it too.
 */
export function useDismiss(open: boolean, frame: RefObject<Element | null>, onClose: () => void, options: { capture?: boolean; blur?: boolean } = {}): void {
  const close = useRef(onClose);
  close.current = onClose;
  const { capture = false, blur = false } = options;
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (frame.current !== null && !frame.current.contains(event.target as Node)) close.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (capture) event.stopPropagation();
      close.current();
    };
    const onBlur = () => close.current();
    window.addEventListener("pointerdown", onPointerDown, capture);
    window.addEventListener("keydown", onKeyDown, capture);
    if (blur) window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, capture);
      window.removeEventListener("keydown", onKeyDown, capture);
      window.removeEventListener("blur", onBlur);
    };
  }, [open, frame, capture, blur]);
}
