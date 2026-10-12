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

### 1.1 Design rule: sizes

Items have three sizes: small (note, comment, web link, action item, flashcard, quote), medium (a page, and the saved web page or PDF of a link object), and large (a board). A text card is not a small item: it is its own thing (a free text on a board).

- **A larger item is a free-form board for smaller items.** Each small item can go on a board, in a page, and in a saved web page or PDF, in the same way: one "small item" button with a list of all small kinds, then a click anywhere on the surface (on the text or in a margin). The same tools work on each surface.
- **A small item in a medium item is inside it.** It is a vault item with an "inside" link from its home (not a board placement: the home stays a page or a link object). It shows only in its home. It goes to the trash with its home and comes back with it. It can move out to a board, and a card can move in (one undo step each).
- **A small item made by a click always stays**, also when it is empty. Only Delete (or the eraser) removes it; a double-click edits it, never deletes it.
- **The keys of the small kinds** (N note, M comment, W web link, I action item, F flashcard, Q quote) choose that kind in the small-item button while a page or a saved web page / PDF is open (on a board they choose the board tool).
- **Two sides of a medium item.** The right side is for batch text and manual notes: the translation column, comments, and notes. The left side is for automatic annotations and short texts: the words of formulas (the LaTeX button), and later the notes of a question-and-answer agent.
- **A small item can point to text in its home.** It points to text only if text is selected at that moment (an old selection does not count). If text is selected when the item is made, the item points to that text: a faint dashed curve from the item to the text, stronger while the item is hovered or selected. The link bench points an existing item to text. The unlink button in the head of the item ends the pointing (one undo step).
- **A saved web page or PDF is a copy of a document.** It belongs to one link object: its file, its highlights, its scribbles, and its small items. Two link objects with the same web address have two independent copies. A copy of a link object copies all of them.
- A comment on a card on a board stays attached to that card (field `on`). A reply stays in its thread (field `on`).

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
- Object fields (all optional): `url` (the web address of a link object), `author` (the signature of a comment: Settings → Your name; only a name, not an account), `on` (the item that a comment or link is attached to: a card that is not a page, or the comment that a reply answers), `quote` (a comment on a passage: an exact text in the body of `on`), `resolved` (a resolved comment thread), `pageAt` (older vaults only: the place of a small item in a page; now in its `inside` link), `trashed` and `trashedFrom` (an item in the trash: section 5.4).
- A reply is a comment item with `on` = the comment it answers. It has no placement: it shows in its thread. It is not an unplaced item.
- `background` (optional): the background of the board of the item. A color `#rrggbb`, or an image path `images/<name>`. The vault setting `defaultBackground` applies to boards without their own background. `backgroundWidth`, `backgroundCenter`, `backgroundFixed` (optional): from an older background mode (the image moved with the cards). They stay valid and are kept, but the app does not use them now (section 7.1).

### 2.2 Link kinds

| Kind | Meaning | Kind-specific fields |
|---|---|---|
| `place` | Record `to` is shown on board `from`. | `x`, `y`, `w`, `h` (2D layout); `p3` (3D position, optional); `view`; `expanded`, `color`, `ref`, `outline`, `parent`, `rank`, `day`, `until`, `marks` (quote cards), `time`, `shape`, `shapePath` and `filled` (group cards: section 7.12) (all optional) |
| `link` | Item `from` refers to item `to`. | `label`, `group`, `start`, `end`, `quote` (a passage of the target), `fromQuote` (a passage of the source that its text cannot hold: section 7.11) (all optional) |
| `inside` | Small item `to` is inside medium item `from` (a page, or the saved web page or PDF of a link object: section 1.1). `from` does not become a board. | `view` (the kind of the small item); `x`, `y` (its place: a page: px from the top-right corner of the text; a saved page: page units, a left margin has negative x; both missing: in the comment column of a page); `w`, `h`, `color`, `expanded`; `quote` (the text of the home that it points to) and `at` (where that text starts, a string index) (all optional but `view`) |

A link has no body text (P5). To describe a link with more text, make an item and link to it.

- Older vaults: a comment or note of a page is an item with `on` = the page, `pageAt`, `quote`, and a card next to the page. The app shows it as inside the page. Its first change makes it an `inside` link (one undo step). The script `scripts/migrations/inside-links.mjs` changes all of them at once (section 3.3).
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
  - `quote`: a passage on newsprint paper (pale yellow, dark gray serif text), framed by quotation marks: a large opening mark at the top left and a closing mark at the bottom right, inside the card. A slim card, 320 × 72 by default: small top and bottom edges; the height grows with the text (the saved height is the least height). The edges can be dragged (any width and height). The text is the passage; the name is its source, shown under it ("— source"); the source can be empty. Double-click (or "Edit text") writes the text; "Edit source" writes the name. The marks (`marks` on the place link): `en` ‘ ’, `cjk` 「 」 (Traditional Chinese, Japanese), `zh` “ ” (Chinese), `es` « » (Spanish, French), `none`. Right-click → one line "Marks" with the five choices. Without `marks`, the marks follow the text: CJK text gets 「 」, other text ‘ ’. Folded ("Fold into a bubble", the button on hover, or `expanded` not true): a small gray speech bubble with the first two words (two characters of CJK text); a double-click unfolds it and starts the text edit, like a folded note. Export: a Markdown quote, with "— source" on its last line.
  - Objects keep their type: the note / page / board button does not show for them.
