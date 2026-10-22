// A box of text at a fixed place on the reader canvas (page units): a translation of a paragraph, or the words of a
// formula. The place comes from the page (level with what it is about); it never moves to make room. Thus boxes can
// overlap: a press on a box brings it to the front (useFront).
// - The text gets smaller until it fits the box (down to SMALLEST of its first size), then it scrolls in the box.

import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";

/** The smallest text of a box, relative to its first size. */
export const SMALLEST = 0.55;

/** The box in front (the last one pressed) of a group of boxes. */
export function useFront(): { front: string | null; bringToFront(key: string): void } {
  const [front, setFront] = useState<string | null>(null);
  const bringToFront = useCallback((key: string) => setFront(key), []);
  return { front, bringToFront };
}

type Props = {
  className: string;
  top: number;
  left: number;
  width: number;
  height: number;
  fontSize: number;
  /** A change of the text (or a part of it): the box fits it again. */
  fitKey: string;
  inFront: boolean;
  onFront(): void;
  frameRef?: RefObject<HTMLDivElement | null>;
  style?: CSSProperties;
  tip?: string;
  dir?: "auto" | "ltr";
  children: ReactNode;
};

export function PlacedBox({ className, top, left, width, height, fontSize, fitKey, inFront, onFront, frameRef, style, tip, dir = "auto", children }: Props) {
  const own = useRef<HTMLDivElement>(null);
  const frame = frameRef ?? own;
  const [size, setSize] = useState(fontSize);
  useLayoutEffect(() => {
    const element = frame.current;
    if (element === null) return;
    // The largest size that fits (a binary search of some steps).
    let low = fontSize * SMALLEST;
    let high = fontSize;
    element.style.fontSize = `${high}px`;
    if (element.scrollHeight <= element.clientHeight + 1) {
      setSize(high);
      return;
    }
    for (let step = 0; step < 6; step += 1) {
      const middle = (low + high) / 2;
      element.style.fontSize = `${middle}px`;
      if (element.scrollHeight <= element.clientHeight + 1) low = middle;
      else high = middle;
    }
    element.style.fontSize = `${low}px`;
    setSize(low);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, width, height, fontSize]);
  return (
    <div
      ref={frame}
      className={`${className}${inFront ? " in-front" : ""}`}
      style={{ ...style, top, left, width, height, fontSize: size }}
      data-tip={tip}
      dir={dir}
      onPointerDown={onFront}
    >
      {children}
    </div>
  );
}
