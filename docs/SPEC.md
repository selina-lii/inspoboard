# Inspoboard: Specification

Status: draft 2 (all open points closed). Writing rules: ASD-STE100 (Simplified Technical English).

Rules for this document:

- One idea in one sentence.
- Descriptive sentences have a maximum of 25 words. Instructions have a maximum of 20 words.
- Use the active voice and the present tense.
- "Must" is a requirement. "Can" is a permission.

---

## 1. Principles

These principles have priority over all features. If a feature breaks a principle, do not add the feature.

| ID | Principle |
|---|---|
| P1 | **Single source.** Each piece of data has one record in one location. All other data is derived from it. Derived data is never saved as truth. |
| P2 | **Data integrity first.** The app must never lose or silently change user data. |
| P3 | **Plain text only.** Core data is Markdown text or JSON. The app can operate with no assets. |
| P4 | **Views are not data.** The board, the 3D galaxy and the editor show data. They do not own data. |
| P5 | **Minimization.** Add the smallest data and the smallest feature that does the job. |
| P6 | **Local only.** The app does not use a network. The app never pushes data to a remote location. A plugin is a separate program (section 7.7). The core app has no network code. |
| P7 | **Replaceable parts.** Each third-party package is used in one module only. You can replace a package without changes to other modules. |

---

## 2. Data model

### 2.1 Records

All data is a set of records. Each record has a unique ID. All records use the same ID space.

| Record | Purpose | Core fields |
|---|---|---|
| **Item** | A unit of text. Each item is also a board. | `id`, `name`, `created`, `modified`, `date`, `board`, body text |
| **Link** | A connection from one record to a different record. | `id`, `kind`, `from`, `to`, kind-specific fields |
| **Stamp** | A small freehand drawing. It is a decoration or a non-Unicode notation. | `id`, `alt`, `path` |
| **Group** | A part of a board with one shape: an outline (aligned list) or a calendar (month grid). Section 7.6. Table `outlines`. | `id`, `board`, `x`, `y`; optional: `type` (`calendar`), `name`, `list`, `direction`, `start`, `end` |

An ID is a random string of 12 characters (lowercase letters and digits). An ID never changes.

Item times:

- `created`: the app sets it when it creates the item.
- `modified`: the app sets it when the name or the body text changes.
- `date`: the user types it. Use it for data that was made outside the app. It is free text, for example "1998" or "2021-05-03".
- "Opened" is app state, not core data. It is in `.inspoboard/opened.json`. It is not in history snapshots and not in undo.
- A note has no name by default. A note can keep an empty name. Lists show the start of its text.
- If the user leaves the name of a page or a board empty, the app makes a code in one of four formats: 3 digits, 4 digits, 2 letters + 2 digits, or 3 letters (capitals). The item gets `codeName: true`. A code shows as a low-profile chip. A typed name removes the mark.
- The setting "Item title" hides the name above the text. Cards always show names. A long name above the text wraps onto more lines: the whole name shows. Enter saves it; a name has no line breaks.
- The dates are hidden by default. The setting "Item dates" shows them under the item title, one on each line.
- Object fields (all optional): `url` (the web address of a link object), `author` (the signature of a comment: Settings → Your name; only a name, not an account), `on` (the item that a comment or link is attached to), `quote` (a comment on a passage: an exact text in the body of `on`), `resolved` (a resolved comment thread), `pageAt` (a small item in a page, comment or note: its place, [x, y] in px from the top-right corner of the text; missing means it is in the column at the right edge of the text), `trashed` and `trashedFrom` (an item in the trash: section 5.4).
- A reply is a comment item with `on` = the comment it answers. It has no placement: it shows in its thread. It is not an unplaced item.
- `background` (optional): the background of the board of the item. A color `#rrggbb`, or an image path `images/<name>`. The vault setting `defaultBackground` applies to boards without their own background. `backgroundWidth`, `backgroundCenter`, `backgroundFixed` (optional): from an older background mode (the image moved with the cards). They stay valid and are kept, but the app does not use them now (section 7.1).

### 2.2 Link kinds

| Kind | Meaning | Kind-specific fields |
|---|---|---|
| `place` | Record `to` is shown on board `from`. | `x`, `y`, `w`, `h` (2D layout); `p3` (3D position, optional); `view`; `expanded`, `color`, `ref`, `outline`, `parent`, `rank`, `day`, `until`, `marks` (quote cards), `time` (all optional) |
| `link` | Item `from` refers to item `to`. | `label`, `group`, `start`, `end`, `quote` (all optional) |

A link has no body text (P5). To describe a link with more text, make an item and link to it.

- An item lives on one board only: its **home**. The home placement is the `place` link without `ref`. Older vaults can have more: then the one with the lowest ID is the home.
- A placement with `ref: true` is a **reference**: the item shows on a different board as a ghost card with a dashed outline. Double-click it for a quick view. Its menu has "Open home board". "Show an item here" (A) makes a reference if the item has a home.
- `color` (optional): the card color `#rrggbb`. The text color follows for contrast.
- `quote` (optional, on a `link`): a location in the target item: an exact text in its body. A jump along the link marks this text.
- The view style is on the `place` link, not on the item. Thus one item can show as a note on one board and as a page on another board.
- The type icon of a card (note, page, board) shows only on hover or selection.
- Values for `view`: `note` (yellow sticky note), `page` (light lilac paper: full-screen text with a note-size preview), `text` (bare text without a frame), and the objects:
  - `comment`: dark card, electric pink text, a signature and a time, and its replies under it. Attached (`on`) or free. An attached comment shows at the right side of its card (with a dotted line) and moves with it; "Detach" frees it. On the text page of its item it shows in the comment column. "Comment" (right-click selected text) attaches it to the passage (`quote`): a click on the passage in the column marks it in the text. Its buttons: Reply, and Resolve (the thread is hidden but stays, with its history; the column can show resolved threads and open them again). Delete removes the thread with its replies (undo brings it back).
  - `weblink`: dark blue card that shows only its name (or the host of its address), like a collapsed note. Free, or attached to a card ("Attach a web link"), or in text ("Add web link…" on selected text writes `[text](url)`). Double-click opens it: a web address opens in the web browser (the app downloads nothing); a local file opens as below. Its menu has "Download and open website locally" (the web page reader, section 7.8). Its buttons (on hover) and its menu ("Edit name and link") open one form with the name and the link (Enter saves both, Esc cancels). The link can be a web address (it opens in the web page reader, section 7.8) or a local file: "file:///…", "~/…", or a full path. A local PDF opens in the PDF reader (a copy goes into the vault, as with "Open a PDF file…"). Any other local file shows in Finder (Explorer on Windows); the app does not open it. A local file link shows the file name and a file icon.
  - `todo` (action item): half-transparent fluorescent film (yellow, green, blue, pink, purple: right-click). "Done" (its check box, shown on hover) removes the item and its placements. Undo brings it back. Double-click it to edit its text on the film (no edit box): while it is edited, it grows to the sticky note size (200 × 160) over its neighbors, as a note does. Folded (for example in a full calendar day), it shows the first line of its text and no Done box.
  - `flashcard`: cornflower blue, two sides, the sticky note size (200 × 160; a saved size does not change how it shows, and the data stays). Its text is 2 px larger than before (front 15 px, back 14 px). The name is the front, the text is the back. Double-click flips it (view state). A new flashcard opens its front for typing. After that, edit only from its right-click menu: "Edit front" or "Edit back" (the card shows that side). It has no edit button, and Enter or F2 does not edit it.
  - `quote`: a passage on newsprint paper (pale yellow, dark gray serif text), framed by quotation marks: a large opening mark at the top left and a closing mark at the bottom right, inside the card. A slim card, 320 × 72 by default: small top and bottom edges; the height grows with the text (the saved height is the least height). The edges can be dragged (any width and height). The text is the passage; the name is its source, shown under it ("— source"); the source can be empty. Double-click (or "Edit text") writes the text; "Edit source" writes the name. The marks (`marks` on the place link): `en` ‘ ’, `cjk` 「 」 (Traditional Chinese, Japanese), `zh` “ ” (Chinese), `es` « » (Spanish, French), `none`. Right-click → one line "Marks" with the five choices. Without `marks`, the marks follow the text: CJK text gets 「 」, other text ‘ ’. Folded ("Fold into a bubble", the button on hover, or `expanded` not true): a small gray speech bubble with the first two words (two characters of CJK text); a double-click unfolds it. Export: a Markdown quote, with "— source" on its last line.
  - Objects keep their type: the note / page / board button does not show for them.