- `group`: a group card, a loose area of the board (section 7.12). It keeps its type too.
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
  web/<id>.html         The saved web page of link object <id>: one file, its images and styles inside (section 7.8). Optional.
  web/<id>.pdf          The saved PDF of link object <id> (from the web, or from a file on this computer). Optional.
  web/<id>.notes.json   The user's highlights and scribbles on that copy. The page file never changes for them.
  web/<hash>.*          Older vaults: one shared copy for each address (hash: 24 hex digits). The app still reads it.
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

### 3.3 Migrations

| Script | Format | What it changes |
|---|---|---|
| `scripts/migrations/inside-links.mjs` | 1 → 2 | Comments and notes of pages become `inside` links (their cards next to the page go). Each link object gets its own copy of its saved page (`web/<id>.*`). The old notes of an address go to its oldest link object; their comments and notes become vault items inside it. Old shared files stay. Section 1.1. |

- Run: `node scripts/migrations/inside-links.mjs "<vault folder>"` (dry run), then with `--apply`. The app must be closed. `--apply` copies the vault (all but `.backup`) to `.backup/<time>_before-migration` first (the backup menu lists it), then reads the vault again and checks it.
- The app reads format 1 and format 2. A format-1 vault works without the migration: the app shows the old forms, and changes one item at a time to the new form when the user changes it.

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
- An attached object (a reply, a comment on a card) is never in the trash. A small item inside a page or a link object is not in the trash by itself: it goes to the trash with its home and comes back with it. "Delete forever" of the home deletes the small items in it. The root item is never in the trash. The items on a board in the trash stay on that board: Restore of the board brings them back too.
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
- Backups (top bar, archive button; or "More" → "Backups…"): a menu with "Back up now" and the list of backups (the newest first: local time, size, the total size). Each backup: "Show in Finder", and Delete. Delete asks first, then deletes the folder for good (it does not go to the trash; the vault does not change). Only a folder directly in `.backup` can be deleted. Migration backups (`<time>_before-migration`) are in the list too.
- Back up now: the app saves all changes, then copies `vault.json` and the data folders into `<vault>/.backup/<YYYY-MM-DD_HH-MM-SS>/` (UTC). A backup is a plain folder: to restore, copy its files back. A message shows the folder and the size. If the backup is larger than the limit in Settings ("Backup alert", default 1 GB), the message is a warning. Snapshots never hold `.backup`.

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
- To change the name of a card, select it and press Enter or F2.
- Copy and paste: ⌘C (or Ctrl+C) copies the selected cards, ⌘V (or Ctrl+V) pastes new items, copies of them, on the open board (any board): under the pointer, or next to the copied cards (each paste a little further). For now only small items (note, text, comment, web link, action item, flashcard, quote) and pages can be copied; boards, outlines, calendars, and scribbles are left out (a short message says so). A new item gets the name, the text, the date, the web address, and the signature, and a card of the same kind, size, color, and fold state. It is a free card (not in an outline or calendar, not attached). In its text, a link to a relation link becomes plain text; a link to an item stays. Highlights, scribbles, comments, and links stay with the copied item. The copy is taken at ⌘C. One paste is one undo. With text selected, or in a text field, ⌘C and ⌘V work on the text. The text of the copied cards also goes to the system clipboard. Double-click the board name in the breadcrumb to change it.
- Link tool: click the first item, then the second item. To link to an item that is not on the board, right-click (anywhere on the board) or click "Search…" after the first item: a search of all boards (names and texts) opens. A click on a hit makes the link; a hit in a text links to that text (`quote`). The new link shows as a stub. A link from selected text ("Link selected text", existing item) works the same: right-click on the board opens the search of all boards.
- Release builds show no browser menu ("Inspect Element") on a right-click. Text fields keep it (copy, paste).
- To move records into a board, drag them onto a board card (it shows a dashed outline), or use "Move into…" and select the board. One command. Only the place links change. The records keep their layout relative to each other and go to the right of the cards that the board has.
- The breadcrumb shows the path you used, not a tree path. While a web page or PDF is open, a click on a board name in the breadcrumb (also the current board) closes the page and shows that board.
- Back and Forward (top bar, Cmd+[ and Cmd+]) go through the board views, as in a browser. View history is not saved and is not part of undo.
- Right-click a card (or the selection) for its menu: open, edit text, open home board, move to board…, make outline, take out of outline, take scribbles out.
- Right-click the empty board for the background: an image for this board or for all boards, or remove a background. The app copies the image into `images/` of the vault (simple name plus a content hash, atomic write). History snapshots include `images/`.
- A background image stays still: it fills the view behind everything (cover, centered), in 2D and in 3D. A color fills the whole view. (An older mode, in which the image moved and zoomed with the cards, is removed. Its fields `backgroundFixed`, `backgroundWidth`, `backgroundCenter`, and the setting `defaultBackgroundFixed` stay valid and are kept in the files, but the app does not use them.)
- The color manager (tool bar) sets the board background color (this board or all boards) and the color of the selected cards.

