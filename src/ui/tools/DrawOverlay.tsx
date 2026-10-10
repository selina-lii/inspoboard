// Overlay for freehand input: the lasso and the scribble tools.
// It collects points in screen space and gives them to `onDone` in board space.

import { useRef, useState, type PointerEvent } from "react";
import type { Point } from "./stroke";

type Props = {
  mode: "lasso" | "scribble" | "erase";
  toBoard: (screen: Point) => Point;
  onDone: (points: Point[]) => void;
};

export function DrawOverlay({ mode, toBoard, onDone }: Props) {
  const [screenPoints, setScreenPoints] = useState<Point[]>([]);
  const drawing = useRef(false);
  const boardPoints = useRef<Point[]>([]);
  const origin = useRef<DOMRect | null>(null);

  const local = (event: PointerEvent): Point => {
    const box = origin.current!;
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const start = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    origin.current = event.currentTarget.getBoundingClientRect();
    drawing.current = true;
    boardPoints.current = [toBoard({ x: event.clientX, y: event.clientY })];
    setScreenPoints([local(event)]);
  };

  const move = (event: PointerEvent<SVGSVGElement>) => {
    if (!drawing.current) return;
    boardPoints.current.push(toBoard({ x: event.clientX, y: event.clientY }));
    const point = local(event);
    setScreenPoints((points) => [...points, point]);
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const points = boardPoints.current;
    boardPoints.current = [];
    setScreenPoints([]);
    onDone(points);
  };

  const path = screenPoints.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`).join("");
  return (
    <svg
      className={`draw-overlay ${mode}`}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {path !== "" && <path d={mode === "lasso" ? `${path}Z` : path} />}
    </svg>
  );
}
