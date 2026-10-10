// Zen mode: the top bar and the toolbar hide. Only the buttons in the setting "zenButtons" show, in a small floating bar.
// To add a button: add it here, and give its element in Workspace.tsx a shown("<id>") check.

export type ZenButton = { id: string; label: string };

export const ZEN_BUTTONS: readonly ZenButton[] = [
  { id: "back", label: "Back" },
  { id: "forward", label: "Forward" },
  { id: "actionItems", label: "Action items" },
  { id: "trash", label: "Trash" },
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
  { id: "small", label: "Notes (note, comment, web link, action item, flashcard, quote)" },
  { id: "scribble", label: "Scribble" },
  { id: "eraser", label: "Eraser" },
  { id: "text", label: "Text" },
  { id: "link", label: "Link" },
  { id: "add", label: "Show an item here (+)" },
  { id: "color", label: "Color" },
  { id: "view", label: "2D / 3D" },
  { id: "web", label: "Web pages" },
  { id: "plugins", label: "Plugins" },
  { id: "selection", label: "Selection tools" },
];