- A page or note card shows only its name if `expanded` is not true. A collapsed note with no name shows the first line of its text. A new note is expanded. A text card always shows its text.
- A note is short text on the board. It never opens as a page: double-click a note to open it in place and edit it. The text is edited on the note paper (no edit box). While it is edited, the note grows to the sticky note size (200 × 160) over its neighbors. A note is never larger than the sticky note size: resize makes it smaller only, and a larger saved size shows at the sticky note size (the data does not change). Double-click the name of a note to edit the name. A note with no name has a "Give it a name" button (on hover). While the user edits a card, a drag in the card selects text: it does not move the card or the board.
- A note can hold scribbles: draw in the note, or drag a scribble onto the note (the note shows a drop outline). The scribble then has `from` = the note item, with coordinates relative to the card. It moves with the note and the card clips it. "Take scribbles out" puts them back on the board at the same place.
- An item is a **board** if it has item children (scribbles do not count), or if its `board` field is true. A board card always has the board look, whatever its view.
- One state button changes a card:
  - Not a board (or an empty board): note → page → board → note. "Board" sets `board: true` on the item, so the item is a board everywhere.
  - A board with one child: board ↔ stub. "Stub" moves the child out, next to the card, and makes the item a normal item. One command.
  - A board with two or more children: it stays a board.
- Between two cards, each direction has one line only. All links to the same off-board record share one stub.
- A `place` link can point to a stamp. A `link` link cannot.
- If `p3` is missing, the galaxy view calculates a position from `x`, `y`. The app saves `p3` only after the user moves the record in 3D.

### 2.3 Links in text

A **text link** is a Markdown link to a `link` record. The `link` record is the single source: it shows as an arrow on the 2D and 3D views.

```markdown
See the [tool research](link:l5t8r2k9m3q6) for the list.
```

- Select text, right-click (or Cmd+K), then "Create link to a new page" or "Create link to an existing item…". For an existing item, click the item on a board, or search (Cmd+F): a text result makes a link to that exact text (`quote`). Esc cancels.
- Cmd+click a text link, or double-click its line, to go to the target. The target text shows marked in yellow.
- Links show at each level:
  - In a text: a hover on a link to an item shows a card with the name of the linked item, the boards to it, the linked passage, and "Go to" (the same as Cmd+click).
  - On a text page: "Links to" and "Linked from" under the text list the items that the page links to and the items that link to it (text links, board links, and item links). A click on "Links to" goes to the target, at its passage; a click on "Linked from" opens that item at the linked words.
  - On a board: the right-click menu of a card has "→ name" (go to a linked item) and "← name" (go to an item that links to it), up to 6 each, also for items on other boards (they have no line on this board). With more, "All links: open the page".
  - The 2D and 3D views show a link between two cards on the same board as an arrow. A row of an outline that shows only its name is as wide as the outline: its arrows go to the part with its marker and name (at the left), not to the middle of the row.
- Older vaults can have inline references `[label](item:<id>)`. They stay in the text and Cmd+click opens the item. They draw no line (no dashed lines: they can mean less than a link and can show a link two times).
- The app reads the text and derives an index of inline references.
- Any Markdown reader can show this text. The text stays readable without the app.
- A link to an outside URL (for example `https://…`) opens in the system browser. It is not a record.

### 2.4 Stamps

- A stamp is an SVG path string. Coordinates have one decimal (0.1 board units).
- The stamp keeps the position where the user drew it. After the stroke ends, nothing changes its shape or the distances between its strokes. A group drag moves all records by one rounded move. A resize keeps the proportions of a stamp. The app applies minimum smoothing: one light 1-2-1 average on inner points, then it removes points that are less than 0.25 units from a straight line. The first and last points do not move.
- A stamp must have alt text. The default alt text is `scribble`. The user can change it.
- A stamp is not an item. It has no body text and no children.
- A stamp can have many strokes. Each stroke starts with an "M" command. A "Z" command closes a stroke: the app reads it as a line back to the stroke start.
- To join stamps, select them and use "Combine". The first stamp gets all strokes, in one command.
- To split a stamp, select it and use "Split". Each stroke becomes its own stamp at the same position, in one command.

### 2.5 Images

- An image is a Markdown image in the body text of an item: `![alt text](assets/photo.png)`.
- The user must type alt text before the app adds the image.
- If the image file is missing, the app shows the alt text. This is not an error.

### 2.6 The root

The main view is an item. The file `vault.json` gives the ID of this root item.

---

## 3. Vault (storage on disk)

A vault is one folder. The user selects the folder in the app. All app data and all caches are in this folder.

```
<vault>/
  vault.json            Format version and root item ID.
  items/<id>.md         Body text of one item. Plain Markdown. No front matter.
  table/items.jsonl     One line for each item: id, name, created, updated.
  table/links.jsonl     One line for each link.
  table/stamps.jsonl    One line for each stamp.
  table/outlines.jsonl  One line for each outline. Only when the vault has an outline.
  assets/               Optional images in text. The app operates without this folder.
  images/               Images: board backgrounds, and images in texts (pasted or dropped). The app copies them here.
  web/<key>.html        A saved web page: one file, its images and styles inside (section 7.8). Optional.
  web/<key>.pdf         A saved PDF (from the web, or from a file on this computer). Optional.
  web/<key>.notes.json  The user's highlights and scribbles on that page or PDF. The page file never changes for them.
  marks/<id>.json       The highlights and scribbles on the text of an item. Its text file never changes for them. Optional.
  .inspoboard/          Owned by the app. Not user data.
    history/            Git repository for the time machine (section 6).
    cache/              Derived data. You can delete it at any time.
    lock                Prevents two app instances from opening one vault.
    opened.json         The time each item was last opened. App state, not core data.
    settings.json       Settings of this vault (display, read aloud, plugin options, default background). App state, not core data.
    trash/              Files that a delete moved. The app never removes a file.
```

Rules:

- Each table file has one JSON object on each line. Lines are sorted by `id`. This gives small, clear diffs in history.
- The file name of an item is its ID, not its name. A new name does not move a file or break a reference.
- The app reads all files at startup. It builds the index in memory. 1000 items do not need a database.
- The app must not write to any location outside the vault.
- The app has no memory of vault locations. At startup, the user selects a folder.
- A development build opens only vaults inside `data/` in this repository. It starts with `data/vault`. A release build has no such limit.

### 3.1 Format compatibility

- Each new app version must read every older vault with no change to the files. This is full backwards compatibility.
- A new field must be optional. Its default is not saved. Old files without the field stay valid.
- The app never changes the format of a vault without a user decision.
- If a change cannot be backwards compatible, the developer writes a one-time migration script in `scripts/migrations/`. The user runs it on their own vault. The script must:
  1. Copy the vault to a backup folder first.
  2. Support a dry run that only reports the changes.
  3. Write each file atomically.
  4. Increase `format` in `vault.json`.
