// The size grip of a small item in a page or a reader (SPEC 1.1): drag the bottom-right corner to change its size,
// as the resize handles of a card on a board. The size saves on release (one undo step).
// - `scale`: screen pixels for each unit of the item (the zoom of a reader). Sizes are in item units.
// - `axis`: "y" in the comment column of a page (the column sets the width).

import { useRef, useState } from "react";

export type Size = { w: number; h: number };
const MIN: Size = { w: 60, h: 28 };

/** The size while the grip is dragged (null: no drag), and the grip. */
export function useSizeGrip({ scale = 1, axis = "both", onEnd }: { scale?: number; axis?: "both" | "y"; onEnd(size: Size): void }) {
  const [live, setLive] = useState<Size | null>(null);
  const start = useRef<{ x: number; y: number; size: Size } | null>(null);
  const end = (size: Size | null) => {
    start.current = null;
    setLive(null);
    if (size !== null) onEnd(size);
  };
  const grip = (
    <span
      className={`size-grip${axis === "y" ? " only-y" : ""}`}
      data-tip={axis === "y" ? "Drag: change the height" : "Drag: change the size"}
      data-tip-end
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const frame = event.currentTarget.parentElement;
        if (frame === null) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        const box = frame.getBoundingClientRect();
        start.current = { x: event.clientX, y: event.clientY, size: { w: box.width / scale, h: box.height / scale } };
      }}
      onPointerMove={(event) => {
        const from = start.current;
        if (from === null) return;
        setLive({
          w: axis === "y" ? from.size.w : Math.max(MIN.w, Math.round(from.size.w + (event.clientX - from.x) / scale)),
          h: Math.max(MIN.h, Math.round(from.size.h + (event.clientY - from.y) / scale)),
        });
      }}
      onPointerUp={() => end(live)}
      onPointerCancel={() => end(null)}
    />
  );
  return { live, grip };
}
