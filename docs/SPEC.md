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

Items have three sizes: small (note, comment, URL, action item, flashcard, quote), medium (a page, and the saved web page or PDF of a link object), and large (a board). A text card is not a small item: it is its own thing (a free text on a board).

- **A larger item is a free-form board for smaller items.** Each small item can go on a board, in a page, and in a saved web page or PDF, in the same way: one "small item" button with a list of all small kinds, then a click anywhere on the surface (on the text or in a margin). The same tools work on each surface.
- **A small item in a medium item is inside it.** It is a vault item with an "inside" link from its home (not a board placement: the home stays a page or a link object). It shows only in its home. It goes to the trash with its home and comes back with it. It can move out to a board, and a card can move in (one undo step each).
- **A small item looks the same on each surface.** In a page and on a saved web page or PDF, each kind looks as its card on a board: an action item is fluorescent film, a flashcard is blue (the name is the front, the text is the back; double-click flips it, the pencil writes the side that shows), a quote is newsprint paper with quotation marks (the name is its source), a web link is dark blue, a text has no paper. A note is paper, a comment is dark. Only the head (to move it, and its buttons) is added.
- **The size of each item changes by hand, on each surface.** On a board: the resize handles of the selected card (width and height; a note is never larger than a sticky note, a scribble keeps its shape, a folded card fits its name). A quote has the size that the user gives it: a longer text scrolls. In a page and on a saved web page or PDF: the grip at the bottom-right corner of a small item (on hover). Placed on the page: width and height. In the comment column of a page: the height (the column sets the width). The size is on the inside link (`w`, `h`); one undo step.
- **A small item made by a click always stays**, also when it is empty. Only Delete (or the eraser) removes it; a double-click edits it, never deletes it.
- **The keys of the small kinds** (N note, M comment, W web link, I action item, F flashcard, Q quote) choose that kind in the small-item button while a page or a saved web page / PDF is open (on a board they choose the board tool).
- **Two sides of a medium item.** The right side is for batch text and manual notes: the translation column, comments, and notes. The left side is for automatic annotations and short texts: the words of formulas ("Formulas → words" button), and later the notes of a question-and-answer agent.
- **A small item can point to text in its home.** It points to text only if text is selected at that moment (an old selection does not count). If text is selected when the item is made, the item points to that text: a faint dashed curve from the item to the text, stronger while the item is hovered or selected. The text that a small item points to has the same faint gray highlight as a linked passage (section 7.11). The link bench points an existing item to text. The unlink button in the head of the item ends the pointing (one undo step).
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
| **Group** | A part of a board with one shape: an outline (aligned list) or a calendar (month grid). Section 7.6. Table `outlines`. | `id`, `board`, `x`, `y`; optional: `type` (`calendar`), `name`, `list`, `direction`, `start`, `end`, `view` (`week`, `year`; missing: month) |

An ID is a random string of 12 characters (lowercase letters and digits). An ID never changes.

Item times:

- `created`: the app sets it when it creates the item.
- `modified`: the app sets it when the name or the body text changes.
- `subtitle` (optional): a page only. One line under the name. On a card it shows under the name, gray, italic, and smaller (as the source of a quote), also when the card is folded (the folded card is then two lines high). To write it: press Enter in the name of a page (on its text page, or in the name of a page card on the board); the subtitle field opens under the name (a folded card grows to two lines for it). Enter in the subtitle goes on to the text of the page (on the board: it ends the edit). An empty subtitle is removed, and its field folds away. Search finds it ("Page subtitle"), find and replace changes it, the Markdown export puts it in italics under the heading, and read aloud says the name and the subtitle first when it reads the page from its start (also in saved audio files). A board has no subtitle.
- `date`: the user types it. Use it for data that was made outside the app. It is free text, for example "1998" or "2021-05-03".
- "Opened" is app state, not core data. It is in `.inspoboard/opened.json`. It is not in history snapshots and not in undo.
- A note has no name by default. A note can keep an empty name. Lists show the start of its text.
- If the user leaves the name of a page or a board empty, the app makes a code in one of four formats: 3 digits, 4 digits, 2 letters + 2 digits, or 3 letters (capitals). The item gets `codeName: true`. A code shows as a low-profile chip. A typed name removes the mark.
- The setting "Item title" hides the name above the text. Cards always show names. A long name above the text wraps onto more lines: the whole name shows. Enter saves it; a name has no line breaks.
- The dates are hidden by default. The setting "Show file details" shows them under the item title, one on each line, with the word count of the text. A Chinese, Japanese or Korean character counts as one word.
- Object fields (all optional): `url` (the web address of a link object), `author` (the signature of a comment: Settings → Your name; only a name, not an account), `on` (the item that a comment or link is attached to: a card that is not a page, or the comment that a reply answers), `quote` (a comment on a passage: an exact text in the body of `on`), `resolved` (a resolved comment thread), `pageAt` (older vaults only: the place of a small item in a page; now in its `inside` link), `trashed` and `trashedFrom` (an item in the trash: section 5.4), `sources` and `discarded` (a sorting map: lists of IDs, section 7.16).
- A reply is a comment item with `on` = the comment it answers. It has no placement: it shows in its thread. It is not an unplaced item.
- `background` (optional): the background of the board of the item. A color `#rrggbb`, or an image path `images/<name>`. The vault setting `defaultBackground` applies to boards without their own background. `backgroundOnBoard` (optional, `true`): the image lies on the board (section 7.1). `backgroundWidth`, `backgroundCenter` (optional): its size and place on the board, if set (missing: it holds all cards). `backgroundFixed` (optional): from an older background mode; it stays valid and is kept, but the app does not use it.

### 2.2 Link kinds

| Kind | Meaning | Kind-specific fields |
|---|---|---|
| `place` | Record `to` is shown on board `from`. | `x`, `y`, `w`, `h` (2D layout); `p3` (3D position, optional); `view`; `expanded`, `color`, `ref`, `outline`, `parent`, `rank`, `day`, `until`, `marks` (quote cards), `time`, `shape`, `shapePath` and `filled` (group cards: section 7.12), `stubs` (stub places: section 7.1) (all optional) |
| `link` | Item `from` refers to item `to`. | `label`, `group`, `color` (the line color `#rrggbb`; missing: the group color or the default), `dashed` (`true`: a dashed line), `start`, `end`, `quote` (a passage of the target), `fromQuote` (a passage of the source that its text cannot hold: section 7.11), `onBoard` (a link made from text also shows on boards: section 7.11) (all optional) |
| `inside` | Small item `to` is inside medium item `from` (a page, or the saved web page or PDF of a link object: section 1.1). `from` does not become a board. | `view` (the kind of the small item); `x`, `y` (its place: a page: px from the top-right corner of the text; a saved page: page units, a left margin has negative x; both missing: in the comment column of a page); `w`, `h`, `color`, `expanded`; `quote` (the text of the home that it points to) and `at` (where that text starts, a string index) (all optional but `view`) |

A link has no body text (P5). To describe a link with more text, make an item and link to it.

- Format 1 (older vaults): a comment or note of a page was an item with `on` = the page, `pageAt`, `quote`, and a card next to the page. The app does not read this form; the script `scripts/migrations/inside-links.mjs` changes it (section 3.3).
- An item lives on one board only: its **home**. The home placement is the `place` link without `ref`. Older vaults can have more: then the one with the lowest ID is the home.
- A placement with `ref: true` is a **reference**: the item shows on a different board as a ghost card with a dashed outline. Double-click it for a quick view. Its menu has "Open home board". "Show an item here" (A) makes a reference if the item has a home.
- `color` (optional): the card color `#rrggbb`. The text color follows for contrast.
- `quote` (optional, on a `link`): a location in the target item: an exact text in its body. A jump along the link marks this text.
- The view style is on the `place` link, not on the item. Thus one item can show as a note on one board and as a page on another board.
- The type icon of a card (note, page, board) shows only on hover or selection.
- Values for `view`: `note` (yellow sticky note), `page` (light lilac paper: full-screen text with a note-size preview), `text` (bare text without a frame), and the objects:
  - `comment`: dark card, electric pink text, a signature and a time, and its replies under it. Attached (`on`) or free. An attached comment shows at the right side of its card (with a dotted line) and moves with it; "Detach" frees it. On the text page of its item it shows in the comment column. "Comment" (right-click selected text) attaches it to the passage (`quote`): a click on the passage in the column marks it in the text. Its buttons: Reply, and Resolve (the thread is hidden but stays, with its history; the column can show resolved threads and open them again). Delete removes the thread with its replies (undo brings it back).
  - `weblink`: dark blue card that shows only its name (or the host of its address), like a collapsed note. Free, or attached to a card ("Attach a URL"), or in text ("Add URL…" on selected text writes `[text](url)`). Double-click opens it: a web address opens in the web browser (the app downloads nothing); a local file opens as below. Its menu has "Download and open website locally" (the web page reader, section 7.8). Its buttons (on hover) and its menu ("Edit name and link") open one form with the name and the link (Enter saves both, Esc cancels). The link can be a web address (it opens in the web page reader, section 7.8) or a local file: "file:///…", "~/…", or a full path. A local PDF opens in the PDF reader (a copy goes into the vault, as with "Open a PDF file…"). Any other local file shows in Finder (Explorer on Windows); the app does not open it. A local file link shows the file name and a file icon. Drop files from Finder (or Explorer) on a board: each file becomes a link object at the drop point, named by its file name, with its full path as the link (one undo step). Drop a file on the link field of a link form: the field gets the full path.
  - `todo` (action item): half-transparent fluorescent film (yellow, green, blue, pink, purple: right-click). "Done" (its check box, shown on hover) removes the item and its placements. Undo brings it back. Double-click it to edit its text on the film (no edit box): while it is edited, it grows to the sticky note size (200 × 160) over its neighbors, as a note does. Folded (for example in a full calendar day), it shows the first line of its text and no Done box.
  - `flashcard`: cornflower blue, two sides, the sticky note size (200 × 160; a saved size does not change how it shows, and the data stays). Its text is 2 px larger than before (front 15 px, back 14 px). The name is the front, the text is the back. Double-click flips it (view state). A new flashcard opens its front for typing. After that, edit only from its right-click menu: "Edit front" or "Edit back" (the card shows that side). It has no edit button, and Enter or F2 does not edit it.
  - `quote`: a passage on newsprint paper (pale yellow, dark gray serif text), framed by quotation marks: a large opening mark at the top left and a closing mark at the bottom right, inside the card. A slim card, 320 × 72 by default: small top and bottom edges. The edges can be dragged (any width and height); a longer text scrolls. The text is the passage; the name is its source, shown under it ("— source"); the source can be empty. Double-click (or "Edit text") writes the text; "Edit source" writes the name. The marks (`marks` on the place link): `en` ‘ ’, `cjk` 「 」 (Traditional Chinese, Japanese), `zh` “ ” (Chinese), `es` « » (Spanish, French), `none`. Right-click → one line "Marks" with the five choices. Without `marks`, the marks follow the text: CJK text gets 「 」, other text ‘ ’. Folded ("Fold into a bubble", the button on hover, or `expanded` not true): a small gray speech bubble with the first two words (two characters of CJK text); a double-click unfolds it and starts the text edit, like a folded note. Export: a Markdown quote, with "— source" on its last line.
  - Objects keep their type: the note / page / board button does not show for them.
