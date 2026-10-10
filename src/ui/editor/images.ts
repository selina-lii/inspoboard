// Images in a text. See docs/SPEC.md section 7.5.
// - The text keeps plain Markdown: ![alt](images/<name>). The image file is in `images/` of the vault.
// - The editor shows the image under its Markdown. On a line without the cursor, the Markdown is hidden.
// - A pasted or dropped image file goes into the vault, and its Markdown goes into the text.
// - Only vault images show. The app makes no network request: a web image shows its address only.
// - Size: the alt text can end with "|<width>" (as in Obsidian): ![sky|320](images/sky.png) shows 320 px wide.
//   Drag the handle at the right edge or the bottom-right corner of an image to change it. The image keeps its shape.

import { syntaxTree } from "@codemirror/language";
import { Facet, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";

/** Gives an object URL for a vault image path ("images/<name>"). */
export type ImageSource = (path: string) => Promise<string>;

export const imageSource = Facet.define<ImageSource, ImageSource | null>({ combine: (values) => values[0] ?? null });

/** File types that a text can hold. */
const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

/** The vault path of a Markdown image target, or null if it is not a vault image. */
export function vaultImagePath(target: string): string | null {
  const path = target.trim().replace(/^<|>$/g, "");
  return /^images\/[A-Za-z0-9_.-]+\.(png|jpe?g|gif|webp)$/i.test(path) && !path.slice(7).startsWith(".") ? path : null;
}

/** The Markdown for an image: ![alt](path), or ![alt|width](path) with a width. Brackets in the alt text are removed. */
export function imageMarkdown(path: string, alt = "", width: number | null = null): string {
  const text = alt.replace(/[[\]\n|]/g, " ").trim();
  return `![${width === null ? text : `${text}|${Math.round(width)}`}](${path})`;
}

/** The alt text and the width of an image from its Markdown alt part: "sky|320" -> { alt: "sky", width: 320 }. */
export function imageAlt(raw: string): { alt: string; width: number | null } {
  const match = /^(.*?)\|\s*(\d{1,5})(?:\s*x\s*\d{1,5})?\s*$/.exec(raw);
  if (match === null) return { alt: raw, width: null };
  const width = Number(match[2]);
  return { alt: match[1]!.trim(), width: width > 0 ? width : null };
}

/** The smallest width that a drag gives an image. */
const MIN_IMAGE_WIDTH = 40;

/** A file name with the right extension for a pasted image ("pasted.png"), or null if the type is not an image a text can hold. */
export function pastedImageName(file: { name: string; type: string }): string | null {
  const extension = TYPES[file.type];
  if (extension === undefined) return null;
  const stem = file.name.replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${stem !== "" && stem !== "image" ? stem : "pasted"}.${extension}`;
}

class ImageWidget extends WidgetType {
  constructor(
    readonly path: string | null,
    readonly target: string,
    readonly alt: string,
  ) {
    super();
  }

  override eq(other: ImageWidget): boolean {
    return other.path === this.path && other.target === this.target && other.alt === this.alt;
  }

  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement("span");
    box.className = "cm-md-image";
    const source = view.state.facet(imageSource);
    const { alt, width } = imageAlt(this.alt);
    if (this.path === null || source === null) {
      box.classList.add("missing");
      box.textContent = this.path === null ? `Image from the web (not loaded: the app is offline): ${this.target}` : alt || this.target;
      return box;
    }
    const frame = document.createElement("span");
    frame.className = "cm-md-image-frame";
    const image = document.createElement("img");
    image.alt = alt;
    image.draggable = false;
    if (width !== null) image.style.width = `${width}px`;
    image.onload = () => view.requestMeasure();
    frame.appendChild(image);
    box.appendChild(frame);
    if (!view.state.readOnly) {
      for (const side of ["right", "corner"] as const) {
        const handle = document.createElement("span");
        handle.className = `cm-md-image-handle ${side}`;
        handle.title = "Drag to change the size";
        handle.addEventListener("pointerdown", (event) => this.resize(view, box, image, event));
        frame.appendChild(handle);
      }
    }
    source(this.path).then(
      (url) => {
        image.src = url;
      },
      () => {
        box.classList.add("missing");
        box.textContent = `Image not found: ${this.path}`;
      },
    );
    return box;
  }

  /** A drag on a handle: the image follows; on release its width goes into its Markdown (one change, undo works). */
  private resize(view: EditorView, box: HTMLElement, image: HTMLImageElement, event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = image.getBoundingClientRect().width;
    const maxWidth = Math.max(MIN_IMAGE_WIDTH, view.contentDOM.getBoundingClientRect().width - 8);
    let width = startWidth;
    box.classList.add("resizing");
    const move = (next: PointerEvent) => {
      width = Math.min(maxWidth, Math.max(MIN_IMAGE_WIDTH, startWidth + next.clientX - startX));
      image.style.width = `${Math.round(width)}px`;
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      box.classList.remove("resizing");
      if (Math.abs(width - startWidth) < 2) return;
      const range = imageRangeAt(view, view.posAtDOM(box));
      if (range === null) return;
      const { alt } = imageAlt(range.alt);
      view.dispatch({ changes: { from: range.from, to: range.to, insert: imageMarkdown(range.target, alt, width) } });
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }

  override ignoreEvent(event: Event): boolean {
    // The editor does not handle a drag on a handle (no text selection).
    return event.target instanceof Element && event.target.classList.contains("cm-md-image-handle");
  }
}

/** The Markdown image at (or just before) a position: its range, alt part, and target. */
function imageRangeAt(view: EditorView, pos: number): { from: number; to: number; alt: string; target: string } | null {
  const tree = syntaxTree(view.state);
  type SyntaxNode = ReturnType<typeof tree.resolveInner>;
  for (const at of [pos, pos - 1, pos + 1]) {
    if (at < 0 || at > view.state.doc.length) continue;
    for (let node: SyntaxNode | null = tree.resolveInner(at, 1); node !== null; node = node.parent) {
      if (node.name !== "Image") continue;
      const match = /^!\[([^\]]*)\]\(([^)]*)\)$/.exec(view.state.doc.sliceString(node.from, node.to));
      if (match !== null) return { from: node.from, to: node.to, alt: match[1]!, target: match[2]!.trim() };
    }
    for (let node: SyntaxNode | null = tree.resolveInner(at, -1); node !== null; node = node.parent) {
      if (node.name !== "Image") continue;
      const match = /^!\[([^\]]*)\]\(([^)]*)\)$/.exec(view.state.doc.sliceString(node.from, node.to));
      if (match !== null) return { from: node.from, to: node.to, alt: match[1]!, target: match[2]!.trim() };
    }
  }
  return null;
}

function buildImages(view: EditorView): DecorationSet {
  const { state } = view;
  const active = activeLines(state);
  const ranges: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== "Image") return;
        const text = state.doc.sliceString(node.from, node.to);
        const match = /^!\[([^\]]*)\]\(([^)]*)\)$/.exec(text);
        if (match === null) return;
        const widget = new ImageWidget(vaultImagePath(match[2]!), match[2]!.trim(), match[1]!);
        const line = state.doc.lineAt(node.from).number;
        const sameLine = state.doc.lineAt(node.to).number === line;
        // Without the cursor, the image takes the place of its Markdown. With the cursor, it shows after it.
        if (sameLine && !active.has(line)) ranges.push(Decoration.replace({ widget }).range(node.from, node.to));
        else ranges.push(Decoration.widget({ widget, side: 1 }).range(node.to));
        return false;
      },
    });
  }
  return Decoration.set(ranges, true);
}

function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let line = first; line <= last; line += 1) lines.add(line);
  }
  return lines;
}

export const imagePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildImages(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
        this.decorations = buildImages(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/**
 * Paste and drop of image files: each file goes into the vault (`save`), then its Markdown goes into the text
 * at the cursor (paste) or at the drop point. Other content pastes as usual.
 */
export function imageInput(save: (name: string, bytes: Uint8Array) => Promise<string>, onError: (message: string) => void) {
  const insert = (view: EditorView, files: File[], at: number) => {
    void (async () => {
      const parts: string[] = [];
      for (const file of files) {
        const name = pastedImageName(file);
        if (name === null) continue;
        try {
          parts.push(imageMarkdown(await save(name, new Uint8Array(await file.arrayBuffer()))));
        } catch (problem) {
          onError(String(problem).replace(/^Error: /, ""));
        }
      }
      if (parts.length === 0) return;
      // Each image on its own line.
      const line = view.state.doc.lineAt(Math.min(at, view.state.doc.length));
      const before = at > line.from ? "\n" : "";
      const after = at < line.to ? "\n" : "";
      const text = `${before}${parts.join("\n")}${after}`;
      view.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length } });
    })();
  };
  const run = (view: EditorView, data: DataTransfer | null, at: number): boolean => {
    const images = imageFilesOf(data);
    if (images.length === 0) return false;
    void (async () => {
      const files: File[] = [];
      for (const image of images) {
        const usable = await asUsableImage(image);
        if (usable === null) onError(`This kind of image cannot go into a text (${image.type}). Use PNG, JPEG, GIF, or WebP.`);
        else files.push(usable);
      }
      if (files.length > 0) insert(view, files, at);
    })();
    return true;
  };
  return EditorView.domEventHandlers({
    paste: (event, view) => {
      if (view.state.readOnly) return false;
      if (!run(view, event.clipboardData, view.state.selection.main.head)) return false;
      event.preventDefault();
      return true;
    },
    drop: (event, view) => {
      if (view.state.readOnly) return false;
      const at = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
      if (!run(view, event.dataTransfer, at)) return false;
      event.preventDefault();
      return true;
    },
  });
}

/**
 * The image files of a paste or a drop. WebKit gives a screenshot or a copied image sometimes only in `items`
 * (not in `files`), so both lists count.
 */
function imageFilesOf(data: DataTransfer | null): File[] {
  if (data === null) return [];
  const files = [...data.files];
  if (files.length === 0) {
    for (const item of data.items) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (file !== null) files.push(file);
    }
  }
  return files.filter((file) => file.type.startsWith("image/"));
}

/** A PNG, JPEG, GIF, or WebP file as it is. Other images (TIFF from macOS, BMP, HEIC) become PNG. Null if it cannot. */
async function asUsableImage(file: File): Promise<File | null> {
  if (pastedImageName(file) !== null) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (blob === null) return null;
    return new File([blob], `${file.name.replace(/\.[^.]*$/, "") || "pasted"}.png`, { type: "image/png" });
  } catch {
    return null;
  }
}