### 7.2 Toolbar

The tool bar is at the top, below the breadcrumb bar. Each tool is an entry in the tool registry. To add a tool, add one entry.
At the right, the tool bar shows controls for the selection: view style, link label and group, stamp alt text.

Order (dividers between the groups): select, lasso | page, large items, small items | scribble, eraser, text (and the pen colors while the scribble tool is on) | link, show an item here (+) | color | 2D/3D, Document | web pages, plugins. Search has no button: ⌘F. While a web page or PDF is open, the reader tools replace the board tools (section 7.8).

| Tool | Result |
|---|---|
| Select (arrow) | Select, move, and resize. Click and drag on empty space to select with a box. |
| Select (lasso) | Draw a free shape to select. |
| Create page (P) | Create an item and a `place` link with `view: page`. |
| Create board, outline, calendar, or group (one button with a list, board icon; the list shows names only) | Board (B): an empty board, an item with `board: true` (double-click it to enter). Outline (O): a new outline with one page. Calendar (Y): a new calendar (this month and the next two). A new group opens its title for typing. Group: a submenu (the pointer on it, or a click, opens it at its side) with Rectangle (G), Ellipse, and Free shape: section 7.12. |
| Create note (one button with a list, note icon; the list shows names only) | Note (N). Comment (M), web link (W): click a card to attach it, or empty space. Action item (I), flashcard (F), quote (Q): click empty space. |
| Scribble | Draw strokes. All strokes until Esc or a tool change go into one stamp. |
| Eraser | Drag over strokes. Each stroke that the eraser touches is erased fully. A stamp with no strokes is removed. |
| Text | Create an item and a `place` link with `view: text`. |
| Link | Drag from one record to a different record to make a `link`. A new link has no arrows (`end: "none"`); the link menu changes the caps. |

- Cards: the title is one line (a long title ends with "…"). Exception: an open page card shows its whole title (a long title wraps). On hover, the type icon, the fold arrow, and the edit button show at the right end of the title row: the title does not move.
- Notes: right-click → "Gray out" (card color `#a1a1a6`) or "Yellow note" (the default, no color).

- Zen mode: View › Zen Mode (below Enter Full Screen, ⌃⌘Z). The top bar and the tool bar hide, and the board fills the window. Zen mode is in the More menu (⋯) of the top bar; its icon is an ensō (a brush circle). Only the buttons in the vault setting `zenButtons` show, in one small bar at the top (Settings → Zen mode buttons; default: back, undo, redo, select, scribble, eraser, text). Esc ends zen mode when Esc has no other use (no text input has the focus, no menu or dialog is open, no tool is on). The button at the left end of the bar also ends it. Zen mode is not saved. Settings → Zen mode lists the buttons.
- Top bar, More menu (⋯, at the right of the top bar): action items, link bench (show or hide), trash, back up, and zen mode, then "Choose the top bar buttons…". Settings → Top bar → "Always show in the top bar" puts any of them in the top bar (vault setting `topBarButtons`, default none); then the More menu does not list it. The More button does not show when all of them are in the top bar.
- Settings has a tab for each section, in a left column: Appearance (theme, font weight, language), Cards and pages (page width, item title, item dates), Top bar, Zen mode, Name and backups (your name, backup alert), Plugins. The More menu entry "Choose the top bar buttons…" opens Settings at Top bar.
- Scribble colors: while the scribble tool is on, the tool bar shows five ink colors: ink (black or white, as the theme), yellow, green, pink, blue (the pen colors of pages). The choice is the vault setting `scribbleColor` (missing or null: ink). A new scribble gets the color as its card color (`color` on its place link); a new color starts a new scribble. Right-click a scribble → "Scribble color" changes it; the Colors button (card colors) also changes selected scribbles. Old scribbles have no color: they show in ink.
- A tool that makes one thing (note, page, board, text, objects, groups) goes back to Select after one use. A double-click on the tool (or on its entry in a list) keeps it on: for example, click many times to make many pages. A dot under the button shows this. Esc or a different tool ends it. Typing in a card (its name or its text) also ends it: the next click finishes the card, it does not make a new one.

Dialogs and tool bar popovers (Settings, plugin options such as Read aloud, "Read a web page", search lists) open fully in the window: if a part is outside, the panel moves in. A drag on the title moves the panel; the title stays in the window. The position is not saved.

### 7.3 Galaxy (3D)

