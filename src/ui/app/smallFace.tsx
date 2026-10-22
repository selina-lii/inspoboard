// The small items (SPEC 1.1) look and act the same on a board, in a page, and in a reader canvas (a saved web page or a
// PDF). This module holds the parts that they share:
// - QuoteFace: newsprint paper with quotation marks; the name is its source.
// - FlashFace: the side label ("Front" / "Back") and the side that shows; the name is the front, the text the back.
// - SmallHead: the head of a small item in a page or a reader: kind icon, name, and the buttons (stop pointing, Done,
//   Delete). The host gives the frame (move, size, the place).
// - SmallFace: the body of a small item in a page or a reader (each kind as its card on a board).
// - shortTime: the time of a comment.
// The board gives its own frame (resize handles, inline edits by commands) around QuoteFace and FlashFace.

import { useState, type ReactNode } from "react";
import { Check, Layers, PenLine, Trash2, Unlink } from "lucide-react";
import { defaultQuoteMarks } from "../../core/actions";
import type { Id, ItemRecord, QuoteMarks, ViewStyle } from "../../core/types";
import { uiLocale } from "../i18n/i18n";
import { kindIcon } from "../tools/registry";
import { ColorSelect } from "./ColorSelect";
import { textColorOn } from "./vaultImages";

/** The quotation marks of a quote: opening and closing glyph, and a tip for the menu. */
export const QUOTE_GLYPHS: Record<QuoteMarks, { open: string; close: string; tip: string }> = {
  en: { open: "‘", close: "’", tip: "English" },
  cjk: { open: "「", close: "」", tip: "Traditional Chinese, Japanese" },
  zh: { open: "“", close: "”", tip: "Chinese" },
  es: { open: "«", close: "»", tip: "Spanish, French" },
  none: { open: "", close: "", tip: "No marks" },
};

