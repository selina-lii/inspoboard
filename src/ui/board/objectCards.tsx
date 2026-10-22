// The object cards on a board (docs/SPEC.md section 7.2): comment, link object (URL), action item, flashcard, quote,
// and group shape. CardNode (nodes.tsx) picks one by the view of the card. The media card is in mediaCard.tsx.

import {
  Check,
  CheckCheck,
  File as FileIcon,
  Globe,
  Link2,
  MessageSquare,
  Minimize2,
  PenLine,
  Reply,
} from "lucide-react";
import { useState, type CSSProperties, type SVGProps } from "react";
import { FlashFace, QuoteFace, shortTime } from "../app/smallFace";
import { isComposing } from "../app/keys";
import { type BoardNode } from "./boardModel";
import { fileNameOfPath, isLocalPath } from "../web/savedPages";
import { useAnnotated } from "../web/annotatedPages";
import { useSession } from "../app/sessionContext";
import { useFieldForm } from "./fieldForm";
import { isCollapsed, isFullLink, linkLabel, type InlineEdit, useBoardCallbacks, HiddenHandle, Resizer, TitleInput, BodyInput } from "./nodes";

export type ObjectProps = { id: string; node: BoardNode; selected: boolean; editing: InlineEdit; title: string; text: string; className: string;
  /** The card color (background, edge, and text), or undefined for the color of the card kind. */
  style?: CSSProperties };

/** A short date and time for a comment. */
/** A comment: dark, with electric pink text and a signature. Double-click to write. Replies show under it. */
export function CommentCard({ id, node, selected, editing, text, className, style }: ObjectProps) {
  const callbacks = useBoardCallbacks();
  const [replying, setReplying] = useState(false);
  return (
    <div className={className} style={style} onDoubleClick={(event) => (event.stopPropagation(), !callbacks.readOnly && callbacks.onStartEdit(id, "body"))}>
      <Resizer node={node} selected={selected} />
      <HiddenHandle />
      <div className="comment-head">
        <MessageSquare size={12} />
        <span className="comment-author">{node.author !== "" ? node.author : "Comment"}</span>
        <span className="comment-time">{shortTime(node.created)}</span>
        {!callbacks.readOnly && (
          <span className="comment-actions card-hover-only">
            <button className="card-icon nodrag" data-tip="Reply" onClick={(event) => (event.stopPropagation(), setReplying(true))}>
              <Reply size={12} />
            </button>
            <button className="card-icon nodrag" data-tip="Resolve: hide the thread (it stays)" data-tip-end onClick={(event) => (event.stopPropagation(), callbacks.onResolve(node.recordId))}>
              <CheckCheck size={12} />
            </button>
          </span>
        )}
      </div>
      <div className="comment-thread nowheel">
        {node.quote !== "" && <div className="comment-quote" dir="auto">“{node.quote}”</div>}
        {editing === "body" ? <BodyInput node={node} /> : <div className="card-text comment-text" data-item-id={node.recordId} dir="auto">{text !== "" ? text : <span className="untitled">Double-click to write a comment</span>}</div>}
        {node.replies.map((reply) => (
          <div key={reply.id} className="comment-reply" dir="auto">
            <span className="comment-author">{reply.author !== "" ? reply.author : "Reply"}</span> {reply.text}
          </div>
        ))}
        {replying && (
          <ReplyInput
            onDone={(value) => {
              setReplying(false);
              if (value.trim() !== "") callbacks.onReply(node.recordId, value.trim());
            }}
          />
        )}
      </div>
    </div>
  );
}

/** A reply field: Enter saves, Shift+Enter is a new line, Escape cancels. */
export function ReplyInput({ onDone }: { onDone(text: string): void }) {
  const [draft, setDraft] = useState("");
  return (
    <textarea
      className="comment-reply-input nodrag nopan nowheel"
      autoFocus
      rows={2}
      value={draft}
      placeholder="Reply… (Enter saves)"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onDone(draft)}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (isComposing(event)) return;
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          onDone(draft);
        }
        if (event.key === "Escape") onDone("");
      }}
    />
  );
}

/**
 * A link object: only its name (like a collapsed note). Double-click opens it: a web page, a local PDF (in the reader),
 * or another local file (in Finder). Its buttons (or the menu) edit the name and the address together.
 */
