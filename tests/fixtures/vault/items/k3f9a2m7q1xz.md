The repo is empty, so this is a fresh start. Here's how I'd answer your three questions.

## 1. Does an existing tool already do most of this?

No single tool does all of it. These come close in different ways, and they're useful to borrow ideas from:

| Tool | What it shares with your idea | What it lacks |
|---|---|---|
| **Obsidian + Canvas + graph view** | Plain markdown files, a whiteboard, a link graph, a 3D graph plugin, the dark UI you want | Boards and notes are separate things; you can't open a card into its own board; positions in the graph mean nothing |
| **Muse** (the app) | Boards inside boards to any depth. This is the closest match to your recursive idea | No link network and no 3D; data isn't plain text |
| **Milanote, Heptabase, Scrintal** | Cards on boards with links between them, some nesting | Cloud-first; data isn't plain text |
| **TheBrain** | A browsable network of linked thoughts that has existed for decades | No freeform board, no 3D placement |
| **Ted Nelson's ZigZag / Xanadu** | The original "network of networks" idea | Research projects, not usable apps |
| **AFFiNE / Logseq whiteboards** | Local-first, switch between a document and a canvas | No recursion, no 3D |

Games have similar systems too. The galaxy maps in **No Man's Sky, Elite Dangerous and Spore** zoom from a galaxy into a star system into a planet, which is the same recursive "item contains a universe" idea. **The Outer Wilds ship log** (rumor mode) and **Disco Elysium's** thought cabinet are evidence boards built as hyperlink networks. The general design pattern is called a **zoomable user interface** (Jef Raskin, Prezi, "Powers of Ten").

One very useful find is **JSON Canvas**, an open file format published by Obsidian. If your boards use it, they stay plain text and can also be opened in Obsidian as a fallback, which helps with data safety.

## 2. Language and tools

**Shell: Tauri 2** (a Rust backend with the system's own webview). It's much lighter than Electron, it's fully local, and Rust can handle file writes and git safely.

**Frontend: React + TypeScript + Vite.** Svelte or Solid would be lighter, but the best packages for your feature list are React-first, so React means writing far less from scratch.

| Need | Package |
|---|---|
| 2D board: select, lasso, scribble, text, arrows, pan/zoom, its own undo | **tldraw** (check its current license: for production it either shows a watermark or needs a license key; fine for personal use) or **Excalidraw** (MIT license, simpler) |
| Typora-style rich text over plain markdown | **Milkdown** (a WYSIWYG markdown editor built on ProseMirror and inspired by Typora) or **CodeMirror 6** with live preview (what Obsidian uses) |
| 3D item cloud | **react-three-fiber + drei** (three.js). `3d-force-graph` is an option if you want physics, but you said positions should mean something, so I'd store fixed x, y, z positions instead |
| Freehand strokes | `perfect-freehand` (tldraw already includes it) |
| App state and undo/redo | **Zustand + Immer patches** (a command-based undo stack), or **Yjs** if you want one undo manager covering both text and boards |
| Version history | **git**, through `git2` in Rust: automatic commits as you work, plus history and restore |
| Fast index (search, backlinks) | **SQLite** used only as a cache that can be rebuilt from the files, never as the source of truth |

**Data integrity plan:**
- The files on disk are the truth: markdown for text, JSON Canvas for board layout and links.
- Every save writes a temporary file, flushes it to disk, then renames it over the original, so a crash can't leave a half-written file.
- An automatic git commit runs every few seconds of idle time and before any destructive action.
- The database can always be thrown away and rebuilt from the files.
- A file watcher picks up edits made in other editors.
- Items are stored by stable ID rather than by folder path, so moving an item never breaks links or git history.

## 3. Questions I need answered before planning

**Data model (the most important group):**
1. Is containment a strict tree, where each item lives in exactly one parent? Or can one item appear on several boards? The second option makes undo, deletion and file layout much harder.
2. Are scribbles and free text boxes full items (named, linkable, openable)? Or are they just decorations on a board?
3. What's the difference between "note" and "page"? My guess is that a note is a card that contains a board, and a page is a document-like frame with a fixed size. Is that right?
4. Links:
   - Can a link point to an item at a different depth?
   - If so, how should it look on a board that only shows one of the two ends?
   - Are links directed, and can they have labels?

**Views:**

5. Does the 3D view show only the current board's children, or the whole nested tree (like galaxy, then star systems, then planets)?
6. Do 2D and 3D share coordinates (3D just adds a z value), or does each view keep its own layout?

**Text:**

7. Is markdown (what Typora uses) enough? Word-style features such as fonts, colors, page layout and complex tables don't fit plain text cleanly. Do you also need images or PDFs attached to items?

**Undo and history:**

8. Should there be one global undo stack across boards, text and 3D? Or one per board, plus a separate stack inside the text editor? Should undo history survive a restart, or is git history enough for that?
9. Do you want a visible history/restore UI, or should git just work silently in the background?

**Environment:**

10. Is this macOS only? Do you need sync across devices or mobile now or later? Both affect whether a CRDT like Yjs is worth adopting from the start.
11. Roughly how many items do you expect: hundreds, or tens of thousands? That decides how hard the 3D renderer has to work.
12. For the two data versions: I'll make the data folder configurable (an environment variable or config file) and only ever point it at a test folder inside or next to this repo. Where do you want that test folder, and should I generate the example texts myself?
13. Should the boards also open in Obsidian (JSON Canvas compatibility), or is that unimportant?

If you answer 1, 2, 5, 7 and 8, I can draft the architecture and file layout.

I also saved a project memory: never touch the real data folder, only the test folder.