- `group`: a group card, a loose area of the board (section 7.12). It keeps its type too.
- A page or note card shows only its name if `expanded` is not true. A collapsed note with no name shows the first line of its text. A new note is expanded. A text card always shows its text.
- A note is short text on the board. It never opens as a page: double-click a note to open it in place and edit it. The text is edited on the note paper (no edit box). While it is edited, the note grows to at least the sticky note size (200 × 160) over its neighbors. An open note shows all its text: it is never wider than the sticky note (resize makes it narrower only), and it is at least its own height, taller if its text needs it. The user keeps notes short; the board does not cut them. A larger saved size shows at most at the sticky note width (the data does not change). Double-click the name of a note to edit the name. A note with no name has a "Give it a name" button (on hover). While the user edits a card, a drag in the card selects text: it does not move the card or the board.
- A note can hold scribbles: draw in the note, or drag a scribble onto the note (the note shows a drop outline). The scribble then has `from` = the note item, with coordinates relative to the card. It moves with the note and the card clips it. "Take scribbles out" puts them back on the board at the same place.
- An item is a **board** if it has item children (scribbles do not count), or if its `board` field is true. A board card always has the board look, whatever its view.
- One state button changes a card. It is the last button of the selection tools (after a divider), away from the buttons that are used often:
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
  web/<hash>.*          Format 1: one shared copy for each address (hash: 24 hex digits). The app does not use it.
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
- The app reads format 2 only (since 2026-10-12). A format-1 vault has an error: it opens read-only, the app writes nothing to it, and the message asks for the migration script. Only the script reads format 1 (core/migrate/legacy.ts). The old shared web files (`web/<hash>.*`) stay on disk; the app does not use them. Entries of a notes file that the migration could not read (`items`) and unknown fields stay in the file: a save keeps them as they are.

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
| Two windows, one vault | A vault shows in one window only. Opening it from a different window brings its window to the front. |

### 4.6 Several vaults in windows

