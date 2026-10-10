// Trackpad pinch for the macOS webview (WebKit).
// WebKit sends pinch as "gesturestart/gesturechange" events, not as Ctrl+wheel events.
// This hook converts them to a zoom callback. Other webviews send Ctrl+wheel, which the views handle.

import { useEffect, type RefObject } from "react";

/** WebKit GestureEvent. It is not in the standard DOM types. */
type GestureEvent = UIEvent & { scale: number; clientX: number; clientY: number };

export type PinchHandler = {
  /** Called at the start. Returns the zoom value at the start. */
  begin(): number;
  /** Called during the pinch with the new zoom value and the pointer position in client space. */
  change(zoom: number, clientX: number, clientY: number): void;
};

export function usePinchZoom(target: RefObject<HTMLElement | null>, handler: PinchHandler): void {
  useEffect(() => {
    const element = target.current;
    if (element === null) return;
    let startZoom = 1;
    const onStart = (event: Event) => {
      event.preventDefault();
      startZoom = handler.begin();
    };
    const onChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as GestureEvent;
      handler.change(startZoom * gesture.scale, gesture.clientX, gesture.clientY);
    };
    const onEnd = (event: Event) => event.preventDefault();
    element.addEventListener("gesturestart", onStart);
    element.addEventListener("gesturechange", onChange);
    element.addEventListener("gestureend", onEnd);
    return () => {
      element.removeEventListener("gesturestart", onStart);
      element.removeEventListener("gesturechange", onChange);
      element.removeEventListener("gestureend", onEnd);
    };
  }, [target, handler]);
}