export function WebLinkCard({ node, selected, editing, title, className, style }: ObjectProps) {
  const callbacks = useBoardCallbacks();
  const local = isLocalPath(node.url);
  // A saved page with notes: the card is solid blue, and a double-click opens the saved copy.
  const annotated = useAnnotated(useSession(), node.recordId, node.url);
  const Icon = local ? FileIcon : Globe;
  if (editing === "title" || editing === "url") {
    return (
      <div className={`${className} editing-link`} style={style}>
        <HiddenHandle />
        <LinkFields node={node} focus={editing} />
      </div>
    );
  }
  return (
    <div className={`${className}${annotated ? " weblink-annotated" : ""}${isFullLink(node) ? " link-full" : ""}`} style={style} data-tip={node.url !== "" ? (annotated ? `${node.url} · saved copy with your notes` : node.url) : undefined}>
      <Resizer node={node} selected={selected} />
      <HiddenHandle />
      <div className="card-title">
        <Icon size={13} className="weblink-icon" />
        <span className={title === "" && node.url === "" ? "card-name untitled" : "card-name"} dir="auto">{title !== "" ? title : node.url === "" ? "New link" : local ? fileNameOfPath(node.url) : linkLabel(node.url, !isFullLink(node))}</span>
        {!callbacks.readOnly && editing === null && (
          <>
            <button className="card-icon card-hover-only nodrag" data-tip="Edit the name" onClick={(event) => (event.stopPropagation(), callbacks.onStartEdit(node.id, "title"))}>
              <PenLine size={12} />
            </button>
            <button className="card-icon card-hover-only nodrag" data-tip="Edit the URL" data-tip-end onClick={(event) => (event.stopPropagation(), callbacks.onStartEdit(node.id, "url"))}>
              <Link2 size={12} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The name and the address of a link object, in one form. Enter (in either field) saves both; Escape cancels.
 * If the form goes away without Enter or Escape, it saves (as the name field of other cards does).
 */
function LinkFields({ node, focus }: { node: BoardNode; focus: "title" | "url" }) {
  const callbacks = useBoardCallbacks();
  const [name, setName] = useState(node.title);
  const [url, setUrl] = useState(node.url);
  const { onKeyDown } = useFieldForm(() => {
    if (name.trim() !== node.title) callbacks.onRename(node.recordId, name.trim());
    if (url.trim() !== node.url) callbacks.onSetUrl(node.recordId, url.trim());
  }, callbacks.onEndEdit);
  return (
    <div className="link-fields nodrag nopan" onDoubleClick={(event) => event.stopPropagation()}>
      <label>
        <span>Name</span>
        <input className="card-title-input" autoFocus={focus === "title"} dir="auto" value={name} placeholder="Name (optional)" onChange={(event) => setName(event.target.value)} onKeyDown={onKeyDown} />
      </label>
      <label>
        <span>Link</span>
        <input className="card-title-input" data-file-drop autoFocus={focus === "url"} value={url} spellCheck={false} placeholder="https://…, or a file path: ~/Documents/file.pdf" onChange={(event) => setUrl(event.target.value)} onKeyDown={onKeyDown} />
      </label>
      <div className="link-fields-hint">Enter saves · Esc cancels · a PDF opens in the app, other files show in Finder</div>
    </div>
  );
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** An action item: half-transparent fluorescent film. "Done" removes it. Double-click to write. */
export function TodoCard({ id, node, selected, editing, text, className }: ObjectProps) {
  const callbacks = useBoardCallbacks();
  const color = node.color ?? "#f4ff3a";
  // Folded: one line of text, no Done button. While it is edited, it opens.
  const folded = isCollapsed(node) && editing !== "body";
  return (
    <div
      className={`${className}${editing === "body" ? " todo-editing" : ""}${folded ? " todo-folded" : ""}`}
      style={{ background: `${color}8c`, borderColor: color }}
      onDoubleClick={(event) => (event.stopPropagation(), !callbacks.readOnly && callbacks.onStartEdit(id, "body"))}
    >
      <Resizer node={node} selected={selected} />
      <HiddenHandle />
      {!callbacks.readOnly && !folded && (
        <button className="todo-done card-hover-only nodrag" data-tip="Done: remove it (undo brings it back)" data-tip-end onClick={(event) => (event.stopPropagation(), callbacks.onDone(node.recordId))}>
          <Check size={13} />
        </button>
      )}
      {editing === "body" ? (
        <BodyInput node={node} />
      ) : (
        <div className="card-text todo-text" data-item-id={node.recordId} dir="auto">
          {text !== "" ? (folded ? text.split("\n").find((line) => line.trim() !== "")?.trim() ?? "" : text) : <span className="untitled">To do…</span>}
        </div>
      )}
    </div>
  );
}

/** A flashcard: the name is the front, the text is the back. Double-click flips it. The pencil (top right) edits the side that shows. */
export function FlashCard({ node, selected, editing, title, text, className, style }: ObjectProps) {
  const [flipped, setBack] = useState(false);
  // An edit shows its side: the front (name) or the back (text). Edit from the right-click menu.
  const back = editing === "body" || (editing !== "title" && flipped);
  return (
    <div className={`${className}${back ? " flipped" : ""}`} style={style} onDoubleClick={(event) => (event.stopPropagation(), editing === null && setBack((current) => !current))}>
      <Resizer node={node} selected={selected} />
      <HiddenHandle />
      <FlashFace
        back={back}
        front={title}
        backText={text}
        sideClass="flash-side-label"
        faceClass="flash-face"
        editor={back && editing === "body" ? <BodyInput node={node} /> : !back && editing === "title" ? <TitleInput node={node} placeholder="Front" /> : undefined}
      />
    </div>
  );
}

/** The first words of a quote for its folded bubble: two words, or two characters of CJK text. */
export function quoteStart(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat === "") return "";
  if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(flat)) {
    const characters = [...flat];
    return characters.slice(0, 2).join("") + (characters.length > 2 ? "…" : "");
  }
  const words = flat.split(" ");
  return words.slice(0, 2).join(" ") + (words.length > 2 ? "…" : "");
}

/**
 * A quote: a passage on newsprint paper, framed by quotation marks. The name is its source (it can be empty).
 * Double-click writes the text (like a note; the board does it). Its width and height change by hand (a long text scrolls).
 * Folded, it is a small gray speech bubble with the first two words. Double-click unfolds it, ready for typing.
 */
export function QuoteCard({ id, node, selected, editing, title, text, className, style }: ObjectProps) {
  const callbacks = useBoardCallbacks();
  const folded = isCollapsed(node) && editing === null;
  if (folded) {
    return (
      <div
        className={`${className} quote-bubble`}
        style={style}
        data-tip={text !== "" ? text.slice(0, 200) : undefined}
      >
        <HiddenHandle />
        <span className="card-text quote-bubble-text" data-item-id={node.recordId} dir="auto">
          {quoteStart(text) || <span className="untitled">Quote</span>}
        </span>
      </div>
    );
  }
  return (
    <div className={`${className} quote-marks-${node.marks}`} style={style}>
      <Resizer node={node} selected={selected} />
      <HiddenHandle />
      <QuoteFace
        marks={node.marks}
        text={text}
        source={title}
        textClass="card-text"
        itemId={node.recordId}
        editor={editing === "body" ? <BodyInput node={node} /> : undefined}
        sourceEditor={editing === "title" ? <TitleInput node={node} placeholder="Source (optional)" /> : undefined}
      >
        {!callbacks.readOnly && node.placeId !== null && editing === null && (
          <button className="card-icon card-hover-only quote-fold nodrag" data-tip="Fold into a bubble" data-tip-end onClick={(event) => (event.stopPropagation(), callbacks.onToggleExpanded(node.placeId!, false))}>
            <Minimize2 size={11} />
          </button>
        )}
      </QuoteFace>
    </div>
  );
}

/** Scribbles that a note holds. They move with the card and the card clips them. */
/**
 * A group card: a loose area of the board (rounded rectangle, ellipse, or free shape) with a name at its top left.
 * Only its edge and its name take the pointer: a click inside the shape goes to the board or to the cards in it.
 * Drag the name or the edge to move the group with its cards. Double-click the name to rename it.
 */
export function GroupShapeCard({ id, node, selected, editing, title, className }: ObjectProps) {
  const callbacks = useBoardCallbacks();
  const color = node.color ?? "var(--group-shape)";
  const w = Math.max(node.w, 1);
  const h = Math.max(node.h, 1);
  // Outline: a dashed edge only. Filled: the color fills the area, and the edge is solid.
  const look = node.filled
    ? { fill: color, fillOpacity: 0.18, stroke: color, strokeOpacity: 0.8, strokeWidth: 1.5 }
    : { fill: "none", stroke: color, strokeOpacity: 0.85, strokeWidth: 1.75, strokeDasharray: "7 5" };
  // The visible edge, and a wide clear edge on it that takes the pointer (to move the group).
  const hit = { fill: "none", stroke: "transparent", strokeWidth: 12, className: "group-shape-hit" };
  const outline = (props: SVGProps<SVGElement>) =>
    node.shape === "blob" && node.shapePath !== "" ? (
      <path d={node.shapePath} vectorEffect="non-scaling-stroke" {...(props as SVGProps<SVGPathElement>)} />
    ) : node.shape === "ellipse" ? (
      <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - 1} ry={h / 2 - 1} vectorEffect="non-scaling-stroke" {...(props as SVGProps<SVGEllipseElement>)} />
    ) : (
      <rect x={1} y={1} width={w - 2} height={h - 2} rx={18} vectorEffect="non-scaling-stroke" {...(props as SVGProps<SVGRectElement>)} />
    );
  return (
    <div className={`${className} group-shape shape-${node.shape}`}>
      <Resizer node={node} selected={selected} />
      <svg className="group-shape-svg" viewBox={`0 0 ${node.shape === "blob" ? 100 : w} ${node.shape === "blob" ? 100 : h}`} preserveAspectRatio="none" aria-hidden>
        {outline({ ...look, className: "group-shape-edge" })}
        {outline(hit)}
      </svg>
      <HiddenHandle />
      <div
        className="group-shape-name"
        style={node.color === null ? undefined : { color: node.color }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          if (!callbacks.readOnly) callbacks.onStartEdit(id, "title");
        }}
      >
        {editing === "title" ? <TitleInput node={node} placeholder="Group" /> : title !== "" ? <span dir="auto">{title}</span> : <span className="untitled">Group</span>}
      </div>
    </div>
  );
}