- The developer never runs a migration on user data. Test a migration on a copy of the test vault.

### 3.2 Test vault

- The test vault is in `data/` in this repository.
- Tests copy the test vault to a temporary folder. Tests must not change the files in `data/`.
- Developers must not open, read, or change a real user vault.

---

## 4. Write path and integrity

### 4.1 Write a file

1. Write the new content to a temporary file in the same folder.
2. Flush the temporary file to disk.
3. Rename the temporary file to replace the old file. This operation is atomic.

A crash during these steps leaves the old file or the new file. It never leaves a partial file.

### 4.2 Save cycle

1. A command changes records in memory (section 5).
2. The app marks the changed records as "dirty".
3. After 300 ms with no new change, the app writes the dirty files.
4. After 30 s with no new change, the app makes a history snapshot (section 6).
   Before a command deletes body text, the app makes a snapshot immediately.
5. When the app closes, it writes all dirty files and makes a snapshot.

### 4.3 Startup checks

1. Get the vault lock. If a different running app has the lock, open the vault as read-only.
2. Read all files.
3. Validate each record against its schema.
4. Find broken references. A broken reference is an ID that has no record.
5. Show problems to the user. Never repair data automatically by deleting it.
6. If a problem is an error, open the vault as read-only. Thus a save cannot remove a line that the app could not read.

The app keeps unknown fields in a record. It writes them back without change.

### 4.4 Changes from outside the app

The app watches the vault for changes from other programs.

- If an item is not open in the editor, the app reloads it.
- If the item is open and has unsaved changes, the app shows a conflict. The user selects which version to keep. The app keeps the other version as a snapshot.
- The app never overwrites an outside change without a user decision.

### 4.5 Cycles, broken references, and locks

The record graph can have cycles. For example, board A places B, and board B places A. This is permitted.

| Risk | Control |
|---|---|
| Endless recursion | Each walk of the graph uses a set of visited IDs and a depth limit. |
| Broken reference | The missing ID shows as a **ghost node**. The ghost keeps all its links. Thus it stays a bridge in the graph. |
| Orphan item (on no board) | The "Unplaced items" panel lists it. |
| Deadlock | Not possible. One process and one writer thread own the vault. No step waits for a different step. |
| Two app instances | The vault lock file. If the owner process is not running, the lock is stale and the app replaces it. |

---

## 5. Commands, undo, and redo

### 5.1 Commands

Each user action makes exactly one command. A command is a list of record operations:

```ts
type Op = { table: TableName; id: Id; before: Rec | null; after: Rec | null };
type Command = { label: string; ops: Op[] };
```

- `before: null` means "create". `after: null` means "delete".
- To do the command, apply each `after`. To undo the command, apply each `before` in reverse order.
- In memory, body text is a separate table (`texts`) with the same ID as the item. Thus undo of a rename never changes the text.
- A create or delete command includes the body text. Thus undo restores the full item.
- View steps: a plugin result that shows in place of the text (for example a translation), "Show originals", and "Show translations" are steps on the same undo stack, in order with the commands. Undo shows the other text (the original or the result); redo shows it again. A view step has no ops: it never changes the data. ⌘Z also works while the cursor is in a text that cannot change (a result in place of the text).
- Undo and redo record the values that they replace. Thus redo restores the exact state, also after an editor change.

### 5.2 Stacks

| Stack | Scope | Survives restart |
|---|---|---|
| Global stack | All actions: record operations from the board, the galaxy, and panels; text changes; marks (highlights, scribbles); view steps. | No |
| Editor history | The text changes of one open editor (CodeMirror). It is not a separate stack for the user: each new step of it is one step of the global stack. | No |

- One undo history for a page and the whole app: ⌘Z (also in the editor) undoes the last action, whatever it was: typing, a highlight, a scribble, a comment, a note, a rename. A text step runs the editor's own undo, so the cursor comes back. After its editor closes, a text step does nothing (the text stays).
- Marks: each change by the user (add, remove, move, erase) is one step; it puts back the marks as they were. Highlights that move because of typing are no steps (the text steps undo them).
- Before a command deletes an item, the app closes the editor for that item.

### 5.3 Delete actions

| Action | Effect |
|---|---|
| Remove from board | Deletes one `place` link. The item stays. |
| Delete link | Deletes one `link` record. |
| Reroute link | Changes `from` or `to` in one link record. |
| Delete item | Deletes the item record and its body text. All links stay. The item becomes a ghost node (section 4.5). |
| Delete ghost | Deletes the links of a ghost node, in one command. The user must confirm. |

- The app never edits the text of a different item because of a delete.
- "Delete item" needs a confirmation.

### 5.4 Trash

- An item that is on no board is in the trash. Delete (on a board, in an outline, or in a calendar) removes only the card. When the item loses its last card, the same command writes two optional fields on the item: `trashed` (the time, ISO 8601) and `trashedFrom` (its last card: `board`, `x`, `y`, `w`, `h`, `view`). Undo removes them with the delete.
- When an item in the trash gets a card again (Restore, "Show an item here", Undo), the same command removes the two fields.
- An attached object (a reply, a comment on a page) is never in the trash. The root item is never in the trash. The items on a board in the trash stay on that board: Restore of the board brings them back too.
- Trash (top bar, trash button): the list of the items in the trash, the most recent first. Items of older versions (on no board, no `trashed` field) follow, as "Older". Type to filter.
- Restore (click the row, Enter, or the restore button) puts a card back on the last board, at the last place. If that board is gone or in the trash, the card goes on the current board, at the right of its cards. The board then shows the item.
- "Delete forever" (with a confirmation) deletes the item record, its text (the file goes to `.inspoboard/trash`), its relation links, and the cards on its own board. Items on its board that are on no other board then go to the trash. Text links to it in other texts stay; they show the item as gone. Undo brings all of it back while the app is open; after that, the time machine has it.
- Nothing leaves the trash by itself. There is no "Empty trash".
- Action items that are done, and comment threads that are deleted, are deletes of records (undo and the time machine bring them back). They do not go to the trash.

---

## 6. Time machine (history)

- The app keeps a local Git repository in `.inspoboard/history`. The working tree is the vault.
- The app uses a separate Git folder. Thus a user Git repository in the vault does not conflict with it.
- The app never adds a remote. The app has no push function.
- Version 1: the user can see a list of snapshots, open a snapshot as read-only, and restore one item or the full vault.
- Later: a `place` link can show an item at a fixed snapshot.
- A restore is a new command. It does not delete history.
- Backup (top bar, archive button): the app saves all changes, then copies `vault.json` and the data folders into `<vault>/.backup/<YYYY-MM-DD_HH-MM-SS>/` (UTC). A backup is a plain folder: to restore, copy its files back. A message shows the folder and the size. If the backup is larger than the limit in Settings ("Backup alert", default 1 GB), the message is a warning. Snapshots never hold `.backup`.

---

## 7. Views

### 7.1 Board (2D)

