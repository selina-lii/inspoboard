// The body of an open item, in an editor window or on the text page.
// - No plugin result: the editor. While it is read aloud: the text with the spoken sentence marked.
// - A plugin result (for example a translation): in place of the text, or side by side (the text at the left).
//   Side by side, the two sides are paragraph-aligned by content (length, kind, numbers): each result paragraph starts level with its paragraph in the text
//   (space goes after the shorter one), and both sides scroll as one. The text at the left stays editable.
// - Read aloud with a result: the side that is read marks the sentence. The other side marks the matching line.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import type { Id } from "../../core/types";
import { TRANSFORM_SPLIT_RANGE } from "../../io/settings";
import { useSession, useSessionState } from "../app/sessionContext";
import { TextEditor, type TextEditorApi } from "../editor/TextEditor";
import { useOverlay } from "../plugins/pluginsContext";
import { lineAt, lineStart, matchingLine } from "../plugins/reading";
import { useSpeech, useSpokenSentence, type Spoken } from "../plugins/speech";
import { LineMarkedText, SpokenText } from "../plugins/SpeechBar";
import { TransformedText } from "../plugins/TransformedText";
import { alignBlocks, paragraphBlocks } from "../plugins/paragraphs";
import { linesHeight, setSpacers, spacerField, type Spacer } from "../editor/spacers";

type Props = {
  itemId: Id;
  readOnly: boolean;
  editorRef: MutableRefObject<TextEditorApi | null>;
  autoFocus?: boolean;
};

export function ItemBody({ itemId, readOnly, editorRef, autoFocus }: Props) {
  const session = useSession();
  const { settings } = useSessionState();
  const overlay = useOverlay(itemId);
  const spoken = useSpokenSentence(itemId);
  const original = session.store.get("texts", itemId)?.body ?? "";
  const result = overlay?.body ?? original;

  const originalView =
    spoken?.side === "original" ? (
      <SpokenText text={spoken.text} sentence={spoken.sentence} />
    ) : spoken?.side === "result" ? (
      <Counterpart text={original} spoken={spoken} />
    ) : (
      <TextEditor key={itemId} itemId={itemId} readOnly={readOnly} apiRef={editorRef} autoFocus={autoFocus} />
    );
  if (overlay === undefined) return originalView;

  const resultView =
    spoken?.side === "result" ? (
      <SpokenText text={spoken.text} sentence={spoken.sentence} />
    ) : spoken?.side === "original" ? (
      <Counterpart text={result} spoken={spoken} />
    ) : (
      <TransformedText overlay={overlay} original={original} />
    );
  if (settings.transformLayout !== "side") return resultView;
  // While it reads aloud, the sides show the spoken marks (not aligned).
  if (spoken === null) {
    return (
      <AlignedSplit
        title={overlay.title !== null && settings.showItemTitle ? overlay.title : null}
        original={original}
        result={result}
        editor={(onLayout) => <TextEditor key={itemId} itemId={itemId} readOnly={readOnly} apiRef={editorRef} autoFocus={autoFocus} onLayout={onLayout} />}
        editorRef={editorRef}
      />
    );
  }
  return (
    <SplitView>
      {originalView}
      <>
        {overlay.title !== null && settings.showItemTitle && (
          <div className="split-title" dir="auto">
            {overlay.title}
          </div>
        )}
        {resultView}
      </>
    </SplitView>
  );
}

/** The text that is not read: the line that matches the spoken sentence is marked. A click on a line reads from there. */
function Counterpart({ text, spoken }: { text: string; spoken: Spoken }) {
  const speech = useSpeech();
  const lines = text.split("\n").length;
  const spokenLines = spoken.text.split("\n").length;
  const line = matchingLine(lineAt(spoken.text, spoken.sentence.start), spokenLines, lines);
  return (
    <LineMarkedText
      text={text}
      line={line}
      onLine={(clicked) => speech?.clickSeek(lineStart(spoken.text, matchingLine(clicked, lines, spokenLines)))}
    />
  );
}

