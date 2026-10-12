// Tool registry. See docs/SPEC.md section 7.2.
// To add a tool, add one entry here. The board reads the behavior flags.

import type { LucideIcon } from "lucide-react";
import { BookOpen, CalendarDays, CircleDashed, Cloud, Eraser, SquareDashed, FileText, Globe, Highlighter, Lasso, Layers, LayoutGrid, Link2, MessageSquare, MousePointer2, PenLine, Quote, StickyNote, Type } from "lucide-react";
import type { GroupShape, ViewStyle } from "../../core/types";

export type ToolId =
  | "select"
  | "lasso"
  | "note"
  | "page"
  | "board"
  | "text"
  | "scribble"
  | "eraser"
  | "link"
  | "comment"
  | "weblink"
  | "todo"
  | "flashcard"
  | "quote"
  | "outline"
  | "calendar"
  | "groupRect"
  | "groupEllipse"
  | "groupBlob";

/** Tools that share one tool bar button (a choice menu). */
export type ToolMenu = "large" | "small";

export type Tool = {
  id: ToolId;
  label: string;
  /** The name in a choice menu ("Board"). Default: the label. */
  name?: string;
  /** One key, without modifiers. None: the tool has no key. */
  shortcut?: string;
  icon: LucideIcon;
  /** A click on empty board space creates an item with this view. */
  createsView?: ViewStyle;
  /** The created item is an empty board. */
  createsBoard?: boolean;
  /** The tool draws on an overlay above the board. */
  overlay?: "lasso" | "scribble" | "erase" | "rect" | "ellipse" | "area";
  /** A drag on the board draws a group card with this shape. */
  createsShape?: GroupShape;
  /** A drag from one card to a different card makes a link. */
  connects?: boolean;
  /** After one use, the board goes back to the select tool (unless a double-click made the tool stay on). */
  oneShot?: boolean;
  /** A click on a card attaches the new object to that card. A click on empty space makes a free object. */
  attaches?: boolean;
  /** A click on empty board space creates a group. */
  createsGroup?: "outline" | "calendar";
  /** The tool is in a choice menu, not a button of its own. */
  menu?: ToolMenu;
  /** In the choice menu, the tool is in this submenu (for example the shapes of "Group"). */
  submenu?: ToolSubmenu;
};

/** Submenus of a choice menu: one row that opens a list at its side. */
export type ToolSubmenu = "group";
export const TOOL_SUBMENUS: Record<ToolSubmenu, { name: string; icon: LucideIcon }> = {
  group: { name: "Group", icon: SquareDashed },
};

export const TOOLS: readonly Tool[] = [
  { id: "select", label: "Select", shortcut: "v", icon: MousePointer2 },
  { id: "lasso", label: "Lasso select", shortcut: "l", icon: Lasso, overlay: "lasso" },
  { id: "page", label: "Create page", shortcut: "p", icon: FileText, createsView: "page", oneShot: true },
  { id: "board", label: "Create board (double-click to enter)", name: "Board", shortcut: "b", icon: LayoutGrid, createsView: "note", createsBoard: true, oneShot: true, menu: "large" },
  { id: "outline", label: "Create outline", name: "Outline", shortcut: "o", icon: BookOpen, createsGroup: "outline", oneShot: true, menu: "large" },
  { id: "calendar", label: "Create calendar", name: "Calendar", shortcut: "y", icon: CalendarDays, createsGroup: "calendar", oneShot: true, menu: "large" },
  { id: "groupRect", label: "Group: drag to draw a rectangle", name: "Rectangle", shortcut: "g", icon: SquareDashed, overlay: "rect", createsShape: "rect", oneShot: true, menu: "large", submenu: "group" },
  { id: "groupEllipse", label: "Group: drag to draw an ellipse", name: "Ellipse", icon: CircleDashed, overlay: "ellipse", createsShape: "ellipse", oneShot: true, menu: "large", submenu: "group" },
  { id: "groupBlob", label: "Group: draw a free shape", name: "Free shape", icon: Cloud, overlay: "area", createsShape: "blob", oneShot: true, menu: "large", submenu: "group" },
  { id: "note", label: "Create note", name: "Note", shortcut: "n", icon: StickyNote, createsView: "note", oneShot: true, menu: "small" },
  { id: "comment", label: "Comment: click a card (or empty space)", name: "Comment", shortcut: "m", icon: MessageSquare, createsView: "comment", attaches: true, oneShot: true, menu: "small" },
  { id: "weblink", label: "Web link: click a card (or empty space)", name: "Web link", shortcut: "w", icon: Globe, createsView: "weblink", attaches: true, oneShot: true, menu: "small" },
  { id: "todo", label: "Create action item", name: "Action item", shortcut: "i", icon: Highlighter, createsView: "todo", oneShot: true, menu: "small" },
  { id: "flashcard", label: "Create flashcard", name: "Flashcard", shortcut: "f", icon: Layers, createsView: "flashcard", oneShot: true, menu: "small" },
  { id: "quote", label: "Create quote", name: "Quote", shortcut: "q", icon: Quote, createsView: "quote", oneShot: true, menu: "small" },
  { id: "scribble", label: "Scribble: strokes join one scribble until Esc", shortcut: "s", icon: PenLine, overlay: "scribble" },
  { id: "eraser", label: "Eraser: drag over strokes", shortcut: "e", icon: Eraser, overlay: "erase" },
  { id: "text", label: "Text", shortcut: "t", icon: Type, createsView: "text", oneShot: true },
  { id: "link", label: "Link", shortcut: "k", icon: Link2, connects: true },
];

/** `key`: the tool whose key shows in the tooltip of the menu button. */
export const TOOL_MENUS: { id: ToolMenu; label: string; key?: ToolId }[] = [
  { id: "large", label: "Create board, outline, calendar, or group" },
  { id: "small", label: "Create note", key: "note" },
];

/**
 * The tool bar: groups of tools (with a divider between groups). A string is one tool; `{ menu }` is a choice button.
 * select, lasso | page, large items, small items | scribble, eraser, text | link (then "Show an item here")
 */
export const TOOLBAR_GROUPS: readonly (readonly (ToolId | { menu: ToolMenu })[])[] = [
  ["select", "lasso"],
  ["page", { menu: "large" }, { menu: "small" }],
  ["scribble", "eraser", "text"],
  ["link"],
];

export function toolById(id: ToolId): Tool {
  const tool = TOOLS.find((candidate) => candidate.id === id);
  if (tool === undefined) throw new Error(`Unknown tool "${id}".`);
  return tool;
}