- The board shows the `place` links of one item.
- A `link` link shows as a line from the center of one card to the center of the other card. The cards hide the line ends.
- Each end of a link has a cap: none, arrow, open arrow, circle, square, or diamond (open or filled). The defaults are "none" at the start and "arrow" at the end. Only other values are saved (`start`, `end`). The caps sit at the card edge.
- Ctrl+Shift+P collapses all expanded cards on the board, in one command.
- If only one end is on the board, the app shows a short stub with the name of the other item. Click the stub to open that item. This case is rare.
- Inline references in text draw no line.
- Each board keeps its view (position and zoom) while the app is open. A return to a board of the path (back, the breadcrumb, Esc out of an item) shows the same part as before. A board that opens for the first time shows all its cards.
- Double-click a card to zoom into it. The board of the item fills the screen. Notes and text cards edit in place. References open a quick view.
- If the item has no children, the app shows only the text, like Typora. A button shows the board.
- Mouse drag on empty space moves the board. Ctrl+drag (Cmd+drag on macOS) selects with a box. Scroll moves the board. Pinch or Ctrl+scroll zooms.
- Double-click a card to open it: a board shows its board, a note or page shows its text. Double-click a text card to edit its text.
- To change the name of a card, select it and press Enter or F2. Double-click the board name in the breadcrumb to change it.
- Link tool: click the first item, then the second item. To link to an item that is not on the board, right-click (anywhere on the board) or click "Search…" after the first item: a search of all boards (names and texts) opens. A click on a hit makes the link; a hit in a text links to that text (`quote`). The new link shows as a stub. A link from selected text ("Link selected text", existing item) works the same: right-click on the board opens the search of all boards.
- Release builds show no browser menu ("Inspect Element") on a right-click. Text fields keep it (copy, paste).
- To move records into a board, drag them onto a board card (it shows a dashed outline), or use "Move into…" and select the board. One command. Only the place links change. The records keep their layout relative to each other and go to the right of the cards that the board has.
- The breadcrumb shows the path you used, not a tree path.
- Back and Forward (top bar, Cmd+[ and Cmd+]) go through the board views, as in a browser. View history is not saved and is not part of undo.
- Right-click a card (or the selection) for its menu: open, edit text, open home board, move to board…, make outline, take out of outline, take scribbles out.
- Right-click the empty board for the background: an image for this board or for all boards, or remove a background. The app copies the image into `images/` of the vault (simple name plus a content hash, atomic write). History snapshots include `images/`.
- A background image stays still: it fills the view behind everything (cover, centered), in 2D and in 3D. A color fills the whole view. (An older mode, in which the image moved and zoomed with the cards, is removed. Its fields `backgroundFixed`, `backgroundWidth`, `backgroundCenter`, and the setting `defaultBackgroundFixed` stay valid and are kept in the files, but the app does not use them.)
- The color manager (tool bar) sets the board background color (this board or all boards) and the color of the selected cards.

### 7.2 Toolbar

The tool bar is at the top, below the breadcrumb bar. Each tool is an entry in the tool registry. To add a tool, add one entry.
At the right, the tool bar shows controls for the selection: view style, link label and group, stamp alt text.

Order (dividers between the groups): select, lasso | page, large items | small items | scribble, eraser, text, link | show an item here (+), color | 2D/3D, Document | web pages, plugins. Search has no button: ⌘F. While a web page or PDF is open, the reader tools replace the board tools (section 7.8).

| Tool | Result |
|---|---|
| Select (arrow) | Select, move, and resize. Click and drag on empty space to select with a box. |
| Select (lasso) | Draw a free shape to select. |
| Create page (P) | Create an item and a `place` link with `view: page`. |
| Create collection (one button with a list, board icon; the list shows names only) | Board (B): an empty board, an item with `board: true` (double-click it to enter). Outline (O): a new outline with one page. Calendar (Y): a new calendar (this month and the next two). A new group opens its title for typing. |
| Create note (one button with a list, note icon; the list shows names only) | Note (N). Comment (M), web link (W): click a card to attach it, or empty space. Action item (I), flashcard (F), quote (Q): click empty space. |
| Scribble | Draw strokes. All strokes until Esc or a tool change go into one stamp. |
| Eraser | Drag over strokes. Each stroke that the eraser touches is erased fully. A stamp with no strokes is removed. |
| Text | Create an item and a `place` link with `view: text`. |
| Link | Drag from one record to a different record to make a `link`. A new link has no arrows (`end: "none"`); the link menu changes the caps. |

- Cards: the title is one line (a long title ends with "…"). Exception: an open page card shows its whole title (a long title wraps). On hover, the type icon, the fold arrow, and the edit button show at the right end of the title row: the title does not move.
- Notes: right-click → "Gray out" (card color `#a1a1a6`) or "Yellow note" (the default, no color).

- Zen mode: View › Zen Mode (below Enter Full Screen, ⌃⌘Z). The top bar and the tool bar hide, and the board fills the window. Only the buttons in the vault setting `zenButtons` show, in one small bar at the top (Settings → Zen mode buttons; default: back, undo, redo, select, scribble, eraser, text). Esc ends zen mode when Esc has no other use (no text input has the focus, no menu or dialog is open, no tool is on). The button at the left end of the bar also ends it. Zen mode is not saved. In Settings, the list of zen mode buttons is folded; a click on its title opens it.
- A tool that makes one thing (note, page, board, text, objects, groups) goes back to Select after one use. A double-click on the tool (or on its entry in a list) keeps it on: for example, click many times to make many pages. A dot under the button shows this. Esc or a different tool ends it. Typing in a card (its name or its text) also ends it: the next click finishes the card, it does not make a new one.

Dialogs and tool bar popovers (Settings, plugin options such as Read aloud, "Read a web page", search lists) open fully in the window: if a part is outside, the panel moves in. A drag on the title moves the panel; the title stays in the window. The position is not saved.

### 7.3 Galaxy (3D)

- The galaxy shows the children of one item at their `p3` positions.
- A child with no `p3` gets its x and y from the 2D board. Its depth (z) is spread from its place ID (fixed, pseudo-random), up to 0.6 × the larger side of the cards' area, so that many cards fill a volume. Cards in an outline or a calendar stay in the plane. A drag saves `p3`. The background image lies behind the deepest card.
- Each child that has children shows them as a small cluster around it. The depth limit is 2.
- Each record is a dot with a small tag or icon. The name shows on hover and near the camera. A note with no name shows no label (on hover: the start of its text).
- A link line has a cone at each end with an arrow cap. A reference is a wire shape.
- The scribbles of a note are small satellites around the note.
- The user can rotate, zoom, and drag a record. Drag moves the record in the plane of the screen. It changes `p3` on the `place` link.
- Labels are DOM elements above the canvas. A frame callback moves them to their dots.

### 7.4 Search

- Press Ctrl+F (Cmd+F on macOS) to search. Press Ctrl+S (Cmd+S) to save now and make a history snapshot (the app saves by itself too).
- The search looks in the current board and in all boards below it.
- It looks in item names, body text, link labels, link groups, and stamp alt text.
- It also looks in saved web pages: a link object whose page (or PDF) is saved in the vault (`web/<key>.html`, `web/<key>.pdf`) is searched in the page text (result tag "Web page"). The app reads the files when the search opens and keeps the texts in memory while the vault is open; other results show at once, page results when they are read. A page that is saved again is read again. A click on a page result opens the saved page and finds the text in it.
- While a web page or PDF is open, ⌘F finds in that page: a bar at the top right of the reader, with the number of matches ("3 / 12"). Enter goes to the next match, Shift+Enter to the one before, Esc closes the bar. All matches have a light mark, the current one a strong mark, and the page scrolls to it. Not case-sensitive.
- Each record is searched one time only, also if it is on many boards.
- Results near the current board come first. Each result shows the path of boards to it.
- Click a result to go to it. A text result opens the item at exactly that text, marked in yellow. A note shows on its home board, centered and selected.
- Action items (top bar button): all action items of the vault in one list, like search results, with their board path. Type to filter. A click goes to the item on its home board. Its check box finishes it ("Done").

### 7.6 Groups: outline and calendar

