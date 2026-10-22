// Zen mode: the top bar and the toolbar hide. Only the buttons in the setting "zenButtons" show, in a small floating bar.
// To add a button: add it here, and give its element in Workspace.tsx a shown("<id>") check.

export type ZenButton = { id: string; label: string };

export const ZEN_BUTTONS: readonly ZenButton[] = [
  { id: "back", label: "Go back" },
  { id: "forward", label: "Forward" },
  { id: "up", label: "Up one level" },
  { id: "actionItems", label: "Items by type" },
  { id: "recent", label: "Recently added" },
  { id: "trash", label: "Trash" },
  { id: "bench", label: "Link bench" },
  { id: "undo", label: "Undo" },
  { id: "redo", label: "Redo" },
  { id: "save", label: "Save status" },
  { id: "backup", label: "Back up" },
  { id: "settings", label: "Settings" },
  { id: "theme", label: "Light / dark mode" },
  { id: "path", label: "Path (breadcrumb)" },
  { id: "select", label: "Select" },
  { id: "lasso", label: "Lasso" },
  { id: "page", label: "Page" },
  { id: "large", label: "Collections (board, outline, calendar)" },
  { id: "small", label: "Notes (note, comment, URL, action item, flashcard, quote)" },
  { id: "media", label: "Media item" },
  { id: "graphs", label: "Graphs (radial)" },
  { id: "scribble", label: "Scribble" },
  { id: "eraser", label: "Eraser" },
  { id: "text", label: "Text" },
  { id: "link", label: "Link" },
  { id: "add", label: "Show an item here (+)" },
  { id: "color", label: "Color" },
  { id: "view", label: "2D / 3D" },
  { id: "plugins", label: "Plugins" },
  { id: "selection", label: "Selection tools" },
];

/**
 * Top bar buttons that are folded into the "More" menu (⋯). Each one can show in the top bar always (setting
 * "topBarButtons"). Zen mode shows them in its bar if they are in "zenButtons".
 */
export const FOLDED_BUTTONS: readonly ZenButton[] = [
  { id: "actionItems", label: "Items by type" },
  { id: "bench", label: "Link bench" },
  { id: "compareBench", label: "Compare bench" },
  { id: "recent", label: "Recently added" },
  { id: "trash", label: "Trash" },
  { id: "backup", label: "Back up" },
  { id: "zenOn", label: "Zen mode" },
  { id: "buzzies", label: "Buzzies mode" },
];
