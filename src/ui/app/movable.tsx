// Panels that the user can move: dialogs and tool bar popovers (settings, plugin options, read aloud).
// - When it opens, a panel moves into the window if a part of it is outside.
// - A drag on its title moves it. Its title always stays in the window.
// - The position is only for the open panel: it is not saved.

import { useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

/** The space between a panel and the window edge (px). */
const MARGIN = 8;
/** The part of the title that stays in the window during a drag (px). */
const KEEP = 48;

export function useMovable<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  // At open: move the panel into the window.
  useLayoutEffect(() => {
    const panel = ref.current;
    if (panel === null) return;
    const box = panel.getBoundingClientRect();
    const into = (start: number, end: number, size: number) => {
      let shift = Math.min(0, size - MARGIN - end);
      if (start + shift < MARGIN) shift = MARGIN - start;
      return shift;
    };
    const x = into(box.left, box.right, window.innerWidth);
    const y = into(box.top, box.bottom, window.innerHeight);
    if (x !== 0 || y !== 0) setOffset({ x, y });
  }, []);

  /** Put on the title (with the class "movable-handle"): a drag there moves the panel. */
  const onTitlePointerDown = (event: ReactPointerEvent) => {
    if (event.button !== 0 || ref.current === null) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, select, textarea, a") !== null) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const start = { x: event.clientX, y: event.clientY, offset };
    const box = ref.current.getBoundingClientRect();
    const base = { left: box.left - offset.x, top: box.top - offset.y };
    const move = (next: PointerEvent) => {
      const x = start.offset.x + next.clientX - start.x;
      const y = start.offset.y + next.clientY - start.y;
      setOffset({
        x: Math.min(window.innerWidth - KEEP - base.left, Math.max(KEEP - box.width - base.left, x)),
        y: Math.min(window.innerHeight - KEEP - base.top, Math.max(-base.top, y)),
      });
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  const style: CSSProperties = offset.x === 0 && offset.y === 0 ? {} : { translate: `${offset.x}px ${offset.y}px` };
  return { ref, style, onTitlePointerDown };
}

/** A panel with a title that moves it. */
export function MovablePanel({ className, titleClassName, label, title, onMouseDown, children }: { className: string; titleClassName: string; label: string; title: ReactNode; onMouseDown?(event: ReactMouseEvent): void; children: ReactNode }) {
  const { ref, style, onTitlePointerDown } = useMovable<HTMLDivElement>();
  return (
    <div ref={ref} className={className} style={style} role="dialog" aria-label={label} onMouseDown={onMouseDown}>
      <div className={`${titleClassName} movable-handle`} onPointerDown={onTitlePointerDown}>
        {title}
      </div>
      {children}
    </div>
  );
}