- The galaxy shows the children of one item at their `p3` positions.
- A child with no `p3` gets its x and y from the 2D board. Its depth (z) is spread from its place ID (fixed, pseudo-random), up to 0.6 × the larger side of the cards' area, so that many cards fill a volume. Cards in an outline or a calendar stay in the plane. A drag saves `p3`. The background image lies behind the deepest card.
- Each child that has children shows them as a small cluster around it. The depth limit is 2.
- Each record is a dot with a small tag or icon. The name shows on hover and near the camera. A note with no name shows no label (on hover: the start of its text).
- A link line has a cone at each end with an arrow cap. A reference is a wire shape.
- The scribbles of a note are small satellites around the note.
- The small items inside a page or a link object (section 1.1) are satellites of it, with a line to each (as the cards of a group). They cannot move in 3D (they have no card).
- The user can rotate, zoom, and drag a record. Drag moves the record in the plane of the screen. It changes `p3` on the `place` link.
- Labels are DOM elements above the canvas. A frame callback moves them to their dots.
- Two buttons at the bottom left (no help text there): Reorient (compass) moves the camera back to the front view of the board, at the middle of its cards, in a short animation. Explode (sparkles) gives the cards with no `p3` a new random spread (depth, and a small move in x and y), and the dots move to their new places in a short animation. Cards with `p3` (placed by hand) do not move. The spread is view state: it stays while the app is open, and nothing is saved until the user drags a dot.
- A group card (section 7.12) is a volume around its cards: its shape at the back and at the front of the depth of its cards (with a small margin), and four lines between them. With no cards (or all in one plane) it is a flat shape. Outline only: dashed lines. Filled: solid lines and a clear volume in its color. It has a small dot in its middle (drag the dot to move it). The shape does not take the pointer: a drag on it turns the view.
- Right-click a dot of this board: "Delete" takes the card off the board (as Delete in 2D). For a group card, also "Look" (Outline only, Filled). A dot of a board in this board, and an outline or calendar point, have no menu.

### 7.4 Search