type AlignedProps = {
  title: string | null;
  original: string;
  result: string;
  editor(onLayout: () => void): ReactNode;
  editorRef: MutableRefObject<TextEditorApi | null>;
};

/**
 * The text (editor) at the left and the result at the right, paragraph-aligned, in one scroll area.
 * After each row of paired paragraphs, the shorter side gets space: the next row starts level on both sides.
 */
function AlignedSplit({ title, original, result, editor, editorRef }: AlignedProps) {
  const right = useRef<HTMLDivElement>(null);
  const [rightTop, setRightTop] = useState(0);
  const [rightPads, setRightPads] = useState<number[]>([]);
  const frame = useRef(0);
  /** The last alignments (spaces as text). If a new one is the one before the last, the layout swings: it stops. */
  const recent = useRef<string[]>([]);
  const leftBlocks = paragraphBlocks(original);
  const rightBlocks = paragraphBlocks(result);
  // The rows by content: each result paragraph goes level with the paragraph that it translates.
  const rows = useMemo(
    () => alignBlocks(leftBlocks.map((block) => original.slice(block.from, block.to)), rightBlocks.map((block) => result.slice(block.from, block.to))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [original, result],
  );
  const latest = useRef({ leftBlocks, rightBlocks, original, rows });
  latest.current = { leftBlocks, rightBlocks, original, rows };

  const align = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const view = editorRef.current?.view();
      const column = right.current;
      if (view === null || view === undefined || column === null) return;
      const { leftBlocks: lefts, rightBlocks: rights, original: text, rows } = latest.current;
      if (view.state.doc.length !== text.length) return;
      const doc = view.state.doc;
      // Left heights: the lines of each block (without the spaces). Right heights: each block element without its padding.
      const leftHeights = lefts.map((block) => linesHeight(view, block.from, Math.max(block.from, block.to - (block.to > block.from && text[block.to - 1] === "\n" ? 1 : 0))));
      const elements = [...column.querySelectorAll<HTMLElement>(":scope > .aligned-block > .aligned-text")];
      if (elements.length !== rights.length) return;
      const rightHeights = elements.map((element) => element.getBoundingClientRect().height);
      const spacers: Spacer[] = [];
      const pads = rights.map(() => 0);
      // The last row gets no space: nothing after it must start level. A space at the very end would only change
      // the scroll height, and the last paragraph would jump.
      for (const row of rows.slice(0, -1)) {
        const leftHeight = leftHeights.slice(row.left[0], row.left[1]).reduce((sum, height) => sum + height, 0);
        const rightHeight = rightHeights.slice(row.right[0], row.right[1]).reduce((sum, height) => sum + height, 0);
        const height = Math.max(leftHeight, rightHeight);
        const lastLeft = lefts[row.left[1] - 1]!;
        const end = Math.max(lastLeft.from, lastLeft.to - (text[lastLeft.to - 1] === "\n" ? 1 : 0));
        spacers.push({ pos: doc.lineAt(end).to, height: height - leftHeight });
        if (row.right[1] > row.right[0]) pads[row.right[1] - 1] = height - rightHeight;
      }
      // A swing (A, B, A, …): keep the current alignment. A new text or a new width starts again.
      const key = `${Math.round(column.getBoundingClientRect().width)}|${spacers.map((spacer) => `${spacer.pos}:${Math.round(spacer.height)}`).join(",")}|${pads.map(Math.round).join(",")}`;
      const history = recent.current;
      if (history.length >= 2 && history[history.length - 2] === key && history[history.length - 1] !== key) return;
      recent.current = [...history.slice(-3), key];
      const current = view.state.field(spacerField, false);
      if (!sameSpacers(current, spacers)) view.dispatch({ effects: setSpacers.of(spacers) });
      setRightPads((before) => (before.length === pads.length && before.every((value, index) => Math.abs(value - pads[index]!) < 0.5) ? before : pads));
      // The first line of the text and of the result start at the same height (the panes do not scroll by themselves).
      const top = view.documentTop - column.parentElement!.getBoundingClientRect().top;
      setRightTop((before) => (Math.abs(before - top) < 0.5 ? before : top));
    });
  }, [editorRef]);

  useLayoutEffect(() => {
    recent.current = [];
    align();
  }, [original, result, align]);
  useEffect(() => {
    const column = right.current;
    if (column === null) return;
    const observer = new ResizeObserver(() => align());
    observer.observe(column);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame.current);
    };
  }, [align]);
  // Without the split, the editor has no spaces.
  useEffect(() => () => editorRef.current?.view()?.dispatch({ effects: setSpacers.of([]) }), [editorRef]);

  return (
    <SplitView aligned title={title}>
      {editor(align)}
      <div ref={right} className="aligned-result" style={{ paddingTop: rightTop }}>
        {rightBlocks.map((block, index) => (
          <div key={index} className="aligned-block" style={{ paddingBottom: rightPads[index] ?? 0 }}>
            <div className="aligned-text" dir="auto">
              {result
                .slice(block.from, block.to)
                .replace(/\n$/, "")
                .split("\n")
                .map((line, lineIndex) => {
                  const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
                  return heading !== null ? (
                    <div key={lineIndex} className={`aligned-line md-h${Math.min(4, heading[1]!.length)}`}>
                      {heading[2]}
                    </div>
                  ) : (
                    <div key={lineIndex} className="aligned-line">
                      {line === "" ? "\u200b" : line}
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </SplitView>
  );
}

function sameSpacers(current: { list: Spacer[] } | undefined, next: Spacer[]): boolean {
  if (current === undefined || current.list.length !== next.length) return false;
  return current.list.every((spacer, index) => spacer.pos === next[index]!.pos && Math.abs(spacer.height - next[index]!.height) < 0.5);
}

/** Two panes with a divider. The divider position is a setting: it stays for all items. */
function SplitView({ children, aligned = false, title = null }: { children: [ReactNode, ReactNode]; aligned?: boolean; title?: string | null }) {
  const session = useSession();
  const saved = useSessionState().settings.transformSplit;
  const [ratio, setRatio] = useState(saved);
  const frame = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  useEffect(() => setRatio(saved), [saved]);
  const ratioAt = (clientX: number) => {
    const rect = frame.current!.getBoundingClientRect();
    return Math.min(TRANSFORM_SPLIT_RANGE.max, Math.max(TRANSFORM_SPLIT_RANGE.min, (clientX - rect.left) / Math.max(1, rect.width)));
  };
  const view = (
    <div className={`split-view${aligned ? " aligned" : ""}`} ref={frame}>
      <div className="split-pane" style={{ flexBasis: `${ratio * 100}%` }}>
        {children[0]}
      </div>
      <div
        className="split-divider"
        role="separator"
        aria-orientation="vertical"
        data-tip="Drag to change the width. Double-click: half and half."
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragging.current = true;
        }}
        onPointerMove={(event) => dragging.current && setRatio(ratioAt(event.clientX))}
        onPointerUp={(event) => {
          if (!dragging.current) return;
          dragging.current = false;
          void session.updateSettings({ transformSplit: ratioAt(event.clientX) });
        }}
        onDoubleClick={() => void session.updateSettings({ transformSplit: 0.5 })}
      />
      <div className="split-pane result">{children[1]}</div>
    </div>
  );
  if (!aligned) return view;
  // Aligned: the result title stays above the scroll area (over the result column).
  return (
    <div className="split-wrap">
      {title !== null && (
        <div className="split-head" style={{ paddingLeft: `calc(${ratio * 100}% + 7px)` }} dir="auto">
          {title}
        </div>
      )}
      {view}
    </div>
  );
}