- A group is the level below a board: if the board is the title, a group is a subtitle. A group has a title like a board (double-click it, or "Rename group"); a new group opens its title for typing. Without a name it shows "Outline" or "Calendar". It has a shape on the board, a shape in 3D, and "Export as one document…" (frame menu): one Markdown file with all its cards.
- A board that holds one group and nothing else (scribbles do not count) is an outline board or a calendar board. Its card shows the group icon.
- In 3D a group is a point above its cards, with a line to each card: an outline is a green book (on hover, a tree list of its rows), a calendar is a blue calendar that grows with the number of days that have cards. A board that is one group has the group shape.
- The export (section 8) writes the group name as a heading one level below its board, then its cards.

#### Calendar

- A calendar is a group with `type: "calendar"` and a range of months (`start`, `end`: "YYYY-MM"). Frame menu: "Months…" changes the range.
- It shows one month as a grid: Sunday to Saturday markers at the top (the week starts on Sunday, like Google Calendar), six week rows. The grid shows the last days of the month before and the first days of the month after (dimmed, with their numbers), but these days hold no cards: only cards on days of the shown month show. A card on more than one day shows its days in the shown month. A card on more than one week row looks the same in each row: it shows its text only if it is alone in all its rows. In a full day, the fold arrow of a card (▸) opens a quick view: its top stays, and it reaches the bottom of its day, over its neighbors (view state for the app session, not saved); ▾ folds it again. A double-click on a note opens it at the full sticky note size, over the calendar (it can go past its day). The fold state never moves the text of a card: a calendar card has the same padding in all states, and its tools (type, fold, edit) lie over its top-right corner on hover. The arrows in its bar show the month before or after, in the range. A double-click on the calendar opens a month field: any month; a month outside the range makes the range larger. The shown month is view state (not saved). It stays while the app is open: back from an item, the calendar shows the same month. The first month that shows is this month, if it is in the range. A calendar is not an item: a double-click never opens it as a page.
- Drag a note or a page onto a day: it snaps to the day (`day: "YYYY-MM-DD"` on its place link). A create tool (page, note, objects, board) clicked on a day makes the item on that day. Each item on a day gets the day as its date (`date`). An item without a name (or with a code name) gets a day name: "MM-DD-YYYY <type><n>", for example "09-01-2026 page1" or "09-01-2026 todo1".
- Days and time: right-click a card → "Days and time…". The dialog has "From [day] [time]" and "To [day] [time]". A day takes typed text ("YYYY-MM-DD" or "MM-DD-YYYY") or a click in a small month calendar (the button at its right). The same fields show in the item info of the item (setting "Item dates", row "Days", in place of "Date"); a valid change there saves after a short pause. There, a card with no time shows no time fields: "Add a time" shows them (a card on more than one day has no time). A card on one day shows one day field with no "From" and "To"; "Add an end day" shows the two rows.
- More than one day: "To" is a later day. The place link gets `until` ("YYYY-MM-DD", after `day`); the item date becomes the range "YYYY-MM-DD/YYYY-MM-DD". A card on more than one day has no time (the time fields are off). The card is a bar across its days, one bar for each week row. Each bar is the full card (name, and text if it is alone in its days), and each bar is clickable: a click on one bar selects all its bars; a double-click, a drag, and the right-click menu act on the card. A drop of a later bar on a day moves the card so that this bar starts on that day. Bars stack in lanes at the top of each week. A move keeps the number of days.
- Less than a day: "From" and "To" are the same day, with a time: `time` "HH:MM" (only a start) or "HH:MM–HH:MM" (no time: all day). The card shows its time before its name; cards on one day go in the order of their time (all-day cards first).
- A folded card (for example in a full day) shows its text while the user edits it: a double-click on a note opens it at the sticky note size over its neighbors.
- One card alone in its days (one day, or one bar in one week) can show its text or only its name (its fold arrow). More cards show as names. Cards of other months do not show. Drag a card out of the frame to take it out.
- An empty calendar stays. Delete (frame selected) removes the calendar; its cards stay on the board at its right side.

#### Outline

- An outline is a part of a board: an `outline` record and the cards that point to it (`outline` on their `place` links). The cards stay individual items on the board.
- The outline gives the position of each card: aligned at the left, one row under the other, with equal space between rows. A child row is indented. A tall card (an open page) pushes the rows below it down. Thus member positions are derived from the outline record and the card heights.
- Order: `rank` among the rows with the same parent. Hierarchy: `parent` is the place link of the parent row.
- Lines come from the order. They are never saved: a plain line (no caps) between rows that follow each other, and an arrow from a parent row to each child row. A pair with a relation gets no outline line.
- A frame shows around the rows. Drag the frame to move the whole outline. Its bar has the list style (none, bullets, numbers: 1, 1.2, 1.2.3), "Read as one document", and "Take all cards out".
- Change the width: right-click the frame, "Change width". Handles show at the left and right sides of the frame; drag one. Each row then ends at the new right edge (a child row is narrower by its indent). In a horizontal outline, each row changes width in proportion. Esc, "Done", or a click on the board ends the edit. The width is the width of the rows (`w` of each place link), so the data format does not change. In an outline, a folded row keeps its width.
- Make an outline: select cards, right-click, "Make outline" (reading order), or right-click the board: "New outline here". Drop a card on a frame to add it.
- Reorder: drag a row in its frame, or right-click a row: move to front, up, down, to back, one level deeper (Tab), one level up (Shift+Tab). Alt+Up / Alt+Down also move a row.
- Direction (`direction` on the outline, frame menu): vertical (default), or horizontal: the top rows go from left to right, and the child rows of each top row go down under it.
- Right-click the frame: read as one document, direction, list marks, new outline, take all cards out.
- Take cards out: drag a row out of its frame (it stays where you drop it), or use the menu. An outline with no cards is deleted.
- A text page of an outline item shows previous / next buttons, and a "Document" toggle: the whole outline as one continuous text (like a cascade of notes). Each item keeps its own text and undo stack.
- Older vaults: `list` on an item and `rank` without `outline` stay in the data. The app does not use them.
- The export (section 8) writes an outline as one block, in its order, with numbers in the headings.

### 7.5 Editor

- Images in a text: paste or drop an image file (PNG, JPEG, GIF, WebP; up to 50 MB) into the text. The app copies it into `images/` of the vault (name from the file name and a hash of its content: the same image is one file, and an existing file is never written again) and writes plain Markdown at the cursor, on its own line: `![](images/<name>)`. The editor shows the image under its Markdown; on a line without the cursor, only the image shows. Only vault images show: the app makes no network request, so a web image (`![](https://…)`) shows its address only. A card preview shows an image as `[alt]`. Size: drag the handle at the right edge or the bottom-right corner of an image (on hover). The image keeps its shape. On release, the width goes into its Markdown as in Obsidian: `![alt|320](images/<name>)` (320 px wide; at most the width of the text). Undo gives the old size back.

