// The "PDF pages" mode of the compare view (SPEC 7.15): each side in its own pane. A PDF side shows its pages with a
// box on each change (on its words); a text side shows its text with the same marks. Click a mark: it is the current change.

import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "../../app/sessionContext";
import type { PlacedText } from "../../web/pdfText";
import { pdfPath } from "../../web/savedPages";
import { pageBoxes, type PageBox, type SideMark } from "./compareText";

type PaneProps = { marks: readonly SideMark[]; current: number; onPick(change: number): void };

/** `flow`: the line breaks of the text are layout (a saved page): they show as spaces. */
export function TextPane({ text, flow, marks, current, onPick }: PaneProps & { text: string; flow: boolean }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const mark of marks) {
    if (mark.start > at) parts.push(text.slice(at, mark.start));
    parts.push(
      <mark key={mark.change} className={`compare-mark ${mark.kind}${mark.change === current ? " current" : ""}`} data-change={mark.change} onClick={() => onPick(mark.change)}>
        {text.slice(mark.start, mark.end)}
      </mark>,
    );
    at = Math.max(at, mark.end);
  }
  if (at < text.length) parts.push(text.slice(at));
  return (
    <div className={`compare-pane text${flow ? " flow" : ""}`} dir="auto">
      {parts}
    </div>
  );
}

/** The pages of a saved PDF, drawn by PDFium (as in the reader; pdf.js without it), with a box on each change. */
export function PdfPane({ itemId, pdf, marks, current, onPick }: PaneProps & { itemId: string; pdf: PlacedText }) {
  const session = useSession();
  const pane = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  // True if the backend draws the pages (PDFium); false: pdf.js draws them here; null: not known yet.
  const [native, setNative] = useState<boolean | null>(null);
  useEffect(() => {
    const element = pane.current;
    if (element === null) return;
    const observer = new ResizeObserver(() => setWidth(Math.max(200, element.clientWidth - 24)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let stale = false;
    const url = session.pdfPageUrl(itemId, 1, 16);
    if (url === null) setNative(false);
    else
      void fetch(url).then(
        (response) => !stale && setNative(response.ok),
        () => !stale && setNative(false),
      );
    return () => {
      stale = true;
    };
  }, [session, itemId]);
  const byPage = useMemo(() => {
    const map = new Map<number, PageBox[]>();
    for (const box of pageBoxes(pdf.runs, pdf.pages, marks, pdf.text, measureText)) map.set(box.page, [...(map.get(box.page) ?? []), box]);
    return map;
  }, [pdf, marks]);
  // The image width: the pixel width of the pane, in steps of 64 px (a small resize keeps the images).
  const pixels = Math.ceil((width * (window.devicePixelRatio || 1)) / 64) * 64;
  return (
    <div className="compare-pane pdf" ref={pane}>
      {width > 0 &&
        pdf.pages.map((size, index) => (
          <div key={index} className="compare-pdf-page" style={{ aspectRatio: `${size.width} / ${size.height}` }}>
            {native === true && <img src={session.pdfPageUrl(itemId, index + 1, pixels) ?? ""} loading="lazy" decoding="async" draggable={false} alt="" />}
            {native === false && <CanvasPage itemId={itemId} page={index + 1} width={width} />}
            <span className="compare-page-number">{index + 1}</span>
            {byPage.get(index + 1)?.map((box, part) => (
              <span
                key={part}
                className={`compare-box ${box.kind}${box.width === 0 ? " place" : ""}${box.change === current ? " current" : ""}`}
                data-change={box.change}
                onClick={() => onPick(box.change)}
                style={{ left: `${box.left * 100}%`, top: `${box.top * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }}
              />
            ))}
          </div>
        ))}
    </div>
  );
}

/** The width of a text in a font family (a canvas measures it). The glyphs of the PDF font are near enough. */
let measurer: CanvasRenderingContext2D | null = null;
function measureText(text: string, font: string): number {
  measurer ??= document.createElement("canvas").getContext("2d");
  if (measurer === null) return text.length;
  measurer.font = `100px ${font}`;
  return measurer.measureText(text).width;
}

/** Without PDFium: pdf.js draws one page when it comes near the view. */
function CanvasPage({ itemId, page, width }: { itemId: string; page: number; width: number }) {
  const session = useSession();
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (element === null) return;
    let stale = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        void (async () => {
          const data = await session.readWebBytes(pdfPath(itemId));
          const { openPdfPages } = await import("../../web/pdfText");
          const pages = await openPdfPages(data);
          if (!stale) await pages.draw(page, element, width);
          pages.close();
        })().catch(() => undefined);
      },
      { rootMargin: "100% 0px" },
    );
    observer.observe(element);
    return () => {
      stale = true;
      observer.disconnect();
    };
  }, [session, itemId, page, width]);
  return <canvas ref={canvas} />;
}