- Press Ctrl+F (Cmd+F on macOS) to search. Press Ctrl+S (Cmd+S) to save now and make a history snapshot (the app saves by itself too).
- The search looks in the current board and in all boards below it.
- It looks in item names, body text, link labels, link groups, and stamp alt text.
- It also looks in saved web pages: a link object whose copy is saved in the vault (`web/<id>.html`, `web/<id>.pdf`; older vaults: the shared copy of its address) is searched in the page text (result tag "Web page"). The app reads the files when the search opens and keeps the texts in memory while the vault is open; other results show at once, page results when they are read. A page that is saved again is read again. A click on a page result opens the saved page and finds the text in it.
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
- Less than a day: "From" and "To" are the same day, with a time: `time` "HH:MM" (only a start) or "HH:MM–HH:MM" (no time: all day). The card shows its time before its name; cards on one day go in the order of their time (all-day cards first); cards with the same time (or no time) go in the order that the user dragged them into (`rank` on the place link), else in the order they were made. Drag a card to a new place in its own day to change the order (one undo step). A move to a different day takes its order away.
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
- ⌘B (Ctrl+B) bold, ⌘I italic, ⌘U underline: marks around the selected text (`**bold**`, `*italic*`, `<u>underline</u>`), or away if it has them. Markdown has no underline: `<u>…</u>` is the usual form; the editor shows it underlined.
- Press Cmd+K (Ctrl+K), or right-click selected text, to make a text link (section 2.3). The right-click menu also has "Comment" and "Add web link…".
- While a text page is open, its tools are in the main tool bar, in place of the board tools: highlight, pen, eraser (with colors), the comment button, the small-item button, and "Link selected text". The page head has only the chapter arrows and the title (the title has the full width). A page is a medium-sized item: it holds small items (section 1.1). The small-item button has a list of all small kinds (note, comment, web link, action item, flashcard, quote, text): choose one, then click anywhere on the page (on the text or in a margin): the item is made there, inside the page (an `inside` link). A double-click on a kind keeps the tool on until Esc. Text that is selected when the kind is chosen: the item points to it. "Comment" (right-click selected text) makes a comment that points to the text, in the column. An item that points to text has a faint dashed curve to the end of that text (stronger while the item is hovered); the link bench can point an item to text later (section 7.11). Drag the head of a small item onto the board (outside the page): it moves out and becomes a free card there (it stops pointing to text). Drag a small card from the board onto an open page: it moves into the page. One undo step each. A note (in a window) is a small item: it has attached comments (`on`), not small items. The small items of a page show only in the page, never on the board: on the board, the page card shows a pink dot at its top-right corner while it has open (not resolved) comments. In the page, they start in a column tight at the right edge of the text (shown by default; the comment button in the main tool bar hides or shows it), by the place of the text that they point to, then by time; the column scrolls with the text. It never makes the text narrower: it is always at the side (a narrow window scrolls sideways). Drag its right edge to change its width (setting `commentWidth`, 160–640 px). Drag the head of a comment or note to put it anywhere in the page (over the text or in the margin); its place is saved in its `inside` link, and Undo moves it back. The fold arrow of a comment folds it to its head and the first line of its text (view state, not saved). Double-click a comment or note to edit it. A comment or link attached to a card that is not a page still shows at the side of that card on the board.
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
  - The result shows in place of the text, or side by side: the text at the left (it can be edited), the result at the right. Side by side is paragraph-aligned: each result paragraph starts level with its paragraph (blank-line blocks; a heading, a list item, a quote, and a code block are blocks of their own). The shorter side of each row gets empty space; it is not text and is not saved. Both sides scroll as one. The paragraphs pair by content: the length of each paragraph (in the scale of each language; one CJK character counts as about three Latin letters), its kind (a heading pairs with a heading, code with code), and the numbers and links in it. Thus a paragraph that the plugin joined, split, or left out does not move the rows after it. While it reads aloud, the sides are not aligned. The divider can move (20 % to 80 %). A double-click sets it to half and half. The layout and the divider position are vault settings.
  - Cards on a board always show the result in place of their text.
  - A saved web page or PDF: "This page" (plugin menu, while the page is open) translates the page paragraph by paragraph (each line of the page text) into a column at the right of the page, on the reader canvas: it scrolls and zooms with the page.
    - In a PDF, the lines of a page join into paragraphs: a paragraph ends at a new page or column, at more space than the usual line distance of the page, at a change of the font size, at a short line (it ends before the right edge of its column), before an indented line, and before a list item. CJK lines join without a space.
    - Equations: a line made mostly of math glyphs (math letters such as 𝑃 𝑿, Greek, operators, digits, brackets; at most one long word) is a paragraph of its own; the pieces of one equation (a fraction, an index above or below, a close second line) join it. Equations are not translated: the column shows them as they are.
    - Each result starts level with its paragraph (the text layers of all pages are made when the PDF opens, so each paragraph has its place). It has the room up to the next paragraph; a longer result scrolls inside its box. Thus the column never drifts. While the page is read aloud, the box of the spoken sentence scrolls so that its mark is in view.
    - Highlights and linked passages find their quote also when the spaces or line ends in it changed.
    - "Hide translation" hides the column. Results stay while the app is open; they are never saved. The column is 660 page units wide (setting `translationWidth`, 240–1600). Drag its right edge to change the width. While the page is read aloud, the matching sentence of the translation has a mark too (the sentence with the same number in the paragraph; if the numbers of sentences are different, the sentence at the same place).
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
  - Formulas: with a `math-text` plugin (plugins/math), read aloud says each formula as words ("a over b"). In a note or a page, a formula is LaTeX between `$…$`, `$$…$$`, `\(…\)`, `\[…\]`, or a code block with the language `math`, `latex`, or `tex`. Text in code, an escaped `\$`, and amounts ("$5 and $10") are not formulas (Pandoc rules: no space after the opening `$`, no space before the closing `$`, no digit after it). In a saved web page, a formula is MathML (KaTeX, MathJax, Wikipedia): its LaTeX source if the page has it, else the MathML. The pictures of a formula (KaTeX HTML) are not read. A sentence break inside a formula is not used. A formula that the plugin cannot read is said as its LaTeX. "Formulas" in the Read aloud menu: "Natural (ClearSpeak)" or "Exact (MathSpeak)". Saved audio files say formulas the same way. Without the plugin, formulas are read as text.
  - If text is selected in the item, reading starts at the selection. While it reads, a click on a sentence goes to that sentence. The lock button in the read-aloud bar (setting `speechLock`) stops this: with the lock on, a click on the text does not move the reading. Explicit commands (for example "Read from here") still move it.
  - Only "Read aloud" (or "Read from the start") starts a reading. A click on text, also in the Read tool of a web page or a PDF, does not start a reading: it only moves a reading that runs now (also paused) in that text.
  - The Read aloud menu has three buttons: "Read from the start", "Read selected text" (only the selection, then it stops), and "Read from the selection" (to the end). The last two need selected text.
  - The bar: the lock, "Show the text that is read now" (it scrolls the spoken sentence into view; a note or page opens), the "ready" cursor button, the sentence count and the time left; in the middle the previous sentence, play/pause, and the next sentence; then speed, volume, and stop.
  - The "ready" cursor (setting `speechShowReady`, default off): a thin bar after the last sentence whose audio is ready, while it is ahead of the spoken sentence. When the reading reaches the bar, it waits for the voice. The voice makes about 1.5 to 2 seconds of speech each second (Apple M4, offline voice, measured): at a high speed it cannot stay ahead.
  - Styled letters (math letters such as 𝑃 𝑿 in PDFs, superscripts, full-width letters) are read as their plain letters (Unicode NFKC), not as codes.
  - Keys while it reads: Space pauses and plays. Left and Right go to the previous and next sentence. Ctrl, ⌘, or Option + Left and Right change the speed by 0.1 (macOS can use Ctrl + arrows to switch desktops before the app gets them). Keys in text fields are not used. Keys on a slider are used (the slider does not move).
  - Speed: 0.5 to 3 times.
  - Voice-out mode (vault setting `speechMarkdown`): "Markdown" reads without Markdown marks (#, **, links, tables); "Paper" also does not read the reference list; "Auto-detect" (default) uses Paper for a text with a reference list, Markdown for a text with Markdown marks, else reads the text as it is. Older values: "always" is Markdown, "never" is Auto-detect.
  - "Do not read" options (vault settings): author–date citations (APA, Harvard, Chicago), author–page citations (MLA), numbered citations (IEEE, Vancouver), all text in parentheses or square brackets. Reference lists (after a heading such as "References" or "Bibliography"): skip the list, or read each entry without its authors, dates, page numbers, or links. The rules change only the words to say. The mark stays on the full sentence.
  - The Read aloud menu shows a rough time to listen: the words of the text that it reads (from the selected text, or all) at 165 words a minute, divided by the speed. While it reads, the bar shows the time left.
  - Buffer: the app asks the plugin for the current sentence first, then for the next ones. At most 2 requests run at the same time (the voice plugin has 2 offline models: it makes 2 clips in parallel). A long sentence is made while the ones before it play. "Audio ahead" (Read aloud menu; setting `speechAhead`):
    - "About 1 minute" (default): until about 900 characters of speech are ready ahead (2 to 20 sentences). A step or a stop wastes little work, and memory stays small.
    - "To the end, while it plays": all sentences to the end of the text, while it plays.
    - "All audio first, then play": the bar shows "Making the audio: n / total"; it plays when all clips are ready. The clips stay until the reading ends, so a step back is at once.
  - A bar shows play, pause, sentence steps, speed, and volume. A pause holds the reading also between two clips (or while the next clip is made): nothing plays until "Play". Speed and volume apply at once. A change of a plugin option (the voice, the pitch) while it reads plays the current sentence again with the new option. A change of a reading setting while it reads ("Do not read" options, voice-out mode, "Audio ahead") drops all audio that is ready: reading goes on from the current sentence with the new setting. Their values are vault settings.
  - The audio is in memory only. "Save audio file…" lets the plugin write one file at the location that the user selects. It uses the skip rules too.
  - If the text of the item changes, reading stops.
- The selected plugin options are vault settings (`pluginOptions` in `.inspoboard/settings.json`).
- Plugin actions (for example, "Download pack") show in Settings → Plugins. They run only when the user clicks them. The details of each plugin (description, actions) are folded: the arrow button next to "Read the plugins folder again" and "Select the plugins folder" shows them. Errors and running tasks always show.

### 7.8 Web pages

- With a plugin that has the capability `save-page`, the app saves web pages and PDFs from the web in the vault. The core app has no network code: the plugin gets the page.
- A saved page or PDF is the copy of a document (section 1.1): it belongs to one link object. Its files are `web/<id>.html` (or `.pdf`) and `web/<id>.notes.json` (id: the link object). Two link objects with the same address have two copies. A paste of a copied link object copies its files and the small items in it. A page that opens with no link object (the globe button, a web address in a text, a PDF file) uses the oldest link object of that address, or gets a new one on the current board (one undo step). Older vaults have one shared copy for each address (`web/<hash>.*`): a link object without its own copy shows it, and the oldest link object of the address shows its notes; a change writes the files of the link object. The migration script gives each link object its own copy.
- PDF files from this computer: the globe button → "Open a PDF file…" copies the PDF into the vault (as the copy of its link object) and opens it. No plugin is necessary.
- The PDF reader (PDF.js, loaded when the first PDF opens) shows the pages with a text layer. It has the same tools and canvas as the web page reader. Page units are PDF units at scale 1, so notes stay on the page at any zoom. A zoom shows at once; the pages draw again at the new scale after a short pause. PDF.js data files (character maps, fonts) come from `public/pdfjs` (copied from `node_modules` before dev and build); no network. Scripts in a PDF never run.
- A click on a link (⌘-click in a text, a double-click on a link object, a link in the comment column) opens a web address in the default web browser: the app downloads nothing, and the browser (not the app) uses the network. Open a page in the reader: the context menu of a web address or link object ("Download and open website locally"), or the globe button in the tool bar.
- The first time, the plugin saves the page (with progress and Cancel). The app writes it to `web/<id>.html` (the link object). (Older vaults: `web/<key>.html`, where the key is the first 24 hex digits of the SHA-256 of the address without its fragment.) Later, the saved copy opens without network and without the plugin. "Save the page again" gets a new copy.
- While a page or PDF is open, the main tool bar shows the reader tools in place of the board tools: close, select, highlight, pen, eraser, the small-item button, four colors, undo and redo, zoom, margin, read from the start, save again.
- Inverted colors (the contrast button, vault setting `readerInvert`, default off; Settings → "Inverted colors: invert pictures too", setting `readerInvertImages`, default off): web pages and PDFs show as a dark page with light text. It is separate from the app theme (light or dark). The page is inverted (and its hue turned back, so colors stay near their own hue); pictures in a web page are inverted again, so they keep their colors. Pictures in a PDF are part of the page drawing: they show inverted. Marks, notes, comments, and the translation column keep their colors.
- The page is on a canvas: the page, and a margin of one page width at each side. Each visible part of the canvas takes notes (scribbles, small items); zoom out to get more room. The whole canvas zooms (buttons, ⌘+ ⌘- ⌘0, pinch, Ctrl + wheel); a web page does not flow again. Fit (⌘0) fits the page (and the translation column) to the width and scrolls to the page. The margins are not saved (older notes files can have `margin`: it is kept, not used). The translation column starts at the right edge of the page.
- Small items (comments: dark, pink text, the user signature; notes: paper color; action items, flashcards, quotes, texts, web links) go on the canvas: on the page or in a margin. They are vault items inside the link object (`inside` links, page units). The small-item button makes one: choose a kind, then click the canvas; selected text: the item points to it (a faint dashed curve to the text). Drag the head to move one; double-click to write; the eraser or the trash button removes one. A double-click on a kind keeps the tool on until Esc. A click outside finishes the item; a new item that stays empty goes away. ⌘Z in the reader is the app undo: highlights, scribbles, and small items are steps of the one app history (also after the reader closed). Comments and notes of older vaults stay in the notes file (`items`) and still work, until the migration script makes them vault items. The text saves while it is typed, and when the editing ends in any way. Scribbles can go on the page and in the margins.
- A web page shows at a fixed width (saved in the notes file with the first change), as tall as its content, so that scribbles stay on their words.
- A link object shows its full name (without a name: the full address without "https://"). It is as wide as the name, up to 480 px, then the name goes on more lines. In a calendar or an outline, the row size stays and the name is cut (without a name: the host only).
- A saved page with notes (a highlight, a scribble, a comment, or a note on its canvas) is local from then on: its link object is solid blue, and a click on its link (double-click on the link object, ⌘-click in a text, a link in the comment column) opens the saved copy, never the live web page. The link menu keeps "Open in web browser". The app knows it from `web/<id>.notes.json` and the small items inside the link object (no new data).
- Highlights stay on their text: each one keeps its range in the page text and its exact text. If the range no longer has that text, the highlight goes to the place of that text nearest to the old range; if the text is not on the page, the highlight does not show (it is kept in the notes file).
- "Save again from the web" on a page with notes asks first: the new copy replaces the saved one (the old copy is not kept), and scribbles, comments, and notes keep their places on the canvas.
- Lazy-load images (for example the figures of bioRxiv): the plugin saves the real image (`data-src`, `srcset`), and replaces the lazy-load classes (`lazyload`, `lazy`, …) with `lazyloaded`, because the page styles hide an image that has no "loaded" class and the saved page has no scripts. For pages saved before this, the reader does the same in the shown page only (the file does not change).
- The reader shows the page above the board, in a frame. The page has no scripts (the plugin removes them) and its content security policy blocks scripts and all network access. The frame allows scripts only because WebKit runs no event listener of the reader (click to read, selection) in a frame without that permission.
- The Read aloud menu reads the open page or PDF: from the start, the selected text only, or from the selected text on. "Read aloud" on a link object (its menu, or the plugin menu with the link selected) saves its page if necessary, opens it, and reads it from the top.
- If it cannot read, the reader says why (no Read aloud plugin, no text on the page).
- Select tool (default): while Read aloud reads this page, a click on text moves the reading there (not with the lock on). A click does not start a reading (needs a `speak-text` plugin). There is no separate read tool and no "Read from the start" button in the reader: the Read aloud menu has the read buttons. "Save again from the web" and the globe button are at the end of the tool bar. The spoken sentence has a strong mark and stays in view. Menus, page heads and feet (outside the article), and hidden parts are not read.
- Links: ⌘-click saves and opens the linked page. A click on a "#" link goes to that part of the page.
- Highlight tool (select text), pen tool (draw), and eraser (click a scribble, a highlight, a comment, or a note; or hold the button and sweep over strokes and highlights). Four colors. Undo and redo (⌘Z and ⇧⌘Z) are the app history. These notes are in `web/<id>.notes.json`: a highlight keeps its text range and its text (to find it again); scribbles and margin items keep page coordinates (a left margin has negative x); optional `margin` and `width`. Old notes files stay valid. The page file never changes.
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

- Settings → "Language": English, 中文（简体） (`zh`), or 中文（繁體） (`zh-Hant`). The setting is in the vault settings (`uiLanguage`, a language code). An unknown code shows English.
- Rule: a person who reads only the UI language never meets English. Each text that the app shows is in the packs: buttons, menus, options, tooltips, placeholders, dialog titles, messages and errors (also from the Rust backend and from the plugins), the names of the plugin options, the menu bar of the app, file dialogs, and the words that exports write ("See: …", "Comment").
- The source text of the UI is English. A language pack (`src/ui/i18n/<code>.json`) maps English text to the text of its language. The packs are part of the app, not plugins. To add a language, add a pack and a line in `UI_LANGUAGES`.
- Chinese: `zh-Hant.json` is the source pack (written by hand). `node scripts/i18n/make-hans.mjs` makes `zh.json` from it, character by character, with the Chinese plugin. The words: item 結點, board 畫板, page 文檔, flashcard 單詞卡, web link (an address) 鏈接, a link between items 連接 (the link tool: 連接兩個結點), the color tool 調色板.
- A key can have places for values: `"Undo {0} (⌘Z)"`. In the pack text, `{0}` puts the value as it is (user text), and `{t0}` puts the value after translation (a UI word, for example a command name or "about 5 min").
- Write a UI sentence as one text: one string or one template literal. Never split a sentence with values or elements (`<b>Link “{name}”: click…</b>`): the screen then has no full sentence to translate.
- Check: `node scripts/i18n/extract.mjs` lists the UI texts (TypeScript and Rust) that a pack does not have, and the split sentences. The test `tests/i18nCoverage.test.ts` fails for each one. Strings in the code that look like text but never show go in `scripts/i18n/not-ui.json`.
- The app changes only the screen: the text and the tooltips (`data-tip`, `title`, `placeholder`, `aria-label`) of the UI. User text never changes: cards, names, pages, comments, editors, inputs, web pages, PDFs, and each element with `translate="no"`. A placeholder word in a user area (class `untitled`: "Untitled", "Empty text") is translated. Nothing is written to the vault.
- The menu bar: the app writes the menu texts in the UI language (also the default macOS items: Edit, Window, …). Items that macOS adds itself follow the language of the computer.
- Dates and times use the UI language (`zh-Hans`, `zh-Hant`). The page has `lang` of the UI language, so CJK text uses the right glyphs.

### 7.11 Link bench

- A small helper that floats above all views (board, text pages, outlines, the web page and PDF reader), like a desktop pet. Folded, it is a round button (a dot for each full slot). Drag it anywhere. "Link bench" in the top bar shows or hides it. Its place, and folded or open, stay in this window (view state, not data).
- Open, it has two slots and "Link" in the middle. The left slot is the source ("From"), the right slot the target ("To"). ⇄ swaps them. A pin keeps a slot after "Link" (to link one end to many).
- Fill a slot:
  - Drag a card (also an outline row) onto the bench or onto a slot. The card does not move.
    While a card is over the bench, the slot that takes it has an outline. A drag over the folded bench opens it.
  - Click a slot to pick it (the slot pulses). Then a drag of any card, or of a comment or a note in a page, drags a ghost copy of it (its name). The item does not move, and the view does not get the press. A drop on the bench puts the item in the picked slot (or in the slot under the pointer), and the pick ends. Esc, or a click on the slot again, ends the pick.
  - A drag of a comment or a note in a page by its head, released on the bench, puts it in the slot under the pointer. The comment does not move.
  - Drag selected text onto a slot, or click "Selected text": the last text that the user selected in a note, a page, a saved web page, or a PDF.
  - "Search…": a search of all boards (names and texts). A hit in a text gives that exact text; a hit in a saved page gives the words found.
  - Right-click a card or selected text → "Send to link bench".
- A slot shows the item name, and the passage (or "Whole item"). A click on it shows that end.
- A small item (the whole item) at one end, and text of its own home (a page, a saved web page, or a PDF) at the other end: the button is "Point to text". The item then points to that text (section 1.1). One undo step.
- "Link" makes one command (one undo): a relation link from the source to the target. A target passage is `quote`. A source passage in a note or page text becomes `[passage](link:<id>)` in that text (as "Link selected text"). If the text cannot hold it (a web page or PDF, a passage of more than one line or with a bracket, or a text that changed), the link keeps the passage in `fromQuote` (new optional field) and no text changes.
- Saved web pages and PDFs (link objects) have the link features of a page: a linked passage of the page (`fromQuote` of a link from it, `quote` of a link to it) has a dotted line; ⌘-click on it goes to the other end. The Links button of the reader lists "Links to" and "Linked from". A jump to a passage of a web page or PDF opens the reader and finds the passage.

### 7.12 Group cards (loose areas)

- A group card is an item with a card of view `group`: a loose area of the board, a shape with a name. It is a large item (tool bar: the board button list). Different from outline and calendar groups (section 7.6), it saves no members.
- Shapes (tool bar: the board button list → Group): Rectangle (G): drag from one corner to the other (a click makes 480 × 320). Ellipse: the same, an ellipse. Free shape: draw a closed outline; it is smoothed into a soft shape. The place link gets `shape` (`ellipse` or `blob`; missing: a rounded rectangle) and, for a free shape, `shapePath`: a closed SVG path (M, L, Z and numbers) in a 100 × 100 box that stretches to the card size. Both fields are optional: old vaults do not change.
- Look (right-click → "Look"): "Outline only" (default: a dashed edge) or "Filled" (the area is filled with a clear color and the edge is solid). The place link gets `filled: true` for Filled (optional: old vaults do not change). The color is a quiet gray, or the card color (Colors button). The name is at the top left; a group with no name shows "Group". A new group opens its name for typing. Double-click the name to rename it. A group never opens as a page.
- It lies behind all cards, also behind outline and calendar frames. Only its edge and its name take the pointer: a click or a drag inside the shape goes to the board (pan, box select, create tools) or to the cards in it.
- Members: a card is in a group while its center is in the shape. A different group is in it if its box is fully in the box of the group and its center is in the shape. Shapes can overlap: a card can be in more than one group. Nothing about members is saved.
- Drag the edge or the name to move the group: its members (at the start of the drag) move with it, and the members of a group in it too. One command (one undo). An outline or calendar frame in the group moves with its cards. An attached comment or link follows its own card. A group card is never dropped into a board, a note, or an outline.
- Resize: select it and drag its edges. The members do not change size.
- Scribbles drawn in a group go on the board (not into the group card).
- Export: a group with a name or text is a heading (and its text); an empty group is left out. Copy and paste does not copy groups.

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