- The editor shows the body text of one item.
- The app has no side panel. Each open item has its own floating window above the board. You can move, resize, and close each window.
- Press Cmd+K (Ctrl+K), or right-click selected text, to make a text link (section 2.3). The right-click menu also has "Comment" and "Add web link…".
- While a text page is open, its tools are in the main tool bar, in place of the board tools: highlight, pen, eraser (with colors), the comment button, "Add a comment", "Add a note to the page", and "Link selected text". The page head has only the chapter arrows and the title (the title has the full width). The text page has a comment button (with the number of open threads) and "Add a comment". A page is the only medium-sized item: it holds small items (comments and notes). "Add a note to the page" (note button in the page head) adds a sticky note. The small items of a page show only in the page, never on the board: on the board, the page card shows a pink dot at its top-right corner while it has open (not resolved) comments. In the page, they start in a column tight at the right edge of the text (shown by default; the comment button in the main tool bar hides or shows it); the column scrolls with the text. It never makes the text narrower: it is always at the side (a narrow window scrolls sideways). Drag its right edge to change its width (setting `commentWidth`, 160–640 px). Drag the head of a comment or note to put it anywhere in the page (over the text or in the margin); its place is saved in `pageAt`, and Undo moves it back. The fold arrow of a comment folds it to its head and the first line of its text (view state, not saved). Double-click a comment or note to edit it. A comment or link attached to a card that is not a page still shows at the side of that card on the board.
- Marks: highlight, pen, and eraser buttons (page head, window bar) with four colors. Highlight marks the selected text (with no selection, each selection until Esc); the right-click menu has "Highlight" and "Remove highlight". The pen draws on the text; the eraser removes a highlight or a scribble (a click, or a sweep with the button held over strokes). Marks are in `marks/<id>.json`, never in the text. Edits move highlights; a highlight also keeps its text, to find it again after a change outside the editor. Scribbles keep their position in the text area: if the text flows again (another width), a scribble can move away from its words.
- Scribbles on a text page use the whole width of the page: the pen also draws in the margins at the left and the right of the text. The points stay in text area units (a margin point has x < 0 or x > the text width), so old marks files stay valid. In an editor window, the pen draws on the text area. The lasso (mark tools) selects scribbles: draw around them (a scribble with at least half of its points inside is selected). Drag a selected scribble (or the selection box) to move them; Delete removes them; Esc ends the selection.
- Duplicate check: if another item has the same first sentence (at least 24 characters, or 10 CJK characters), a warning shows under the head: "This text can be a copy", with "Open". It changes nothing. The X hides it until the app closes.
- Each window has its own undo stack (section 5.2).
- An item can be open in only one window at a time. If you open it again, the app brings its window to the front.
- Version 1 has no font or text color. Later: a small inline HTML subset.
- The editor must not change bytes that the user did not edit. (This is a data integrity rule.)
- Live preview: Markdown marks are hidden on lines without the cursor. Text in square brackets without a target ("[text]", "[ ]") is plain text: its brackets show, and it has no link style. A link has an address "[text](…)" or a reference label "[text][label]".

### 7.7 Plugins

- A plugin is a separate program. The core app does not compile it and does not include it. The user installs it by hand. The protocol is in `docs/PLUGINS.md`.
- The plugins folder: release builds use the folder that the user selects in Settings. The app keeps only this path, in `plugins.json` in the app config folder. Development builds use only `data/plugins` in the repository.
- The app starts a plugin program at its first call. The program stops when the app stops.
- A plugin gets only the data of its calls. It has no access to the vault.
- Plugins in this repository (each in `plugins/<name>`, with its own build): `translate` (offline translation), `chinese` (Simplified ↔ Traditional Chinese, also Taiwan and Hong Kong forms, character by character; offline; capability `convert-text`: it changes the text in place, as one command that undo reverts), `voice` (read aloud), `web` (save web pages and PDFs).
- Capability `convert-text` (for example, a script converter): the plugin menu has "Current item" / "Selected items" and "Whole board". The result replaces the item names and texts in the vault, as one command (⌘Z gives the old texts back). Code names do not change. Open editors show the new text at once.
- Capability `transform-text` (for example, a translator): the tool bar shows one button for the plugin. Its menu shows the plugin options and applies the plugin to the selected items or to all items of the board.
- The result is a **view overlay**. The plugin can send each text in parts while it works, so the result fills in at once:
  - The overlay shows in place of the item name and text on cards, outline rows, text pages, and editor windows. A chip "Show original" removes it.
  - The overlay is in memory only. It is never written to the store, to files, or to history. It goes away when the vault closes.
  - "Show originals" hides the overlays. They stay as a cache: "Show translations" (or "Show translation" on a page) shows them again at once. The same text with the same options is never sent again.
  - The result shows in place of the text, or side by side: the text at the left (it can be edited), the result at the right. Side by side is paragraph-aligned: each result paragraph starts level with its paragraph (blank-line blocks; a heading, a list item, a quote, and a code block are blocks of their own). The shorter side of each row gets empty space; it is not text and is not saved. Both sides scroll as one. If the plugin joined or split paragraphs, they pair in proportion. While it reads aloud, the sides are not aligned. The divider can move (20 % to 80 %). A double-click sets it to half and half. The layout and the divider position are vault settings.
  - Cards on a board always show the result in place of their text.
  - A saved web page or PDF: "This page" (plugin menu, while the page is open) translates the page paragraph by paragraph (each line of the page text) into a column at the right of the page, on the reader canvas: it scrolls and zooms with the page. Each result starts level with its paragraph; a long result pushes the next one down. "Hide translation" hides the column. Results stay while the app is open; they are never saved. The column is 660 page units wide (setting `translationWidth`, 240–1600). Drag its right edge to change the width. While the page is read aloud, the matching sentence of the translation has a mark too (the sentence with the same number in the paragraph; if the numbers of sentences are different, the sentence at the same place).
  - Selected text: the result shows in a pop-up panel (as before), in both layouts.
  - "Do not translate" (plugin menu of a translator): the same choices as "Do not read" of read-aloud (citations of each style, text in round or square brackets, the reference list or parts of its entries). It is its own setting (`translateSkip`). The skipped parts stay in the result as they are: the app sends them to the plugin as markers ("⟦1⟧") and puts them back in the result (also in partial results). A marker that the plugin lost: its part goes at the end. A line with only markers (a skipped reference entry) is not translated at all. A change of these choices makes older results old (they are made again).
  - In place of the text, the text cannot be edited. If the original changes after the result (for example, in the side-by-side view), the chip shows "Outdated". A click makes the result again.
  - "Save to a file" in the plugin menu writes a Markdown file at the location that the user selects. The vault does not change:
    - "Multilingual version of this page / board": each item with its text, and after each line the translated line.
    - "All translations of this session": each item with a result (shown or hidden), with its translated name and text.
  - Selected text in a text, a translation, or a saved web page gets a "Translate" button. The result shows in a panel that stays open (also after new selections) until its X. Drag its top bar to move it. It is not kept.