/** The time of a comment: month, day, and time, in the UI language. Empty for a time that cannot be read. */
export function shortTime(time: string): string {
  const date = new Date(time);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(uiLocale(), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

type QuoteFaceProps = {
  marks: QuoteMarks;
  text: string;
  source: string;
  textClass: string;
  /** The item of the text (for drags to the link bench). */
  itemId?: Id;
  /** In place of the text or the source while they are edited. */
  editor?: ReactNode;
  sourceEditor?: ReactNode;
  onTextDoubleClick?(): void;
  /** Host buttons (for example "Fold into a bubble"), after the opening mark. */
  children?: ReactNode;
};

/** The inside of a quote: its marks, its text, and its source. The host gives the frame (class `quote-marks-<marks>`). */
export function QuoteFace({ marks, text, source, textClass, itemId, editor, sourceEditor, onTextDoubleClick, children }: QuoteFaceProps) {
  const glyph = QUOTE_GLYPHS[marks];
  return (
    <>
      {marks !== "none" && (
        <span className="quote-mark open" aria-hidden>
          {glyph.open}
        </span>
      )}
      {children}
      {editor ?? (
        <div className={`${textClass} quote-text`} data-item-id={itemId} dir="auto" onDoubleClick={onTextDoubleClick}>
          {text !== "" ? text : <span className="untitled">Double-click to write a quote</span>}
        </div>
      )}
      {sourceEditor ??
        (source !== "" && (
          <div className="quote-source" dir="auto">
            — {source}
          </div>
        ))}
      {marks !== "none" && (
        <span className="quote-mark close" aria-hidden>
          {glyph.close}
        </span>
      )}
    </>
  );
}

type FlashFaceProps = {
  back: boolean;
  front: string;
  backText: string;
  sideClass: string;
  faceClass: string;
  /** In place of the side that shows while it is edited. */
  editor?: ReactNode;
  /** Host buttons (for example the pencil), after the side label. */
  children?: ReactNode;
};

/** The inside of a flashcard: the side label and the side that shows. The host flips it (double-click). */
export function FlashFace({ back, front, backText, sideClass, faceClass, editor, children }: FlashFaceProps) {
  return (
    <>
      <span className={sideClass}>
        <Layers size={10} /> {back ? "Back" : "Front"}
      </span>
      {children}
      <div className={faceClass} key={back ? "back" : "front"} dir="auto">
        {editor ?? (back ? backText || <span className="untitled">Back</span> : front || <span className="untitled">Front</span>)}
      </div>
    </>
  );
}

/** Whether the head shows the name (a quote and a flashcard show it in their face). */
export const nameInHead = (view: ViewStyle) => view !== "quote" && view !== "flashcard";

type SmallHeadProps = {
  view: ViewStyle;
  item: ItemRecord;
  readOnly: boolean;
  onDelete(): void;
  /** An action item: "Done" removes it. */
  onDone?: () => void;
  /** Only for an item that points to text: ends the pointing (its dashed curve). */
  onUnpoint?: () => void;
  /** The own color of the item in its home (null: the color of its kind), and the change of it. */
  color?: string | null;
  onColor?: (color: string | null) => void;
  /** In place of the name (for example the signature and the time of a comment). */
  label?: ReactNode;
  /** Host parts after the name (for example the web address button of a reader). */
  children?: ReactNode;
};

/**
 * The style of a small item with its own color in a page or a reader: the color fills it (as a card on a board), and
 * the text color follows for contrast. Notes and action items use the color as their stripe or film (CSS).
 */
export function smallColorStyle(color: string | null, stripe: string | null = color): React.CSSProperties {
  return color === null ? {} : ({ "--small-color": stripe ?? color, "--small-fill": color, "--small-text": textColorOn(color) } as React.CSSProperties);
}

/**
 * The head of a small item in a page or a reader: its kind icon, its name (not for a quote or a flashcard: their face
 * shows it), and its buttons. Stop pointing and Delete show on hover (the frame has the class `small-item`).
 */
export function SmallHead({ view, item, readOnly, onDelete, onDone, onUnpoint, color = null, onColor, label, children }: SmallHeadProps) {
  const Icon = kindIcon(view);
  return (
    <>
      <Icon size={11} />
      {label ?? (item.name !== "" && nameInHead(view) ? (
        <span className="small-head-name" dir="auto" translate="no">
          {item.name}
        </span>
      ) : (
        <span className="small-head-grip" />
      ))}
      {children}
      {!readOnly && onColor !== undefined && <ColorSelect value={color} label="Color" defaultLabel="Color of the card kind" buttonClass="icon-button small small-head-hover" iconSize={12} onChange={onColor} />}
      {!readOnly && onUnpoint !== undefined && (
        <button className="icon-button small small-head-hover" data-tip="Stop pointing to the text (the curve goes)" onClick={onUnpoint}>
          <Unlink size={12} />
        </button>
      )}
      {!readOnly && view === "todo" && onDone !== undefined && (
        <button className="icon-button small" data-tip="Done (removes the action item)" onClick={onDone}>
          <Check size={12} />
        </button>
      )}
      {!readOnly && (
        <button className="icon-button small small-head-hover" data-tip="Delete" data-tip-end onClick={onDelete}>
          <Trash2 size={12} />
        </button>
      )}
    </>
  );
}

type SmallFaceProps = {
  view: ViewStyle;
  item: ItemRecord;
  body: string;
  editing: boolean;
  readOnly: boolean;
  onEdit(on: boolean): void;
  onWrite(text: string): void;
  onRename(name: string): void;
  /** Class names of the text and of the input (of the page or of the reader). */
  textClass: string;
  inputClass: string;
  placeholder?: string;
};

/** The body of a small item in a page or a reader. The frame (head, buttons, move) stays with the page or the reader. */
export function SmallFace({ view, item, body, editing, readOnly, onEdit, onWrite, onRename, textClass, inputClass, placeholder }: SmallFaceProps) {
  const [back, setBack] = useState(false);
  const textInput = (
    <textarea
      autoFocus
      className={inputClass}
      defaultValue={body}
      placeholder={placeholder ?? "Write…"}
      onChange={(event) => onWrite(event.target.value)}
      onBlur={() => onEdit(false)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") event.currentTarget.blur();
      }}
    />
  );
  if (view === "flashcard") {
    const frontInput = (
      <input
        autoFocus
        className={inputClass}
        defaultValue={item.name}
        placeholder="Front"
        onBlur={(event) => (onRename(event.target.value), onEdit(false))}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
        }}
      />
    );
    return (
      <div className="small-flash" onDoubleClick={() => !editing && setBack((current) => !current)}>
        <FlashFace back={back} front={item.name} backText={body} sideClass="small-flash-side" faceClass="small-flash-face" editor={editing ? (back ? textInput : frontInput) : undefined}>
          {!readOnly && !editing && (
            <button className="icon-button small small-flash-edit" data-tip={back ? "Write the back" : "Write the front"} data-tip-end onClick={() => onEdit(true)}>
              <PenLine size={11} />
            </button>
          )}
        </FlashFace>
      </div>
    );
  }
  if (view === "quote") {
    const marks = defaultQuoteMarks(body);
    return (
      <div className={`small-quote quote-marks-${marks}`}>
        <QuoteFace marks={marks} text={body} source={item.name} textClass={textClass} editor={editing ? textInput : undefined} onTextDoubleClick={() => !readOnly && onEdit(true)} />
      </div>
    );
  }
  return editing ? (
    textInput
  ) : (
    <div className={textClass} dir="auto" onDoubleClick={() => !readOnly && onEdit(true)}>
      {body !== "" ? body : <span className="untitled">{view === "todo" ? "To do…" : "Double-click to write"}</span>}
    </div>
  );
}