Vault › "Open Vault in New Window…" (⌘⇧O) opens a different vault in a new app window. Each window shows one vault, with its own lock, file watcher, history, and plugin results.
- The backend keeps the open vaults by folder, and the window of each. A window that closes closes its vault (its lock goes). The app quits when the last vault window closes.
- The menu acts on the window in front. A change from outside (4.4) goes to the window of its vault only (the change names its vault folder).
- A vault that a window shows does not open again: "Open Vault…" or a new window for it brings its window to the front.
- The session log of an app session stays in the first vault that opened.

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
- Recently added (top bar, in the More menu; it can show in the top bar always): the items made in the last 30 days (`created`), the newest first, at most 300. Each row has the name, the start of the text, the time it was added, and where it is (its board path, the page that it is in, or "In the trash"). Type to filter. A click (or Enter) shows the item as a search result does: on its home board, in its page, or (in the trash) in a window. The list shows each item that has a record: thus an item on no board can always be found and opened.
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
- Shown-cards check: 1.5 s after the cards change, each card of the board model must have its node, its element, and a measured size (React Flow hides a card that it has not measured). A missing card is measured again, and the session log gets one line: the board ID, the card IDs, and the reason (`no-node`, `no-element`, `no-size`, `hidden`). If it still does not show 1.5 s later, a second line says so. IDs only, no text.
- A `link` link shows as a line from the center of one card to the center of the other card. The cards hide the line ends.
- Each end of a link has a cap: none, arrow, open arrow, circle, square, or diamond (open or filled). The defaults are "none" at the start and "arrow" at the end. Only other values are saved (`start`, `end`). The caps sit at the card edge. A selected link has, in the tool bar, its two caps, "Line color" (the card colors; X: the default, the group color or gray) and a solid/dashed button. They change `color` and `dashed` on the link; the board and 3D show them.
- Ctrl+Shift+P collapses all expanded cards on the board, in one command.
- If only one end is on the board, the app shows a short stub with the name of the other item, 16 px right of the card as it shows (a folded card is as wide as its name; the model estimates that width from the name). Click the stub to open that item. Drag the stub to put it anywhere: its line gets shorter or longer. Its place is saved on the place link of the card (`stubs`: the ID of the other record → [x, y] from the top-right corner of the card), so it stays next to the card when the card moves. One undo step.
- Inline references in text draw no line.
- Each board keeps its view (position and zoom) while the app is open. A return to a board of the path (back, the breadcrumb, Esc out of an item) shows the same part as before. A board that opens for the first time shows all its cards.
- Double-click a card to zoom into it. The board of the item fills the screen. Notes and text cards edit in place. References open a quick view.
- If the item has no children, the app shows only the text, like Typora. A button shows the board.
- Mouse drag on empty space moves the board. Ctrl+drag (Cmd+drag on macOS) selects with a box. Scroll moves the board. Pinch or Ctrl+scroll zooms.
- Double-click a card to open it: a board shows its board, a note or page shows its text. Double-click a text card to edit its text.
- To change the name of a card, select it and press Enter or F2.
- Copy and paste: ⌘C (or Ctrl+C) copies the selected cards, ⌘V (or Ctrl+V) pastes new items, copies of them, on the open board (any board): under the pointer, or next to the copied cards (each paste a little further). For now only small items (note, text, comment, web link, action item, flashcard, quote) and pages can be copied; boards, outlines, calendars, and scribbles are left out (a short message says so). A new item gets the name, the text, the date, the web address, and the signature, and a card of the same kind, size, color, and fold state. It is a free card (not in an outline or calendar, not attached). In its text, a link to a relation link becomes plain text; a link to an item stays. Highlights, scribbles, comments, and links stay with the copied item. Exception: a page or a link object is a full copy. The small items inside it (with the replies of comments) become new items inside the new page or link object, and a link object also gets a copy of its saved web page or PDF and its marks (section 1.1). The copy is taken at ⌘C. One paste is one undo. With text selected, or in a text field, ⌘C and ⌘V work on the text. The text of the copied cards also goes to the system clipboard. Double-click the board name in the breadcrumb to change it.
- Link tool: click the first item, then the second item. To link to an item that is not on the board, right-click (anywhere on the board) or click "Search…" after the first item: a search of all boards (names and texts) opens. A click on a hit makes the link; a hit in a text links to that text (`quote`). The new link shows as a stub. A link from selected text ("Link selected text", existing item) works the same: right-click on the board opens the search of all boards.
- Release builds show no browser menu ("Inspect Element") on a right-click. Text fields keep it (copy, paste).
- To move records into a board, drag them onto a board card (it shows a dashed outline), or use "Move into…" and select the board. One command. Only the place links change. The records keep their layout relative to each other and go to the right of the cards that the board has. Outlines keep their tree: a row brings its child rows (all levels). A dragged outline frame (or calendar) moves with all its cards, as it is. Some rows of an outline make a new outline on the target board, with the same list style and direction (the moved rows whose parent stays become its top rows); the rows that stay keep their outline.
- The breadcrumb shows the path you used, not a tree path. While a web page or PDF is open, a click on a board name in the breadcrumb (also the current board) closes the page and shows that board.
- Back and Forward (top bar, Cmd+[ and Cmd+]) go through the views, as in a browser. Each step keeps what showed when it was left: the open text windows, the part of the board that showed (pan and zoom), and the scroll places of the text page and of the windows. Back gives the view exactly as it was. A jump to a linked item (a text link, a link card "Go to", a search hit) is always a new step, also on the same board: Back closes the window that the jump opened and shows the page you jumped from, at the same place. (A jump into a saved web page or PDF opens the reader; that is not a step.) Up (top bar, arrow up) goes out one level: the board or page that holds the one that shows. A double-click on the bar of a text window (not on its title or a button) opens the item as its full page, in place of the window, at the linked passage; Back gives the window again. The same for "Zoom into this item" (the window button), and for each other way that opens the item as its full page: its window closes. View history is not saved and is not part of undo.
- Right-click a card (or the selection) for its menu: open, edit text, open home board, move to board…, make outline, take out of outline, take scribbles out.
- Right-click the empty board for the background: an image for this board or for all boards, or remove a background. The app copies the image into `images/` of the vault (simple name plus a content hash, atomic write). History snapshots include `images/`.
- A background image stays still: it fills the view behind everything (cover, centered), in 2D and in 3D. A color fills the whole view.
- On the board (a board's own image; right-click the empty board → "Background: on the board (it moves with the cards)", and "Background: fill the view" back): the image lies on the board, like a cork board or a sheet of paper. It moves and zooms with the cards, behind them. Its size and place: `backgroundWidth` and `backgroundCenter` if the item has them, else the smallest size (with the shape of the image) that holds all cards with a margin of 200 units; it grows when a card goes past it. Each card on such a board looks pinned: a pushpin at its top (red, blue, or yellow, in turn) and a deeper shadow. Group frames have no pin. The 3D view shows the image as before (it fills the view). Item field `backgroundOnBoard: true` (optional; an older app ignores it and fills the view).
- (The field `backgroundFixed` and the setting `defaultBackgroundFixed`, from an older mode, stay valid and are kept in the files, but the app does not use them.)
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
- Card color: right-click any card (not an action item or a scribble: they have their own colors) → "Card color": Default (the color of the card kind) or one of the card colors. It sets `color` on the place link, as the Colors button does. All card kinds show it: notes, pages, texts, comments, URLs, flashcards, quotes, media items, groups. A small item inside a page or a reader has the same colors: the palette button in its head (on hover) sets `color` on its inside link. The color fills the item as on a board; a note keeps its paper (the color is its stripe), and an action item its film.

- Zen mode: View › Zen Mode (below Enter Full Screen, ⌃⌘Z). The top bar and the tool bar hide, and the board fills the window. Zen mode is in the More menu (⋯) of the top bar; its icon is an ensō (a brush circle). Only the buttons in the vault setting `zenButtons` show, in one small bar at the top (Settings → Zen mode buttons; default: back, undo, redo, select, scribble, eraser, text). Esc ends zen mode when Esc has no other use (no text input has the focus, no menu or dialog is open, no tool is on). The button at the left end of the bar also ends it. Zen mode is not saved. Settings → Zen mode lists the buttons.
- Top bar, More menu (⋯, at the right of the top bar): items by type, link bench (show or hide), trash, back up, and zen mode, then "Choose the top bar buttons…". Settings → Top bar → "Always show in the top bar" puts any of them in the top bar (vault setting `topBarButtons`, default none); then the More menu does not list it. The More button does not show when all of them are in the top bar.
- Settings has a tab for each section, in a left column: Appearance (theme, font weight, language), Cards and pages (page width, item title, file details), Top bar, Zen mode, Name and backups (your name, backup alert), Plugins. The More menu entry "Choose the top bar buttons…" opens Settings at Top bar.
- Scribble colors: while the scribble tool is on, the tool bar shows five ink colors: ink (black or white, as the theme), yellow, green, pink, blue (the pen colors of pages). The choice is the vault setting `scribbleColor` (missing or null: ink). A new scribble gets the color as its card color (`color` on its place link); a new color starts a new scribble. Right-click a scribble → "Scribble color" changes it; the Colors button (card colors) also changes selected scribbles. Old scribbles have no color: they show in ink.
- A tool that makes one thing (note, page, board, text, objects, groups) goes back to Select after one use. A double-click on the tool (or on its entry in a list) keeps it on: for example, click many times to make many pages. A dot under the button shows this. Esc or a different tool ends it. Typing in a card (its name or its text) also ends it: the next click finishes the card, it does not make a new one.

Dialogs and tool bar popovers (Settings, plugin options such as Read aloud, "Read a web page", search lists) open fully in the window: if a part is outside, the panel moves in. A drag on the title moves the panel; the title stays in the window. The position is not saved.

### 7.3 Galaxy (3D)

- The galaxy shows the children of one item at their `p3` positions.
- A child with no `p3` gets its x and y from the 2D board. Its depth (z) is spread from its place ID (fixed, pseudo-random), up to 0.6 × the larger side of the cards' area, so that many cards fill a volume. Cards in an outline or a calendar stay in the plane. A drag saves `p3`. The background image lies behind the deepest card.
- Each child that has children shows them as a small cluster around it. The depth limit is 2.
- Each record is a dot with a small tag or icon. The name shows on hover and near the camera. A note with no name shows no label (on hover: the start of its text). "Hide labels" (tag button, bottom left) hides all labels: a label shows only on hover. The choice stays (vault setting `galaxyHideLabels`, default false).
- A link line has the color of the link (its `color`, else its group color) and is dashed if the link is dashed, as on the board.
- A link line has a cone at each end with an arrow cap. A reference is a wire shape.
- The scribbles of a note are small satellites around the note.
- The small items inside a page or a link object (section 1.1) are satellites of it, with a line to each (as the cards of a group). They cannot move in 3D (they have no card).
- The user can rotate, zoom, and drag a record. Drag moves the record in the plane of the screen. It changes `p3` on the `place` link.
- Labels are DOM elements above the canvas. A frame callback moves them to their dots.
- Tour (route button, bottom left): a cruising camera that gives a broad view of all the contents of the board, at one fixed speed (a hand drag cannot keep one speed). It starts at a wide, high view of the whole board (the camera pans slowly across it), visits the major stars (boards with the most cards, groups, the most linked items; at most 7) in nearest-neighbor order, and ends at the whole board again. At each star it circles half a round (that shows most items around it), looking at the star. Between stars it flies a throw: a high arc that bends to one side. The path is one closed Catmull-Rom curve, moved along by arc length (src/ui/galaxy/tour.ts). While it runs, each dot has a soft glow, and a line at the top says what shows ("The whole board", "Circling: <name>", "Cruising"). A drag on the view, Esc, or the button ends it; at the end the camera stays and looks at the middle of the board. It runs in Buzzies mode too (the button is a Buzzies chip; the labels buzz).
- Buttons at the bottom left (no help text there): Reorient (compass) moves the camera back to the front view of the board, at the middle of its cards, in a short animation. Explode (sparkles) gives the cards with no `p3` a new random spread (depth, and a small move in x and y), and the dots move to their new places in a short animation. Cards with `p3` (placed by hand) do not move. The spread is view state: it stays while the app is open, and nothing is saved until the user drags a dot.
- A group card (section 7.12) is a volume around its cards: its shape at the back and at the front of the depth of its cards (with a small margin), and four lines between them. With no cards (or all in one plane) it is a flat shape. Outline only: dashed lines. Filled: solid lines and a clear volume in its color. It has a small dot in its middle (drag the dot to move it). The shape does not take the pointer: a drag on it turns the view.
- Right-click a dot of this board: "Delete" takes the card off the board (as Delete in 2D). For a group card, also "Look" (Outline only, Filled). A dot of a board in this board, and an outline or calendar point, have no menu.

### 7.4 Search

- Press Ctrl+F (Cmd+F on macOS) to search. Press Ctrl+S (Cmd+S) to save now and make a history snapshot (the app saves by itself too).
- The search looks in the current board and in all boards below it.
- It looks in item names, body text, link labels, link groups, and stamp alt text.
- A jump to an item (a search result, a link, a list row) always shows it. On its home board the card is selected and centered. A calendar card of a period that is not shown: the calendar goes to its day first. A card that the board does not show (for example a note that its page holds): the item opens in a window.
- It also looks in saved web pages: a link object whose copy is saved in the vault (`web/<id>.html`, `web/<id>.pdf`; older vaults: the shared copy of its address) is searched in the page text (result tag "Web page"). The app reads the files when the search opens and keeps the texts in memory while the vault is open; other results show at once, page results when they are read. A page that is saved again is read again. A click on a page result opens the saved page and finds the text in it.
- While a web page or PDF is open, ⌘F finds in that page: a bar at the top right of the reader, with the number of matches ("3 / 12"). Enter goes to the next match, Shift+Enter to the one before, Esc closes the bar. All matches have a light mark, the current one a strong mark, and the page scrolls to it. Not case-sensitive.
- Search options (buttons in the search field): match case (Alt+C), whole word (Alt+W: no letter, digit or "_" right before or after the match), regular expression (Alt+R, JavaScript syntax; an incorrect expression shows an error and no results). Where: "This board and below" or "All boards". The selected text (one short line) becomes the query. The query, the options and the replacement stay for the next search while the app is open. The dialog shows the number of results and places ("12 results in 5 places"); it lists at most 200.
- Replace: Ctrl+Alt+F (Cmd+Alt+F) opens the search with the replace field, or click the arrow at the left of the search field. Each result shows the old text struck out and the new text after it. Enter in the replace field (or the button in a result) replaces one result; Ctrl+Enter ("Replace all") replaces all results, also those that the list does not show. Each field has a "¶" menu of special codes (a click puts the code in at the cursor).
  - There is no single standard for these codes. The app uses the two usual ones. A plain search uses the codes of Microsoft Word: in the search, ^p a line break (one Enter), ^t a tab, ^? any character, ^# any digit, ^$ any letter, ^^ a caret; in the replacement, ^p, ^t, ^^ and ^& (the found text). Another "^" is a caret. A regular expression uses the codes of VS Code: \n, \t, \d, ^ and $ (start and end of each line) in the search; \n, \t, \\, $&, $1…$99, $<name> and $$ in the replacement.
  - A blank line between two Markdown paragraphs is two line breaks: ^p^p (or \n\n). For example, replace ^p^p with ^p to remove the blank lines.
  - The preview of a result shows a line break as "¶" and a tab as "→".
  - One replace is one command: undo gives all texts back.
  - It changes item names, body texts, link labels, link groups and scribble alt text. A saved web page or PDF never changes.
  - So that no link breaks, these never change: the target of a Markdown link or picture ("](…)"), and a passage that a link or a small item points to (`quote`, `fromQuote`). A small item inside a page keeps its place (`at` moves with the text). A result whose text changed after the search does not change. The dialog tells the number of results that did not change.
  - A read-only vault cannot replace. Picking a link target ("Link to…") has no replace.
- Each record is searched one time only, also if it is on many boards.
- Results near the current board come first. Each result shows the path of boards to it.
- Click a result to go to it. A text result opens the item at exactly that text, marked in yellow. A note shows on its home board, centered and selected.
- Items by type (top bar button, default type: action items): all items of one type of the vault in one list, like search results, with their board path. The types: the card kinds (action item, note, page, text, comment, URL, flashcard, quote, group) and media items. The type picker is at the top of the list; the choice stays until the user changes it (vault setting `listKind`, default "todo"). A small item inside a page is in the list too. Type to filter. A click goes to the item on its home board (a small item: to its page). An action item has a check box that finishes it ("Done").

### 7.6 Groups: outline and calendar

- A group is the level below a board: if the board is the title, a group is a subtitle. A group has a title like a board (double-click it, or "Rename group"); a new group opens its title for typing. Without a name it shows "Outline" or "Calendar". It has a shape on the board, a shape in 3D, and "Export as one document…" (frame menu): one Markdown file with all its cards.
- A board that holds one group and nothing else (scribbles do not count) is an outline board or a calendar board. Its card shows the group icon.
- In 3D a group is a point above its cards, with a line to each card: an outline is a green book (on hover, a tree list of its rows), a calendar is a blue calendar that grows with the number of days that have cards. A board that is one group has the group shape.
- The export (section 8) writes the group name as a heading one level below its board, then its cards.

#### Calendar

- A calendar is a group with `type: "calendar"` and a range of months (`start`, `end`: "YYYY-MM"). Frame menu: "Months…" changes the range.
- Views (as in Google Calendar): Week, Month, Year. The switch is in the bar of the calendar, with "Today" and the arrows (‹ ›: the week, month, or year before or after, in the range). The view is saved on the calendar (`view`: "week" or "year"; missing: month, so older calendars show the month view). A change of view is one undo step. The shown period is view state: one shown day for each calendar (its week, month, or year shows). It stays while the app is open. "Today" shows the period of today; a month outside the range makes the range larger. The title of the bar: the month ("January 2026"), the months of the week ("March – April 2026"), or the year.
  - Week: 7 day columns (Sunday first) with the weekday and the date. Under them, a strip for all-day cards (one day, no time) and cards on more than one day (bars in lanes; the strip grows with its lanes). Under the strip, an hour grid (0 to 24 h). A card with a time is at its hours: from its start to its end (only a start: one hour). Cards whose times overlap share the width of their day. A red line shows the time now in the column of today. A drop on the hour grid puts the card on that day at that time (steps of 15 minutes, where the top of the card is): a card with an end time keeps its length. A drop on the strip makes it all day (no time). A card on more than one day keeps its days and has no time. A create tool clicked in the hour grid makes the item at that hour (one hour). Cards of other weeks do not show.
  - Month: the month grid (below). A click on the number of a day opens its week.
  - Year: 12 small months (4 columns, 3 rows). A day with cards is bold and underlined (the tip gives the number of cards); a click on a day opens its week, a click on a month name opens that month. Cards do not show in the year view. A drop on a day puts the cards on that day. Months outside the range are dimmed.
- It shows one month as a grid: Sunday to Saturday markers at the top (the week starts on Sunday, like Google Calendar), six week rows. The grid shows the last days of the month before and the first days of the month after (dimmed, with their numbers), but these days hold no cards: only cards on days of the shown month show. A card on more than one day shows its days in the shown month. A card on more than one week row looks the same in each row: it shows its text only if it is alone in all its rows. In a full day, the fold arrow of a card (▸) opens a quick view: its top stays, and it reaches the bottom of its day, over its neighbors (view state for the app session, not saved); ▾ folds it again. A double-click on a note opens it at the full sticky note size, over the calendar (it can go past its day). The fold state never moves the text of a card: a calendar card has the same padding in all states, and its tools (type, fold, edit) lie over its top-right corner on hover. The arrows in its bar show the month before or after, in the range. A double-click on the calendar opens a month field: any month; a month outside the range makes the range larger. The shown month is view state (not saved). It stays while the app is open: back from an item, the calendar shows the same month. The first month that shows is this month, if it is in the range. A calendar is not an item: a double-click never opens it as a page.
- Drag a note or a page onto a day: it snaps to the day (`day: "YYYY-MM-DD"` on its place link). A create tool (page, note, objects, board) clicked on a day makes the item on that day. Each item on a day gets the day as its date (`date`). An item without a name (or with a code name) gets a day name: "MM-DD-YYYY <type><n>", for example "09-01-2026 page1" or "09-01-2026 todo1".
- Days and time: right-click a card → "Days and time…". The dialog has "From [day] [time]" and "To [day] [time]". A day takes typed text ("YYYY-MM-DD" or "MM-DD-YYYY") or a click in a small month calendar (the button at its right). The same fields show in the item info of the item (setting "Show file details", row "Days", in place of "Date"); a valid change there saves after a short pause. There, a card with no time shows no time fields: "Add a time" shows them (a card on more than one day has no time). A card on one day shows one day field with no "From" and "To"; "Add an end day" shows the two rows.
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
- Change the width: select the frame. Handles show at the left and right sides of the frame; drag one. Each row then ends at the new right edge (a child row is narrower by its indent). In a horizontal outline, each row changes width in proportion. The width is the width of the rows (`w` of each place link), so the data format does not change. In an outline, a folded row keeps its width.
- Make an outline: select cards, right-click, "Make outline" (reading order), or right-click the board: "New outline here". Drop a card on a frame to add it.
- Reorder: drag a row in its frame, or right-click a row: move to front, up, down, to back, one level deeper (Tab), one level up (Shift+Tab). Alt+Up / Alt+Down also move a row.
- Direction (`direction` on the outline, frame menu): vertical (default), or horizontal: the top rows go from left to right, and the child rows of each top row go down under it.
- Right-click the frame: read as one document, direction, list marks, new outline, take all cards out.
- Take cards out: drag a row out of its frame (it stays where you drop it), or use the menu. An outline with no cards is deleted.
- A text page of an outline item shows previous / next buttons, and a "Document" toggle: the whole outline as one continuous text (like a cascade of notes). Each item keeps its own text and undo stack.
- Older vaults: `list` on an item and `rank` without `outline` stay in the data. The app does not use them.
- The export (section 8) writes an outline as one block, in its order, with numbers in the headings.

### 7.5 Editor

- Images in a text: paste or drop an image file (PNG, JPEG, GIF, WebP; up to 50 MB) into the text, or use the "Insert image" button of a page (a file dialog; the image goes to the cursor). If the paste event has no image (WebKit often gives none: a screenshot, an image copied in an app, an image file copied in Finder), the backend reads the system clipboard (clipboard.rs: file URLs of images; else PNG, JPEG, or TIFF data, and TIFF becomes PNG). A paste with usual text stays a text paste. The app copies it into `images/` of the vault (name from the file name and a hash of its content: the same image is one file, and an existing file is never written again) and writes plain Markdown at the cursor, on its own line: `![](images/<name>)`. The editor shows the image under its Markdown; on a line without the cursor, only the image shows. Only vault images show: the app makes no network request, so a web image (`![](https://…)`) shows its address only. A card preview shows an image as `[alt]`. Size: drag the handle at the right edge or the bottom-right corner of an image (on hover). The image keeps its shape. On release, the width goes into its Markdown as in Obsidian: `![alt|320](images/<name>)` (320 px wide; at most the width of the text). Undo gives the old size back. Place (pages): right-click an image and choose Left, Alone, or Right. Left or Right goes after the width in its Markdown, `![alt|320|right](images/<name>)`: the image floats at that side (at most half the text width when it has no width) and the next lines of text go beside it. Alone (the default) removes it. Other Markdown apps show the image as usual; card previews and read aloud leave the `|…` part out. A file dropped from the system (Finder) comes to the window as an app event (the window takes system drops): on a text, an image file (PNG, JPEG, GIF, WebP) is copied into `images/` as with "Insert image", and its Markdown goes to the nearest text position of the drop point (the whole page or window counts, also the margins and the space below the text); other files are not added (a short message shows), and the board under the text gets nothing.

- The editor shows the body text of one item.
- The app has no side panel. Each open item has its own floating window above the board. You can move, resize, and close each window.
- ⌘B (Ctrl+B) bold, ⌘I italic, ⌘U underline: marks around the selected text (`**bold**`, `*italic*`, `<u>underline</u>`), or away if it has them. Markdown has no underline: `<u>…</u>` is the usual form; the editor shows it underlined.
- Press Cmd+K (Ctrl+K), or right-click selected text, to make a text link (section 2.3). The right-click menu also has "Comment" and "Add URL…".
- While a text page is open, its tools are in the main tool bar, in place of the board tools: highlight, pen, eraser (with colors), the comment button, the small-item button, and "Link selected text". The page head has only the chapter arrows and the title (the title has the full width). "Show file location" (the page tools, and the window bar) goes to the home board of the item (its parent), with its card centered and selected (also on a board that just opened: its first "fit all cards" does not move the view), and a yellow box flashes twice around the card (each jump to a card does this); it is a step in the view history. A page is a medium-sized item: it holds small items (section 1.1). The small-item button has a list of all small kinds (note, comment, URL, action item, flashcard, quote, text): choose one, then click anywhere on the page (on the text or in a margin): the item is made there, inside the page (an `inside` link). A double-click on a kind keeps the tool on until Esc. Text that is selected when the kind is chosen: the item points to it. "Comment" (right-click selected text) makes a comment that points to the text, in the column. An item that points to text has a faint dashed curve to the end of that text (stronger while the item is hovered); the link bench can point an item to text later (section 7.11). Drag the head of a small item onto the board (outside the page): it moves out and becomes a free card there (it stops pointing to text). Drag a small card from the board onto an open page: it moves into the page. One undo step each. A note (in a window) is a small item: it has attached comments (`on`), not small items. The small items of a page show only in the page, never on the board: on the board, the page card shows a pink dot at its top-right corner while it has open (not resolved) comments. In the page, they start in a column tight at the right edge of the text (shown by default; the comment button in the main tool bar hides or shows it), by the place of the text that they point to, then by time; the column scrolls with the text. It never makes the text narrower: it is always at the side (a narrow window scrolls sideways). Drag its right edge to change its width (setting `commentWidth`, 160–640 px). Drag the head of a comment or note to put it anywhere in the page (over the text or in the margin); its place is saved in its `inside` link, and Undo moves it back. The fold arrow of a comment folds it to its head and the first line of its text (view state, not saved). Double-click a comment or note to edit it. A comment or link attached to a card that is not a page still shows at the side of that card on the board.
- Marks: highlight, pen, and eraser buttons (page head, window bar) with four colors. Highlight marks the selected text (with no selection, each selection until Esc); the right-click menu has "Highlight" and "Remove highlight". The pen draws on the text; the eraser removes a highlight or a scribble (a click, or a sweep with the button held over strokes). Marks are in `marks/<id>.json`, never in the text. Edits move highlights; a highlight also keeps its text, to find it again after a change outside the editor. Scribbles keep their position in the text area: if the text flows again (another width), a scribble can move away from its words.
- Scribbles on a text page use the whole width of the page: the pen also draws in the margins at the left and the right of the text. The points stay in text area units (a margin point has x < 0 or x > the text width), so old marks files stay valid. In an editor window, the pen draws on the text area. The lasso (mark tools) selects scribbles: draw around them (a scribble with at least half of its points inside is selected). Drag a selected scribble (or the selection box) to move them; Delete removes them; Esc ends the selection.
- Duplicate check: if another item has the same first sentence (at least 24 characters, or 10 CJK characters), a warning shows under the head: "This text can be a copy", with "Open". It changes nothing. The X hides it until the app closes.
- Each window has its own undo stack (section 5.2).
- An item can be open in only one window at a time. If you open it again, the app brings its window to the front.
- Version 1 has no font or text color. Later: a small inline HTML subset.
- The editor must not change bytes that the user did not edit. (This is a data integrity rule.)
- Cursor: each item keeps its last cursor (and selection) while the app is open. When the item opens again (a window, a text page), the cursor is where it was and scrolls into view; a text page takes the focus, ready for typing. If the text is shorter now, the cursor goes to its end. View state only: never saved.
- Live preview: Markdown marks are hidden on lines without the cursor. A line of "---" or "===" always shows (also under a text line). Text in square brackets without a target ("[text]", "[ ]") is plain text: its brackets show, and it has no link style. A link has an address "[text](…)" or a reference label "[text][label]".

### 7.7 Plugins

- A plugin is a separate program. The core app does not compile it and does not include it. The user installs it by hand. The protocol is in `docs/PLUGINS.md`.
- The plugins folder: release builds use the folder that the user selects in Settings. The app keeps only this path, in `plugins.json` in the app config folder. Development builds use only `data/plugins` in the repository.
- The app starts a plugin program at its first call. The program stops when the app stops.
- A plugin gets only the data of its calls. It has no access to the vault.
- Plugins in this repository (each in `plugins/<name>`, with its own build): `translate` (offline translation), `chinese` (Simplified ↔ Traditional Chinese, also Taiwan and Hong Kong forms, character by character; notations such as 「」 stay as they are; offline; capability `convert-text`: it changes the text in place, as one command that undo reverts), `voice` (read aloud), `web` (save web pages and PDFs).
- Capability `convert-text` (for example, a script converter): the plugin menu has "Current item" / "Selected items" and "Whole board". The result replaces the item names and texts in the vault, as one command (⌘Z gives the old texts back). Code names do not change. Open editors show the new text at once.
- Capability `transform-text` (for example, a translator): the tool bar shows one button for the plugin. Its menu shows the plugin options and applies the plugin to the selected items or to all items of the board.
- The result is a **view overlay**. The plugin can send each text in parts while it works, so the result fills in at once:
  - The overlay shows in place of the item name and text on cards, outline rows, text pages, and editor windows. A chip "Show original" removes it.
  - The overlay is in memory only. It is never written to the store, to files, or to history. It goes away when the vault closes.
  - "Show originals" hides the overlays. They stay as a cache: "Show translations" (or "Show translation" on a page) shows them again at once. The same text with the same options is never sent again. The text so far of a translation that did not end (a cancel, an error) shows, but the next run sends that text again.
  - The result shows in place of the text, or side by side: the text at the left (it can be edited), the result at the right. Side by side is paragraph-aligned: each result paragraph starts level with its paragraph (blank-line blocks; a heading, a list item, a quote, and a code block are blocks of their own). The shorter side of each row gets empty space; it is not text and is not saved. Both sides scroll as one. The paragraphs pair by content: the length of each paragraph (in the scale of each language; one CJK character counts as about three Latin letters), its kind (a heading pairs with a heading, code with code), and the numbers and links in it. Thus a paragraph that the plugin joined, split, or left out does not move the rows after it. While it reads aloud, the sides are not aligned. The divider can move (20 % to 80 %). A double-click sets it to half and half. The layout and the divider position are vault settings.
  - Cards on a board always show the result in place of their text.
  - A saved web page or PDF: "This page" (plugin menu, while the page is open) translates the page paragraph by paragraph (each line of the page text) into a column at the right of the page, on the reader canvas: it scrolls and zooms with the page.
    - In a PDF, the lines of a page join into paragraphs: a paragraph ends at a new page or column, at more space than the usual line distance of the page, at a change of the font size, at a short line (it ends before the right edge of its column), before an indented line, and before a list item. CJK lines join without a space.
    - Equations: a line made mostly of math glyphs (math letters such as 𝑃 𝑿, Greek, operators, digits, brackets; at most one long word) is a paragraph of its own; the pieces of one equation (a fraction, an index above or below, a close second line) join it. Equations are not translated: the column shows them as they are.
    - Paragraphs come from the layout of the page: a web page block is a paragraph; the lines of a PDF join into paragraphs by their places (the same column, a small space, the same text size; a superscript or a part of a formula stays in its line). Each result is in a box with the place of its paragraph: the same top and height, and the same place across, scaled to the width of the column (two columns of a PDF show as two columns). The text gets smaller until it fits, then it scrolls in the box. Thus the column never drifts. Single words, page numbers, and formulas get no box. Boxes can overlap a little: a press on one brings it to the front. While the page is read aloud, the box of the spoken sentence scrolls so that its mark is in view.
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
  - Formulas: with a `math-text` plugin (plugins/math) and "Formulas → words" on, read aloud says each formula as words (off: no formula work; a formula is read as its text) ("a over b"). In a note or a page, a formula is LaTeX between `$…$`, `$$…$$`, `\(…\)`, `\[…\]`, or a code block with the language `math`, `latex`, or `tex`. Text in code, an escaped `\$`, and amounts ("$5 and $10") are not formulas (Pandoc rules: no space after the opening `$`, no space before the closing `$`, no digit after it). In a saved web page, a formula is MathML (KaTeX, MathJax, Wikipedia): its LaTeX source if the page has it, else the MathML. The pictures of a formula (KaTeX HTML) are not read. A sentence break inside a formula is not used. A formula that the plugin cannot read is said as its LaTeX. The words are short (plugins/math: MathCAT, ClearSpeak): the arguments of a function without "open paren … close paren" ("f of x, y, z"), "p of theta given y star", "the expectation over y star of …", "n choose k", a long fraction as "A, over B", a matrix with dots as "the matrix from a sub 1 1 to a sub n n" (one column: "the vector from …"), a label above as "superscript". These are rules on the formula structure and on the words: they do not cover all papers (a known limit; a language model could make the words natural later). Saved audio files say formulas the same way. Without the plugin, formulas are read as text. Formulas are said slower than the reading: by the setting `speechFormulaSlower` ("Formulas slower by" in the Read aloud menu: 0, 0.25, 0.5 (default), 0.75, or 1 speed units). The voice makes the formula part of the clip slower (`speak` with `parts`); a speed change makes the clips ahead that have formulas again. A PDF has no LaTeX: with a `math-image` plugin (plugins/mathocr), formulas are found only when they are needed, and nothing is done ahead. Just before the clip of a sentence is made (so for the sentences ahead of the reading), the app finds the formulas of its pages (the page drawn to an image; about 2 s a page), reads the LaTeX of the formulas in the sentence only (about 1 s each), and says the sentence with their words. The pages in view do the same for the formula notes. One job at a time; the pages in view draw first. The characters of the PDF text in the box of a formula are its range; a formula whose range runs into the next sentence is said in the first one only. Found formulas and their LaTeX are kept while the app is open and in `.inspoboard/cache/formulas/<key>.json` (with the size and page count of the PDF: a different PDF starts again). The reading never starts again when formulas are found.
  - "Formulas → words" (setting `formulaNotes`): one button in the tool bar of a page, a saved web page, and a PDF (with a `math-text` plugin; in a PDF also a `math-image` plugin). Off: no formula work at all. On: the formula notes show and read aloud says formulas as words. In a PDF, a spinner shows on the button while formulas are found or read. Off, or closing the reader, stops the work.
  - Formula notes ("Formulas → words", setting `formulaNotes`): the words of each formula in the left margin of a saved web page or a PDF, level with the formula (section 1.1: the left side is for automatic annotations). View only, never saved. Each note is at the height of its formula (a web page: the box of the visible formula, not of its hidden MathML; a PDF: the boxes of the formula's text, measured as the boxes of the translation column, so both line up; a formula with no text, a picture: its box from the plugin; only the pages in view have notes), as high as the formula (at least two short lines), and it never moves to make room (as the translation boxes): its words get smaller until they fit, then they scroll. Notes can overlap: a press on one brings it to the front. Hover: the LaTeX. While the formulas of a PDF are found, the beaker button turns and the entry shows the pages done.
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
  - Playback: two audio players take turns (double buffering). While a clip plays, the next clip (when it is made) loads in the other player, so the next sentence starts without a gap. The time left is counted one time for each reading (the words from each sentence to the end), not at each redraw. The readers (PDF, web page, text) render again only when the spoken sentence changes (and, with the "ready" cursor on, when the ready audio grows): not at each change of the read-aloud state.
  - Buffer: the app asks the plugin for the current sentence first, then for the next ones. At most 2 requests run at the same time (the voice plugin has 2 offline models: it makes 2 clips in parallel). A long sentence is made while the ones before it play. "Audio ahead" (Read aloud menu; setting `speechAhead`):
    - "About 1 minute" (default): until about 900 characters of speech are ready ahead (2 to 20 sentences). A step or a stop wastes little work, and memory stays small.
    - "To the end, while it plays": all sentences to the end of the text, while it plays.
    - "All audio first, then play": the bar shows "Making the audio: n / total" and, after a few clips, the time left (from the speed so far); it plays when all clips are ready. The clips stay until the reading ends, so a step back is at once. All audio stays in memory (about 48 KB for each second of speech): use it only for short texts. The other two choices play at once.
  - A bar shows play, pause, sentence steps, speed, and volume. A pause holds the reading also between two clips (or while the next clip is made): nothing plays until "Play". Speed and volume apply at once. A change of a plugin option (the voice, the pitch) while it reads plays the current sentence again with the new option. A change of a reading setting while it reads ("Do not read" options, voice-out mode, "Audio ahead") drops all audio that is ready: reading goes on from the current sentence with the new setting. Their values are vault settings.
  - The audio is in memory only. "Save audio file…" lets the plugin write one file at the location that the user selects. It uses the skip rules too.
  - If the text of the item changes, reading stops.
- The selected plugin options are vault settings (`pluginOptions` in `.inspoboard/settings.json`).
- Plugin actions (for example, "Download pack") show in Settings → Plugins. They run only when the user clicks them. The details of each plugin (description, actions) are folded: the arrow button next to "Read the plugins folder again" and "Select the plugins folder" shows them. Errors and running tasks always show.

### 7.8 Web pages

- With a plugin that has the capability `save-page`, the app saves web pages and PDFs from the web in the vault. The core app has no network code: the plugin gets the page.
- A saved page or PDF is the copy of a document (section 1.1): it belongs to one link object. Its files are `web/<id>.html` (or `.pdf`) and `web/<id>.notes.json` (id: the link object). Two link objects with the same address have two copies. A paste of a copied link object copies its files and the small items in it. A page that opens with no link object (a web address or a PDF path in a text) uses the oldest link object of that address. If that item has no card on the current board, the board gets a shadow of it (a reference card: a click opens the same item; one undo step). It never makes a second item for the same document. Only an address with no item gets a new link object on the current board. The same address: a web address without its fragment; a local file by its path ("file://" and URL escapes such as "%20" do not count). An item that opens a page (a card, a small item, a web link in the comment column) gives its own ID: that item is the link object. Format-1 vaults had one shared copy for each address (`web/<hash>.*`); the migration script gives each link object its own copy.
- PDF files from this computer: the globe button → "Open a PDF file…" copies the PDF into the vault (as the copy of its link object) and opens it. No plugin is necessary.
- The PDF reader is the pdf.js viewer (`PDFViewer` of pdfjs-dist/web/pdf_viewer.mjs: the page viewer of the Firefox PDF reader, as Zotero and Hypothesis use it), loaded when the first PDF opens. The app does not make its own page engine: the viewer draws only the pages near the view (and keeps the last ones), makes their text layers (selectable text) and their link layers, and draws again after a zoom. It is on the canvas of the web page reader (same tools, margins, notes). Page units are PDF units at scale 1; the pages are one under the other with a gap of 14 units, and their sizes are not rounded to whole pixels, so notes stay on the page at any zoom. Only the reader scrolls the canvas: a zoom keeps the point under the pointer; a link inside the PDF goes to its place; a link to a web address opens in the web browser.
- The text of a PDF (read aloud, find, marks, links, the translation) comes from the text items of each page (pdf.js text content, in the worker), as PDF readers keep it: never from the screen, so it is the same at any zoom and time, and it is ready before a page is drawn. Each item keeps its place on its page; marks are boxes from these places (a part of an item is placed by the widths of its characters, as the text layer places them). A selection maps to the text by its span (the text layer has one span for each item with text, in the same order). The text leaves out numbers in the side margins (line numbers of a manuscript, a page number at the side). Content must never go, so the rule is narrow: a run of only 1–4 digits, all left or all right of the text column of its page (the span of its runs of 15 characters or more), that is either in a straight column of 3 or more such numbers that count up from the top down (line numbers), or alone on its side and above or below all the text (a page number). Numbers of a table or a figure that stick out of the column stay. PDFium (backend) still makes page images for the formula store and the compare view. PDF.js data files (character maps, fonts) come from `public/pdfjs` (copied from `node_modules` before dev and build); no network. Scripts in a PDF never run.
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
- A PDF highlight also keeps its place on the pages (as Zotero does): `boxes`, each [page, left, top, width, height] in PDF page units (scale 1, from the top left of the page). It shows there, whatever the zoom or the text. Older highlights (no boxes) are found by their text.
- "Save again from the web" on a page with notes asks first: the new copy replaces the saved one (the old copy is not kept), and scribbles, comments, and notes keep their places on the canvas.
- Lazy-load images (for example the figures of bioRxiv): the plugin saves the real image (`data-src`, `srcset`), and replaces the lazy-load classes (`lazyload`, `lazy`, …) with `lazyloaded`, because the page styles hide an image that has no "loaded" class and the saved page has no scripts. For pages saved before this, the reader does the same in the shown page only (the file does not change).
- The reader shows the page above the board, in a frame. The page has no scripts (the plugin removes them) and its content security policy blocks scripts and all network access. The frame allows scripts only because WebKit runs no event listener of the reader (click to read, selection) in a frame without that permission.
- The Read aloud menu reads the open page or PDF: from the start, the selected text only, or from the selected text on. "Read aloud" on a link object (its menu, or the plugin menu with the link selected) saves its page if necessary, opens it, and reads it from the top.
- If it cannot read, the reader says why (no Read aloud plugin, no text on the page).
- Select tool (default): while Read aloud reads this page, a click on text moves the reading there (not with the lock on). A click does not start a reading (needs a `speak-text` plugin). There is no separate read tool and no "Read from the start" button in the reader: the Read aloud menu has the read buttons. "Save again from the web" and the globe button are at the end of the tool bar. With the lock on, a click on the text does not move the reading; a short reminder shows over the lock button. The speed number in the bar can be typed (double-click it); the bar keeps its width while the reading goes on or the speed is dragged. The spoken sentence has a strong mark and stays in view: when it reaches the lowest 15% of the view (or is above it), the view scrolls to put it in the center. The view follows only a new sentence: zoom works while it reads, and a zoom never moves the view back. After a scroll of the user, it does not follow for 4 s. Menus, page heads and feet (outside the article), and hidden parts are not read.
- Links: ⌘-click saves and opens the linked page. A click on a "#" link goes to that part of the page.
- Ctrl+click on a link works as ⌘-click (in texts, saved web pages, and PDFs). On macOS, Ctrl+click is also a right-click: on a link the menu does not open; elsewhere Ctrl+click opens the menu as before.
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
  - Click a slot to pick it (the slot pulses). Then a drag of any card, or of a comment or a note in a page, drags a ghost copy of it (its name). The item does not move, and the view does not get the press. A drop on the bench puts the item in the picked slot (or in the slot under the pointer), and the pick ends. A click on a card (no drag) puts it in the picked slot, and the pick ends. Esc, a click on the slot again, "Link", and folding or hiding the bench end the pick: while a slot is picked, cards do not select or open, so a pick must never stay on unseen.
  - A drag of a comment or a note in a page by its head, released on the bench, puts it in the slot under the pointer. The comment does not move.
  - Drag selected text onto a slot, or click "Selected text": the last text that the user selected in a note, a page, a saved web page, or a PDF.
  - "Search…": a search of all boards (names and texts). A hit in a text gives that exact text; a hit in a saved page gives the words found.
  - Right-click a card or selected text → "Send to link bench".
- A slot shows the item name, and the passage (or "Whole item"). A click on it shows that end.
- A small item (the whole item) at one end, and text of its own home (a page, a saved web page, or a PDF) at the other end: the button is "Point to text". The item then points to that text (section 1.1). One undo step.
- "Link" makes one command (one undo): a relation link from the source to the target. A target passage is `quote`. A source passage in a note or page text becomes `[passage](link:<id>)` in that text (as "Link selected text"). If the text cannot hold it (a web page or PDF, a passage of more than one line or with a bracket, or a text that changed), the link keeps the passage in `fromQuote` (new optional field) and no text changes.
- Links made from text (a passage at one end or both: a text link `[words](link:<id>)`, `fromQuote`, or `quote`) show in their items, not on boards or in 3D: only a link between two whole items draws a line there, by default. Per link, the user can put it on boards too (`onBoard: true` on the link): the eye button of its shadow (on hover; it stays visible while on). Then it draws as a dashed gray line between the cards of its two items, on boards and in 3D, like a whole-item link (selected, it has its caps and label; double-click follows it to the passage). Its context bar has a button to take it off boards again (only in its items). In each item, the linked passage has a faint translucent gray highlight (the same gray in a page, a saved web page and a PDF; overlapping passages show one gray), and a shadow of the other item (a faint card with a dashed border: its kind, its name, and the other passage) is next to it with an arrow to the passage. A page: the shadow is in the comment column, by the place of the passage (with the small items). A saved web page or PDF: the shadow is in the right margin (in the left margin while the translation column shows), level with the passage; shadows do not cover each other. A click on the shadow goes to the other item at the exact other passage (a page opens at it; a link object opens its saved page or PDF there). A jump from a document (a text page, the document view, or the web page or PDF reader) never leaves the document: the other item opens in a window over it, at the passage (a passage of the same page: the page scrolls to it). Only a board opens in place. A double-click on the window bar opens the item as a full page (expand). Back closes the window again. ⌘-click on a gray passage does the same. The unlink button of a shadow (on hover) removes the link; a text link in the source becomes its words again (one undo step). The Links button of the reader and the link list of a page still list all links.
- A linked passage moves with its text. In the editor of a page, each gray passage follows the edits: text added before it moves it, and a change inside it changes the passage. The editor saves the new passage to its link end (`quote`, `fromQuote`, or the `quote` and `at` of a small item) as it saves the text; an undo of the edit moves the link end back. Text typed at the edge of a passage stays out of it. If all of the passage is deleted, the link does not change: if the words come back (cut and paste), the link finds them by their words. A text link `[words](link:<id>)` is in the text, so it moves with the text and its link does not change.
- Saved web pages and PDFs (link objects) have the link features of a page: The Links button of the reader lists "Links to" and "Linked from". A jump to a passage of a web page or PDF opens the reader and finds the passage.
- Going to the other end of a link (an item link `[label](item:<id>)`, a relation link, the link lists, the bench) always shows the item where it is: a board opens, a note shows on its board, a page opens, and a link object opens its saved web page or PDF at the passage. It never opens a link object or another small item as a board (that showed an empty board with only the title: a wrong assumption fixed 2026-10-11).

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

### 7.13 Buzzies mode (built-in plugin)

Buzzies mode hides the user's text on the screen and keeps the structure, for screenshots of a vault that do not show its contents, and for work where other people can see the screen. The app works as usual while it is on.
- Two styles (setting `buzzStyle`, Settings › Plugins, under "Buzzies mode"): "Glyphs" (default: each word becomes glyphs, as below) and "Blur" (the user's text blurs evenly; the screen text does not change). The chip at the bottom changes the style for this time.
- It is a built-in plugin: it is part of the app, in its own folder (`src/ui/plugins/buzzies/`), and it is on by default. Settings › Plugins › "Buzzies mode" turns it off (setting `buzzies`; then its entry does not show). The More menu (⋯) has the entry; Settings › Top bar can show it as a button.
- Glyphs: the user's text on the screen becomes glyphs: board cards, the outline, the path in the top bar (with the vault name), the galaxy labels, the page editor, saved web pages (and their text layers). UI text of the app ("3D", tool names, menu entries: a text of the language packs, in English or in the UI language) stays readable, except in user text areas (a card named like a UI word is buzzed). Any other text (names, dates, numbers) is buzzed.
  - Each word becomes symbols (`!@#$%^&*()`) or blocks (about one word in three is symbols). Blocks follow the letter shapes: tall letters and digits get tall blocks (▆▇█), letters below the line get low blocks (▂▃), other letters middle blocks (▄▅), some vowels empty blocks (▯▭).
  - Spaces and line ends stay. Each character gives one glyph. Any language: letters of scripts other than Latin get blocks of a height from the hash; a run of more than 12 characters with no spaces (Thai, Lao, Khmer, Burmese, a long address) is cut into pieces of 3 to 7 characters; combining marks give no glyph. Wide characters (Chinese, Japanese, Korean, full-width signs such as 「」) have no spaces between words: a run of them is cut into pieces of 2 to 4 characters (the length comes from the characters), and each piece is a word, so it is symbols or blocks. Wide symbols stay wide (＃); a wide character in a block word gets a block of a height from its hash (some empty).
  - The glyphs come from the word: the same word gives the same glyphs everywhere and each time.
- Icons, checkboxes, and scribbles blur a little. Pictures, PDF pages, and videos blur strongly. Text fields blur. Tooltips do not show.
- Animation: the text scatters into its glyphs (each text starts at a random time in the first 0.25 s, two random glyphs, then its glyphs; about 0.5 s). At the end, the same animation goes back.
- Input: clicks, drags, keys, file drops, and the editor work as usual (also in the 3D view: points move). The mode changes only the screen, never the store, the files, or the history. In the glyph style, the screen text is glyphs, so a selection, a copy, a cut, or a drag of screen text is blocked (not in text fields and editors: their text is the real text). So glyphs never go into an item. Esc ends the mode (in a text field, Esc stays the field's), or the chip at the bottom ("Show the text"), or the entry again.
- The page editor does not change its text in the DOM (the editor would read that as typing). In the glyph style, it shows each word as a widget with the buzzed glyphs; in the blur style, its text blurs. The user can type: the editor keeps the real text.

### 7.14 Multimedia items

A multimedia item is a picture, a song, or a video. An album or a playlist is a group of media items: an outline or a group card holds them, in its order. A playlist can mix pictures, songs, and videos.
- Data: the optional item field `media`: `{kind, url?, file?, artist?, cover?, duration?}` (section 4).
  - `kind`: `image`, `audio`, or `video`. The item name is the title.
  - `url`: the page of the item on its site (https). `file`: a vault file of the item (a picture: `images/<name>`). `cover`: the cover art (`images/<name>`). `duration`: seconds.
  - The card stays a note card (`view` "note"): an older app version shows a media item as a note, and keeps the `media` field when it saves (it keeps unknown fields).
- The card: the cover (a picture shows itself; no cover: a sunny-morning placeholder), the name, the artist, the kind, and the length. Buttons on hover:
  - edit the fields (name, artist, link, kind; choose or remove the cover; make it a note again);
  - open the link in the web browser (a double-click does the same);
  - "Get title and cover", only with a `media-info` plugin.
- No player and no embedded page: a player of a site loads from the network and tracks its viewers. The card shows only what is in the vault.
- Make a media item:
  - Paste a link on a board. If its site is in the media sources, the link becomes a media item at the pointer (with only the link).
  - The media button in the tool bar (at the right of the small items; key U): a click on the board makes an empty media item there, with its fields open.
  - Right-click on the board: "New media item here" (empty fields), or "New picture here…" (a file dialog; the picture is copied into `images/`).
- Media sources (Settings › Cards): the sites whose links become media items, each with the kind of its items. The user can turn off, remove, and add sites. The defaults: open.spotify.com, music.apple.com, soundcloud.com, bandcamp.com (music); youtube.com, youtu.be, vimeo.com (video). Subdomains count (m.youtube.com).
- No login and no account. The core makes no network request for media.
  - **Network:** "Get title and cover" uses a `media-info` plugin (the web plugin has it). It reads only the clicked link: the preview tags of the page and its oEmbed data (docs/PLUGINS.md). The cover is saved in the vault, so the card works offline.
  - Some sites give less to programs. Spotify gives no artist. An Apple Music song link gives the album title. The user can edit the fields.

### 7.15 Compare (lab plugin)

- Two items side by side with their differences, as in WinMerge. A lab plugin (plugins/compare, capability `compare-text`, `"lab": true` in its plugin.json): experimental. Settings → Plugins shows a "Lab" mark. Without the plugin, no Compare button shows.
- The compare bench: its own floating panel (the look of the link bench, section 7.11, but a separate feature: the link bench has no compare button). It shows only while a compare plugin is installed; More ⋯ › "Compare bench" shows or hides it (it can be in the top bar). Two slots, Left side and Right side. Fill a slot: drag a card onto it; "Selected text"; "Search…"; right-click a card → "Send to compare bench"; or click the slot, then click a card (the click goes to the slot; the card does not select or open; Esc stops it; folding or hiding the bench stops it; a pick on the link bench stops it, and the other way round). "Compare" opens the compare view; ⇄ swaps the sides. Folded, it is a round button with a dot for each full slot. Its place and state stay in this window (view state).
- Also: select two cards on a board and right-click → "Compare side by side".
- A link object whose file is a PDF on this computer gets its copy in the vault when it is compared (as when it opens in the reader). If a side has no copy, or its PDF cannot be read, the view says so and does not compare (never an empty text that looks "the same"). Two empty texts: "Both sides have no text".
- Each side is an item (its text), a passage (its words), or a link object with a saved web page or PDF (its page text, as the search reads it). A note, a page, and a text card can change here; a saved page or PDF is read-only.
- The plugin compares word by word (Patience algorithm), not line by line: the layout does not count. Spaces and line breaks are not compared, and a hyphen inside a word is not compared ("trans-" at a line end + "duction", "self-attention", and "selfattention" are the same word). So two PDFs with the same words and a different layout are the same. Curly and straight quotes are the same. Chinese and other text without spaces: each character is a word. Options (the bar): word by word or character by character; ignore upper and lower case. The view compares again after each change (after 0.12 s).
- Changes: a run of changed words on one side and the other. An equal part between two changes that is not longer than each of them joins them into one change (the "semantic cleanup" of diff-match-patch): a changed sentence is one change, not scattered words.
- Rows: the same text, then a change, then the same text, …, with the left side and the right side level. A change is yellow (both sides have words), red (only the left side), or green (only the right side), with a hatched empty cell on the other side. A long same part shows only its ends near the changes, and a button shows the rest ("Show 120 more words that are the same"). A PDF or a saved page shows its line breaks as spaces; a note or a page shows its own lines. One scroll for both sides.
- The arrows (and Alt+↓, Alt+↑) go to the next and the previous difference. "Difference 3 of 12". Click a change: it becomes the current one.
- Copy: the → and ← buttons of each change copy its words (with the space before them) to the other side (WinMerge "copy to right / left"), only into a side that can change. One undo step ("Copy difference"). A passage side: only the passage changes, and the side follows the new passage. Linked passages in that text are found again by their words (section 7.11).
- Two views (the bar has "Text" and "PDF pages" when a side is a saved PDF; it opens in Text). The current change stays when the view changes, and it comes into view.
  - Text: the rows above.
  - PDF pages: each side in its own pane (its own scroll). A PDF side shows its pages (drawn by PDFium, as in the reader; by pdf.js without PDFium) with a box over each change, on its words: yellow, red, or green as in the rows. Where only the other side has words, a thin bar shows the place. The other side (a note, a page, a saved web page) shows its text with the same marks. Click a box or a mark: it becomes the current change (outline). Next and previous scroll each pane to its own place of the change.
  - The boxes come from the same text that is compared: the pdf.js text items of each page with their boxes (the change is a range of that text). A part of a text item is placed by the widths of its characters (measured in the font family of the item).
- A change only in a figure, an image, or the layout is not found (no pixel compare).
- Swap: the two sides change places. Esc or × closes the view. The compare view is view state: nothing is saved but the copied text.

### 7.16 Sorting tray (built-in plugin)

A sorting map is a board that takes the items of other collections out, a few at a time, to sort them in a new order (for example a mind map of a calendar). The items stay in their sources: the map holds references.
- On or off: Settings › Plugins › "Sorting tray" (vault setting `tray`, default on). Off: no tray and no tray entries. A map stays a board with its cards.
- Data: the map is an item with `sources` (a list of IDs). A source is a collection (an item with its own board) or a group (an outline or a calendar). `discarded` (a list of item IDs, optional): the items that the user threw away. `lostAndFound` (true, optional): Lost and found is a source. Both fields are optional: older vaults do not change.
- Make a map: right-click a collection card, an outline frame, or a calendar frame → "Make a sorting map". A new board item "Map of <name>" goes next to it, with the source; the map opens. "Add to a sorting map…" adds the source to a different map (the item picker). In the tray, "+" adds a collection.
- The tray (bottom left of a map, right of the zoom buttons, in the look of the link bench; it folds into a round button with the number of waiting items): the items of all sources that are not sorted and not thrown away. Sorted: on the map, or in a board on the map at any depth (a card put into a collection on the map is put away). A source on the map does not count. It is not saved: a new item in a source comes into the tray by itself. New items: the items of the tray made after the last visit of the map (its time in `.inspoboard/opened.json`, from before this visit) show as "New (n): added to the sources since your last visit" (a list of their names), the folded tray has a yellow dot, and "Pull new" takes only them (X at most). No new data. Group cards (loose areas) are not items to sort.
- Pull: takes X random items out of the tray onto the map, around the middle of the view, in a loose grid with a little random offset. X: "Each time" in the tray (vault setting `trayCount`, 1–50, default 5). Each card is a reference with the kind, size, color, and open state of the card in its source. One undo step.
- A card on a map shows as the real card (its kind and color) with a dashed edge (not as a gray ghost). A double-click opens the item in a window, as for each reference.
- Right-click cards on a map: "Back to the tray" (the reference goes off the map) or "Throw away" (the reference goes off the map, and the item goes into `discarded`). Delete on a map is "Throw away". On a processing map, Delete on a copy deletes the copy (as on any board) and throws its originals away. The tray lists the thrown-away items ("Thrown away (n)"); Restore puts one back into the tray. The items themselves never change, and nothing goes to the trash.
- Sources: each source is a chip in the tray; × removes it (its cards on the map stay).
- Lost and found: a source of all items that the root board cannot reach (core/lost.ts). An item is reached through its cards, the small items inside an item, and the objects attached to an item. Lost: an item in the trash, and an item on a board that is itself on no board that the root reaches (for example two boards that hold each other only: they are not in the trash, and search does not find them). The tray offers each lost group once, at its top (the item that holds the others; for a ring, its oldest item). A pull puts the top on the map: an item from the trash gets a real card there (it leaves the trash), a lost board gets a reference, and all that it holds is reached again. The map field `lostAndFound: true` (optional) turns the source on; the life buoy button in the tray adds it, × removes it. The trash shows the number of lost items and a "Lost and found" button: it opens the "Lost and found" map of the root board (made at the first use).

#### Processing maps and lineage

A processing map is a detached sorting map: its cards become the map's own items, made from the originals. The user changes them (edits, clips, merges, translations) and the originals do not change. A processing map can be the source of a different map: each step makes one generation more.
- Detach: the branch button in the head of the sorting tray. A dialog shows the scope: the number of items in the sources and their size (texts and saved web pages and PDFs), for example "Up to 412 items, about 96 MB, can be copied". Detach and Cancel. The dialog also tells the user that after the first copy, the map cannot be attached again. The map gets `detached: true` (optional field).
- Attach again: while no item on the map (at any depth) is a copy (no `madeFrom`), the tray head shows "Attach again": the map is a sorting map again (`detached` goes). After the first copy, detach cannot be taken back (undo can still take back each step).
- Copies (setting `detachCopies`, Settings › Plugins, under "Sorting tray"): "On first edit" (default): a card stays a reference until the user opens it from the map to edit it; the window then shows a new copy, and the card shows the copy. A copy that closes with no change goes again (the card is a reference again). "All now": at detach, all cards on the map become copies (the dialog shows their size). "New pulls only": cards already on the map stay references; each later pull makes copies.
- Copy on write (in each mode): the originals never change from the map. A change on a board of the map (the map, or a board in it) to the item of a reference card changes a copy: the copy is made first, the card shows it, and the change goes to the copy. This applies to all changes there: the name, text, color, and fields; small items and links made on it; cards and groups put into a collection. Opening a reference card (a window, a page, or the board of a collection) makes the copy too. A delete on the map takes only the card away. The copy and the change are one undo step.
- A copy: a new item with the name, text, kind, and fields of the original. A collection (an item with its own board) stays a reference until it changes or opens: its copy then gets a reference card of each item of the original board (at the same place), and copies of its groups and scribbles. The items in it are not copied until they change. A copy that the user opened and closed with no change (no field, text, or card of its board changed) goes again. A saved web page or PDF is copied too (its file and its notes). Its field `madeFrom` (optional) is a list of `{from, seen}`: the ID of each source item, and the version of that source when the copy was made (a hash of its name and text).
- "Make a copy" (card menu, on a processing map): a copy of the item next to the card. The user can then change the copy and the original separately.
- Clips: text that the user copies from an item A and pastes into an item B on a processing map gives B a source A (`madeFrom`). Text from several items gives several sources. Many to many: an item can have many sources, and an item can be the source of many items.
- Lineage: the items with `madeFrom`, their sources, and the sources of those (at any depth). Only items in a lineage get the marks and prompts below.
- The tray of a processing map: an original is imported (not in the tray) while an item on the map (at any depth) came from it (its reference, a copy, or an item with a clip of it). "Back to the tray" takes the card off the map: the original is in the tray again. "Throw away" keeps it out.
- Outdated: an item is outdated when the current version of one of its sources is not the `seen` version. Only the items made directly from the changed item are outdated; items further down show "an ancestor changed" in the lineage view. The tray of a processing map has an "Updates (n)" list: its outdated items. Each entry: "Open both" (the item and its changed source side by side) and "Same meaning" (the change is accepted: `seen` becomes the current version; the item does not change).
- Soft freeze: an item in a lineage that has descendants shows a bar when it opens: "This was processed further. Edit the newest version?" with the newest descendants (the items of the last generation made from it) and "Edit here anyway". A change there makes the items made from it outdated; a short message names them, with "Same meaning" for all.
- Data compatibility: `detached` and `madeFrom` are optional. Older vaults do not change. An older app keeps the fields as they are.

#### Evolution plot (3D)

The 3D view has the mode "Evolution": items are in generations. Each generation is a loose cloud ("nebula") on its own plane, far from the other planes.
- Generation: the longest chain from an item with no parent. Depth by (a choice in the 3D view): "Made from" (`madeFrom` links), "Nesting" (boards in boards, cards in groups), "Both" (default).
- Layout: "Walls" (default: generations from left to right) or "Floors" (generations upward). The nebula depth (slider) gives each generation a thickness; the space between generations stays larger.
- Spread: each item starts near its sources, then items push each other apart. A generation with more items is wider. A label for each generation: its number, its count, and its main kinds.
- Lines: made-from links (warm) and nesting links (gray). Outdated items have an orange ring.
- A click on an item shows its lineage: its ancestors and descendants stay bright, the other items fade. A card names the item, its generation, and the items it was made from. Escape clears.

### 7.17 Graphs: radial

The tool bar has a "Graphs" button (at the right of the media button). Its only type now is the radial (key R).
- A radial is a core (a short text) with cards around it, spread as a ball. It is a group: an outline record with `type: "radial"`. Its `name` is the text of the core, and its `x`, `y` is the center of the core. Optional fields: `radius` (the radius of the ball, 120–900 board units; missing: 260) and `seed` (the spread; missing: 1). Its cards are place links with `outline` = the radial, as the rows of an outline. Older versions do not know the type: they show the cards at their own place.
- The core: a light red circle with white text. A short text makes a small circle; it grows with its text (56–180 units). Double-click the core to write its text (text only). A new radial opens its text for typing.
- The place of each card comes from the spread (not saved). Directions go evenly over a sphere (Fibonacci points), each moved a little at random; the distance to the core is 55 % to 100 % of the radius, so the cards interleave. The same seed gives the same spread. A thin line goes from the core to each card. On the board a card never covers the core and its text: its distance from the center (front view) is at least half the core, half the card (its diagonal), and 16 units; a card near the front or the back of the ball goes out to that distance (its depth stays).
- The board shows the ball from the front. The 3D view shows the ball: each card at its offset from the core, with its depth; the core is a light red ball. A drag of the core moves the radial with all its cards, on the board and in 3D (3D: in the plane of the board; the depth of the core is not saved). The cards of a radial do not move by themselves in 3D.
- Add cards: drop cards on the core. Cards of an outline or a calendar leave it. Take a card out: drag it out of the ball (it stays where it is dropped), or right-click → "Take out of radial" (it stays where it shows). A drop inside the ball keeps the card there: its place link gets `offset` ([x, y, z] from the center of the core; optional; z stays as it was). "Spread again" does not move it. It loses `offset` when it leaves the radial.
- Right-click the core: "Spread again" (a new seed), "Size" (S, M, L, XL: radius 180, 260, 400, 600), "Take all cards out", rename, and export as one document (the core, then each card). Delete on the core deletes the radial; its cards stay where they show.

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
| Menu | Tauri menu API | Vault menu: open, open in a new window, new, close. |
| Atomic files, lock, watch | Rust: `std`, `notify` | Integrity code stays in a small, strict layer. |
| History | Rust: `git2` (with bundled libgit2) | The user does not need Git installed. |
| UI | React, TypeScript, Vite | Largest set of usable packages. |
| App state | Own `Store` class + React `useSyncExternalStore` | No state package needed. The store holds the tables. |
| 2D board | `@xyflow/react` (React Flow) | Controlled component: our store stays the single source. MIT. |
| Freehand | `perfect-freehand` | Smooth strokes, small code. |
| 3D | `three`, `@react-three/fiber`, `@react-three/drei` (Line, OrbitControls only) | Standard three.js stack. |
| Editor | CodeMirror 6 | Keeps the exact bytes of the text. Obsidian uses it. |
| PDF reader | `pdfjs-dist` (pdf.js) and its viewer components (`PDFViewer`, `PDFLinkService`) | The page viewer of the Firefox PDF reader: drawing of the pages in view, text layers, links, zoom. Its worker parses the PDF and gives the text of each page. |
| PDF page images | PDFium (`pdfium-render`; prebuilt library `chromium/8100` from bblanchon/pdfium-binaries, BSD-3) | Page images for the formula store and the compare view, natively on a thread of its own. A resource of the app (`scripts/fetch-pdfium.mjs` gets it at build time, with a SHA-256 check). |
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
  pdf_pages.rs     PDF pages drawn by PDFium: one render thread; the URI scheme `pdfpage`.
  debug_log.rs     The session log (see below).
src/
  core/            Pure TypeScript. No React. No Tauri.
    types.ts       Record types.
    ids.ts         ID generation.
    store.ts       Tables in memory. Body text is the "texts" table.
    commands.ts    Ops, history, undo, redo.
    actions.ts     Command builders. One for each user action.
    scribbles.ts   Command builders of scribbles (actions.ts exports them too).
    relations.ts   Command builders of relation links (actions.ts exports them too).
    records.ts     Read a record for a builder (a missing record is an error).
    graph.ts       Derived data: children, parents, relations, inline references, ghosts.
    refs.ts        Read inline references from Markdown.
    search.ts      Section 7.4.
    replace.ts     Section 7.4 (replace).
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
    board/         React Flow adapter: board model (boardModel.ts), the flow nodes and edges (flowAdapter.ts), card
                   nodes (nodes.tsx, objectCards.tsx, mediaCard.tsx), group frames (outlineNode.tsx, calendarNode.tsx),
                   right-click menus (boardMenus.tsx). BoardView.tsx holds the board state; its gestures are hooks:
                   card drags (useCardDrag.ts), copy and paste (useBoardClipboard.ts), drawing (useDrawDone.ts).
                   Only this folder imports @xyflow/react.
    galaxy/        3D view: galaxy model and three.js adapter. Only this folder imports three.
    editor/        CodeMirror adapter and live preview. Only this folder imports @codemirror.
    windows/       Floating editor windows and the full text page.
    dialogs/       Item picker and search.
    tools/         Tool registry, draw overlay, stroke helpers.
    plugins/       Plugin menu, plugin settings, view overlay. Built-in plugins have their own folder: buzzies/,
                   compare/, tray/ (sorting tray).
plugins/<name>/    Plugins. Each one is a separate project with its own build. Not part of the app build.
    theme/         Dark theme tokens.
```

Session log (for debugging): one file for each app session, `<vault>/.inspoboard/logs/session-<UTC time>.log`. Vault › "Show Session Log in Finder" shows the file. The last 10 logs stay. Each line is written at once, so a log is complete up to a crash or a force quit. It has events (views by ID, commands by label, PDF and read-aloud timings, slow saves and history snapshots, plugin starts, slow or failed plugin calls, plugin error output), errors, and the watchdog: the UI sends a heartbeat each second; 5 s without one is written as "The UI does not respond". It has no text of notes or pages; names in quotes are left out. A new session says if the last one did not end normally. Backend commands that read, make history, back up, or import run off the main thread; writes stay on it (in call order).

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