- Capability `speak-text` (read aloud): the plugin menu has "Read aloud" and "Save audio file…" for the selected note or the open page.
  - The app plays one sentence at a time and marks it in the text (a strong yellow mark; the other sentences are dimmed). The text window opens, read-only.
  - The sentence that is read always has a highlight in the text: it is the reading cursor. "Subtitle" (a check box in the Read aloud menu) adds a large subtitle; the highlight stays.
  - The subtitle shows the sentence large. The subtitle floats in its own window above all apps ("Float above all apps", default), or above the board. The user drags the floating subtitle to move it, and its edges to change its width. Release builds keep its position in `subtitle.json` in the app config folder. A click on its close button hides it until the reading ends. "Show the translation too" (under "Subtitle"; setting `subtitleBoth`) shows the matching sentence of the translation under the sentence, smaller (or of the original, when the translation is read). Web pages use the translation column; items use the plugin result, line by line.
  - With a plugin result (a translation), the voice reads English: the original of an English text, or the translation of a text in a different language (the text with more Latin letters). The side that is read marks the sentence. The other side marks the matching line (a translation keeps the lines). A click on a line of the other side reads from there.
  - If text is selected in the item, reading starts at the selection. While it reads, a click on a sentence goes to that sentence.
  - Keys while it reads: Left and Right go to the previous and next sentence. Ctrl, ⌘, or Option + Left and Right change the speed by 0.1 (macOS can use Ctrl + arrows to switch desktops before the app gets them). Keys in text fields are not used. Keys on a slider are used (the slider does not move).
  - Speed: 0.5 to 3 times.
  - Voice-out mode (vault setting `speechMarkdown`): "Markdown" reads without Markdown marks (#, **, links, tables); "Paper" also does not read the reference list; "Auto-detect" (default) uses Paper for a text with a reference list, Markdown for a text with Markdown marks, else reads the text as it is. Older values: "always" is Markdown, "never" is Auto-detect.
  - "Do not read" options (vault settings): author–date citations (APA, Harvard, Chicago), author–page citations (MLA), numbered citations (IEEE, Vancouver), all text in parentheses or square brackets. Reference lists (after a heading such as "References" or "Bibliography"): skip the list, or read each entry without its authors, dates, page numbers, or links. The rules change only the words to say. The mark stays on the full sentence.
  - The Read aloud menu shows a rough time to listen: the words of the text that it reads (from the selected text, or all) at 165 words a minute, divided by the speed. While it reads, the bar shows the time left.
  - Buffer: the app asks the plugin for the current sentence first, then for the next ones. At most 2 requests run at the same time (the voice plugin has 2 offline models: it makes 2 clips in parallel). A long sentence is made while the ones before it play. "Audio ahead" (Read aloud menu; setting `speechAhead`):
    - "About 1 minute" (default): until about 900 characters of speech are ready ahead (2 to 20 sentences). A step or a stop wastes little work, and memory stays small.
    - "To the end, while it plays": all sentences to the end of the text, while it plays.
    - "All audio first, then play": the bar shows "Making the audio: n / total"; it plays when all clips are ready. The clips stay until the reading ends, so a step back is at once.
  - A bar shows play, pause, sentence steps, speed, and volume. A pause holds the reading also between two clips (or while the next clip is made): nothing plays until "Play". Speed and volume apply at once. A change of a plugin option (the voice, the pitch) while it reads plays the current sentence again with the new option. Their values are vault settings.
  - The audio is in memory only. "Save audio file…" lets the plugin write one file at the location that the user selects. It uses the skip rules too.
  - If the text of the item changes, reading stops.
- The selected plugin options are vault settings (`pluginOptions` in `.inspoboard/settings.json`).
- Plugin actions (for example, "Download pack") show in Settings → Plugins. They run only when the user clicks them. The details of each plugin (description, actions) are folded: the arrow button next to "Read the plugins folder again" and "Select the plugins folder" shows them. Errors and running tasks always show.

### 7.8 Web pages

- With a plugin that has the capability `save-page`, the app saves web pages and PDFs from the web in the vault. The core app has no network code: the plugin gets the page.
- PDF files from this computer: the globe button → "Open a PDF file…" copies the PDF into the vault (`web/<key>.pdf`, key from its content) and opens it. No plugin is necessary.
- The PDF reader (PDF.js, loaded when the first PDF opens) shows the pages with a text layer. It has the same tools and canvas as the web page reader. Page units are PDF units at scale 1, so notes stay on the page at any zoom. A zoom shows at once; the pages draw again at the new scale after a short pause. PDF.js data files (character maps, fonts) come from `public/pdfjs` (copied from `node_modules` before dev and build); no network. Scripts in a PDF never run.
- A click on a link (⌘-click in a text, a double-click on a link object, a link in the comment column) opens a web address in the default web browser: the app downloads nothing, and the browser (not the app) uses the network. Open a page in the reader: the context menu of a web address or link object ("Download and open website locally"), or the globe button in the tool bar.
- The first time, the plugin saves the page (with progress and Cancel). The app writes it to `web/<key>.html`. The key is the first 24 hex digits of the SHA-256 of the address without its fragment. Later, the saved copy opens without network and without the plugin. "Save the page again" gets a new copy.
- While a page or PDF is open, the main tool bar shows the reader tools in place of the board tools: close, read, select, highlight, pen, eraser, comment, note, four colors, undo and redo, zoom, margin, read from the start, save again.
- The page is on a canvas with a margin at each side. The whole canvas zooms (buttons, ⌘+ ⌘- ⌘0, pinch, Ctrl + wheel); a web page does not flow again. The margin width: the "Margin" field (px at each side). Empty is automatic: no margin if the page has wide sides without text (180 px or more), else 260 px.
- Comments (dark, pink text, the user signature) and notes (paper color) go on the canvas: on the page or in a margin. Drag the head to move one; double-click to write; the eraser or the trash button removes one. As on the board, a click on the comment or note tool makes one item: then the reader goes to Select. A double-click on the tool keeps it on (a dot under the button); typing in the new item ends it too. A click outside finishes the item. The text saves while it is typed, and when the editing ends in any way. Scribbles can go on the page and in the margins.
- A web page shows at a fixed width (saved in the notes file with the first change), as tall as its content, so that scribbles stay on their words.
- A link object shows its full name (without a name: the full address without "https://"). It is as wide as the name, up to 480 px, then the name goes on more lines. In a calendar or an outline, the row size stays and the name is cut (without a name: the host only).
- A saved page with notes (a highlight, a scribble, a comment, or a note on its canvas) is local from then on: its link object is solid blue, and a click on its link (double-click on the link object, ⌘-click in a text, a link in the comment column) opens the saved copy, never the live web page. The link menu keeps "Open in web browser". The app knows it from `web/<key>.notes.json` (no new data).
- Highlights stay on their text: each one keeps its range in the page text and its exact text. If the range no longer has that text, the highlight goes to the place of that text nearest to the old range; if the text is not on the page, the highlight does not show (it is kept in the notes file).
- "Save again from the web" on a page with notes asks first: the new copy replaces the saved one (the old copy is not kept), and scribbles, comments, and notes keep their places on the canvas.
- Lazy-load images (for example the figures of bioRxiv): the plugin saves the real image (`data-src`, `srcset`), and replaces the lazy-load classes (`lazyload`, `lazy`, …) with `lazyloaded`, because the page styles hide an image that has no "loaded" class and the saved page has no scripts. For pages saved before this, the reader does the same in the shown page only (the file does not change).
- The reader shows the page above the board, in a frame. The page has no scripts (the plugin removes them) and its content security policy blocks scripts and all network access. The frame allows scripts only because WebKit runs no event listener of the reader (click to read, selection) in a frame without that permission.
- "Read aloud" in the plugin menu reads the open page or PDF: from the selected text, or from the top. "Read aloud" on a link object (its menu, or the plugin menu with the link selected) saves its page if necessary, opens it, and reads it from the top.
- If it cannot read, the reader says why (no Read aloud plugin, no text on the page).
- Read tool (default): a click on text reads aloud from there (needs a `speak-text` plugin). The spoken sentence has a strong mark and stays in view. Menus, page heads and feet (outside the article), and hidden parts are not read.
- Links: ⌘-click saves and opens the linked page. A click on a "#" link goes to that part of the page.
- Highlight tool (select text), pen tool (draw), and eraser (click a scribble, a highlight, a comment, or a note; or hold the button and sweep over strokes and highlights). Four colors. The reader has its own undo and redo (⌘Z and ⇧⌘Z). These notes are in `web/<key>.notes.json`: a highlight keeps its text range and its text (to find it again); scribbles and margin items keep page coordinates (a left margin has negative x); optional `margin` and `width`. Old notes files stay valid. The page file never changes.
- Marks (highlights and the spoken sentence) are boxes drawn over the text. Only the sentence that is read now has the spoken mark.
- The time machine includes the `web/` folder.

---

### 7.10 Light and dark mode

- Settings → "Theme": System (follows the computer, and changes with it), Dark (default), or Light. The sun/moon button in the top bar changes between light and dark (zen mode button "Light / dark mode"). The setting is in the vault settings (`theme`).
- The Settings dialog shows short setting names; the details of a setting show as its tooltip (a dotted line under the name).
- Settings → "Page width" (px, 360–2400, default 760; setting `pageWidth`): the width of the text on a text page. The same width changes with a drag on an edge of the text (both edges; the text stays centered); a double-click on an edge gives 760. The field shows the new width.
- A text page scrolls on after the end of the text until the page is empty: the last line can go to the top and out of view.
- Settings → "Font weight": one slider, from 300 (light) to 700 (bold), 400 by default (double-click the slider: 400). It changes the weight of the UI text (menus, buttons, panels). The setting is in the vault settings (`uiFontWeight`).
- The app sets `data-theme` on the root element. All UI colors are tokens in `src/ui/theme/theme.css`; the light theme gives other token values. Card kinds keep their own colors (notes, pages, comments, links, flashcards). A board with its own background color keeps it.

### 7.9 UI language

- Settings → "Language": English or 中文（简体）. The setting is in the vault settings (`uiLanguage`, a language code). An unknown code shows English.
- The source text of the UI is English. A language pack (`src/ui/i18n/<code>.json`) maps English text to the text of its language. The packs are part of the app, not plugins. To add a language, add a pack and a line in `UI_LANGUAGES`.
- A key can have places for values: `"Undo {0} (⌘Z)"`. In the pack text, `{0}` puts the value as it is (user text), and `{t0}` puts the value after translation (a UI word, for example a command name).
- The app changes only the screen: the text and the tooltips (`data-tip`, `title`, `placeholder`, `aria-label`) of the UI. User text never changes: cards, names, pages, comments, editors, inputs, web pages, PDFs, and each element with `translate="no"`. Nothing is written to the vault.
- Text that is not in the pack stays English. The native menus of the app (Vault, View) stay English.

## 8. Linearization and export

The app can sort all core data into one linear document.

1. Start at the root item.
2. Write the item name as a heading. The heading level is the depth.
3. Write the body text.
4. Sort the children in outline order (section 7.6). Without ranks, this is reading order: by `y` in bands, then by `x`.
5. Do steps 2 to 5 for each child.
6. If the walk finds an item a second time, write "See: <name>". Do not write the item again.
7. Write the links as a list after each item.

The output is Markdown. A Word (`.docx`) export uses this Markdown output.

---


### 8.1 Board bundles (export and import)

- Export: right-click the empty board, or a group frame (outline, calendar) → "Export this board as a bundle…" (the open board); or right-click one card → "Export as a bundle…" (that item and all in it). Choose a folder. The app makes a NEW folder in it (named after the board; " 2", " 3", … if the name is taken). It never writes into a folder that exists, and never into the vault.
- The bundle has two versions of the board:
  - `<board name>.md`: the board and all in it as one linear Markdown document (section 8). Images link to `images/`.
  - The board data in the vault format: `vault.json` (root: the board item), `table/*.jsonl`, `items/*.md`, `images/`. It has the board, its cards, its inner boards (all levels), groups, scribbles, comments, notes, replies, and the relation links between these records. A text link or an attachment to a record outside the board becomes plain text. The folder also opens as a vault.
- Right-click the empty board → "Import a board bundle here…". Choose a bundle folder. The bundle board goes onto this board as a card at that point.
- Import only adds records. Each record gets a new ID; text links and groups follow the new IDs. No record of the vault is replaced or changed. One Undo removes the import. Images go into `images/` of the vault (an existing image file is never written again).
- Not in a bundle: highlights and scribbles on a text (`marks/`), and saved web pages (`web/`).

## 9. Technology

| Part | Package | Why |
|---|---|---|
| Desktop shell | Tauri 2 | Small, local, macOS and Windows. |
| Folder selection | `tauri-plugin-dialog` | Native folder dialog. |
| Menu | Tauri menu API | Vault menu: open, new, close. |
| Atomic files, lock, watch | Rust: `std`, `notify` | Integrity code stays in a small, strict layer. |
| History | Rust: `git2` (with bundled libgit2) | The user does not need Git installed. |
| UI | React, TypeScript, Vite | Largest set of usable packages. |
| App state | Own `Store` class + React `useSyncExternalStore` | No state package needed. The store holds the tables. |
| 2D board | `@xyflow/react` (React Flow) | Controlled component: our store stays the single source. MIT. |
| Freehand | `perfect-freehand` | Smooth strokes, small code. |
| 3D | `three`, `@react-three/fiber`, `@react-three/drei` (Line, OrbitControls only) | Standard three.js stack. |
| Editor | CodeMirror 6 | Keeps the exact bytes of the text. Obsidian uses it. |
| Icons | `lucide-react` | Clean icon set. |
| IDs | `nanoid` | Short random IDs. |
| Tests | `vitest` | Unit tests for the core. |

Changes from the first proposal:

- **tldraw → React Flow.** tldraw has its own store and its own undo stack. That makes a second source of truth (breaks P1).
- **Milkdown → CodeMirror 6.** Milkdown can rewrite Markdown marks when it saves (breaks P2).
- **SQLite → none.** An index in memory is enough for 1000 items (P5).
- **JSON Canvas → own tables.** JSON Canvas puts layout in each board file. Our model keeps all placements in one flat table (P1).

---

## 10. Code structure

```
src-tauri/src/
  main.rs          Command registration only.
  vault_fs.rs      Atomic write, read, path guard (no access outside the vault).
  vault_lock.rs    Lock file.
  vault_watch.rs   Watch for outside changes.
  history.rs       Git snapshots. No push function.
  plugin_host.rs   Start plugin programs. JSON lines on stdin and stdout.
src/
  core/            Pure TypeScript. No React. No Tauri.
    types.ts       Record types.
    ids.ts         ID generation.
    store.ts       Tables in memory. Body text is the "texts" table.
    commands.ts    Ops, history, undo, redo.
    actions.ts     Command builders. One for each user action.
    graph.ts       Derived data: children, parents, relations, inline references, ghosts.
    refs.ts        Read inline references from Markdown.
    search.ts      Section 7.4.
    format.ts      Encode and decode vault files. No I/O.
    validate.ts    Schema and reference checks.
    problems.ts    Problem type.
    linearize.ts   Section 8.
  io/              Bridge between core and Tauri.
    vault.ts       Load and save.
    persist.ts     Dirty set and timers.
    plugins.ts     Plugin protocol: read and check plugin replies.
  ui/
    app/           App root, workspace, top bar, tool bar, banners, shortcuts, session hooks.
    board/         React Flow adapter: board model, nodes, edges. Only this folder imports @xyflow/react.
    galaxy/        3D view: galaxy model and three.js adapter. Only this folder imports three.
    editor/        CodeMirror adapter and live preview. Only this folder imports @codemirror.
    windows/       Floating editor windows and the full text page.
    dialogs/       Item picker and search.
    tools/         Tool registry, draw overlay, stroke helpers.
    plugins/       Plugin menu, plugin settings, view overlay.
plugins/<name>/    Plugins. Each one is a separate project with its own build. Not part of the app build.
    theme/         Dark theme tokens.
```

Dependency rules:

- `core` imports nothing from `io` or `ui`.
- `ui` changes data only through `core/commands.ts`.
- Only one adapter folder imports a given third-party package.

### 10.1 Code style

- One function does one job. Keep functions short.
- Use full, clear names. Do not use abbreviations except `id`.
- Do not catch an error and ignore it. Show it or stop.
- Use TypeScript strict mode. Do not use `any`.
- Write comments in STE: short and active.
- Each core module has unit tests.

---

## 11. Open points

None.
