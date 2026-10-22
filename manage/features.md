# Inspoboard features

One line for each feature, grouped as you use the app. Manager: `node manage/features.mjs` (see manage/README.md).

- **ID**: a short name. Use it with the manager: `node manage/features.mjs test pdf.text`.
- **Tests**: the automated tests of the feature. `speech` is `tests/speech.test.ts`. `cargo:src-tauri` (and
  `cargo:plugins/<name>`) are Rust tests; `node:plugins/math` is the math plugin test. `—`: no automated test yet.
- **Check by hand**: what to try in the app after a change to the feature.
- **SPEC**: the section of docs/SPEC.md with the full rules.

## Vault and data

| ID | Feature | What it does | Tests | Check by hand | SPEC |
|---|---|---|---|---|---|
| vault.format | Vault files | JSONL tables + Markdown texts; written back byte for byte; unknown fields kept | format | — | 3 |
| vault.open | Open a vault | Opens with checks; read-only if another window has it or it has errors | session | Open the test vault | 4.3 |
| vault.windows | Vaults in windows | Vault › Open Vault in New Window: one vault per window; a shown vault comes to the front; outside changes go to their own window | session | Open a second vault in a new window; edit both; open the first vault again from the second window; close one window | 4.6 |
| vault.save | Save cycle | Writes only changed files after a short delay; ⌘S saves now | session | Edit, wait, check the file | 4.2 |
| vault.outside | Changes from outside | Loads changes made by other programs; conflicts wait for the user | session | Edit a file in a text editor | 4.4 |
| vault.history | Time machine | Git snapshots of the vault (never pushed); snapshot before deletes | session, cargo:src-tauri | Restore an old version | 6 |
| vault.backup | Back up | Copies the vault data to `.backup/<time>/` | cargo:src-tauri | More menu → Back up | 6 |
| vault.lock | One window per vault | A lock file; a second window opens read-only | session, cargo:src-tauri | Open the vault twice | 3 |
| vault.migrate | Migrations | One-time scripts for old data (inside links); a second run does nothing | migrateInsideLinks | — | 3.3 |
| vault.trash | Trash | An item that loses its last card goes to the trash; restore or delete forever | trash | Delete a card, open the trash | 5.4 |
| vault.recent | Recently added | Items made in the last 30 days, newest first, with where they are (board path, page, or trash); a click shows the item | — | More → Recently added; click a row of an item in the trash | 5.4 |
| vault.undo | Undo and redo | Each action is one undo step; view steps too | commands | ⌘Z / ⇧⌘Z after a few edits | 5 |
| vault.names | Item codes | A page or board with no name gets a code | names, actions | Make an empty page | 2.1 |
| vault.dates | Item dates | Created, modified, and a user date | actions | Settings → show dates | 2.1 |
| vault.cache | Caches in the vault | App caches in `.inspoboard/cache/` (never in history or backups) | cargo:src-tauri | — | 10 |
| vault.log | Session log | One log file per session in `.inspoboard/logs/`; watchdog for a stuck UI | cargo:src-tauri | Vault › Show Session Log in Finder | 10 |

## Board (2D)

| ID | Feature | What it does | Tests | Check by hand | SPEC |
|---|---|---|---|---|---|
| board.cards | Cards | Notes, pages, boards, text cards on a board; drag, resize, select; an open note shows all its text | boardModel, actions | Make and move cards | 7.1 |
| page.subtitle | Page subtitle | Enter in a page name opens a subtitle line; shown gray italic under the name, also folded; searched, exported, read aloud first | actions, reading | In a page press Enter in the title, type a subtitle, Enter; fold its card on the board; read aloud from the start | 2.1 |
| board.collapse | Fold cards | Collapse or expand a card; Ctrl+Shift+P folds all | actions | Fold a page card | 7.1 |
| board.links | Link lines | Lines between cards with caps (arrow, circle, …), labels, own line color, dashed lines (also in 3D) | boardModel, actions | Link two cards, change caps, color, and dashes; switch to 3D | 7.1 |
| board.stubs | Stubs | A link to an item not on the board shows a short stub next to the card; drag it to set its place (saved) | boardModel | Link to an item on another board; drag its stub, move the card | 7.1 |
| board.ghosts | Ghosts | A deleted item that still has links shows as a ghost | boardModel, actions | Delete a linked item | 5.3 |
| board.open | Open a card | Double-click: a board zooms in, a note or page opens its text | — | Double-click each kind | 7.1 |
| board.nav | Back, forward, up, breadcrumb | Browser-like history of views, each step restored as it was (windows, board view, scroll); a jump is a step (from a document: a window over it, the document stays); Up goes out one level; double-click a window bar → full page; "Show file location" on pages and windows | navigation | Follow a text link from a scrolled page: the page stays, the target opens in a window; Back: the window is gone; double-click a window bar; Up; Show file location on a page | 7.1 |
| board.move | Move into a board | Drag cards onto a board card, or "Move into…"; an outline row brings its child rows, a dragged outline frame moves whole | actions | Drag a card onto a board card; drag an outline frame onto a board card; drag a row with child rows onto a board card | 7.1 |
| board.copy | Copy and paste cards | ⌘C / ⌘V copies small items and pages (with their small items) | clipboard | Copy a page, paste it | 7.1 |
| board.background | Backgrounds and colors | Board image or color (an image fills the view, or lies on the board like a cork board: it moves with the cards, holds them all, and the cards get pushpins), card colors (all card kinds; right-click → Card color), color manager | actions | Set a background image; switch it to "on the board" and pan, zoom, drag a card past its edge; color a flashcard from its menu | 7.1 |
| plugin.tray | Sorting tray | Sorting maps: references pulled X at a time from collections, calendars, outlines; back to tray, throw away, restore | tray | Right-click a calendar frame → Make a sorting map; Pull; throw one away and restore it | 7.16 |
| plugin.processing | Processing maps | Detach a sorting map (scope size first); copies on first edit / all / new pulls; Make a copy; clip lineage (madeFrom); imported originals stay out of the tray; Updates with Same meaning; soft freeze bar | lineage | Detach a map, rename or recolor a reference card and check the original did not change, open a card and type, close an unchanged one, add a card to a collection on the map; change an original and check Updates; open an original with copies | 7.16 |
| plugin.lost | Lost and found | Tray source of the items that the root cannot reach (trash, rings of boards); a pull salvages them; button in the trash | tray | Trash → Lost and found; Pull | 7.16 |
| board.shown | Shown-cards check | After a change, each card of the model must be drawn; a missing one is measured again and logged (IDs) | — | Session log after a big paste | 7.1 |
| board.radial | Radial graph | Core with cards spread as a ball; drop cards on the core; moves with the core in 2D and 3D; spread again, size | radial | Press R, click the board, drop three cards on the core, drag the core; switch to 3D and drag the core | 7.17 |
| board.reduce | Card kinds | A plain item cycles note → page → board | actions | Right-click → change kind | 7.1 |
| board.attach | Attached objects | Comments, URLs, action items on the side of a card | groups | Attach a comment | 7.2 |
| board.quote | Quote cards | Slim cards with quote marks; fold to two words | quote | Make a quote card | 7.2 |
| board.todo | Action items | Done removes it (undo brings it back); "Items by type" lists all items of a chosen type (default action items, choice kept) | groups, byKind | Mark one done; pick "Quote" in Items by type, reopen: still Quote | 7.4 |
| board.flashcard | Flashcards | A card with a question and an answer | groups | Make a flashcard | 7.2 |
| board.url | URL objects | A link object with a web address or a local file path | webPages | Double-click a URL card | 2.2 |
| board.filedrop | Drop files | Files from Finder: a URL card each, with the full path; also into a link field | — | Drop 2 files on a board | 2.2 |
| board.media | Media items | Songs, videos, pictures with cover, artist, link; from pasted media links or the media button (key U) | media, bundle | Paste a YouTube link; press U and click the board | 7.14 |
| board.mediainfo | Get title and cover | The web plugin reads title, artist, and cover of a media link (on a click) | cargo:plugins/web | Click "Get title and cover" | 7.14 |
| board.groupcard | Group cards | Loose areas (rectangle, free shape) that move their cards | groupShapes | Draw a group around cards | 7.12 |
| board.outline | Outlines | Rows in order with levels, numbers, bullets; drag to reorder | outline, boardModel | Make an outline from cards | 7.6 |
| board.calendar | Calendars | Week, month, and year views (saved per calendar); cards snap to days, span days, have times; week view: hour grid, drop sets the time | groups, calendarViews | Drag a note onto a day; switch to Week, drag it to 14:00; Year: click a day | 7.6 |
| board.scribble | Scribbles | Pen strokes on the board; lasso, split, join, erase | stamps, scribbles | Draw, then erase one stroke | 2.4 |
| board.bundle | Board bundles | Export a board as Markdown + data; import it as new records | bundle | Export, then import elsewhere | 8.1 |
| board.export | Export as text | A board as one linear Markdown document | linearize, outline | Export a board | 8 |
| board.zen | Zen mode | Hide the bars; only chosen buttons show | — | View › Zen Mode, Esc | 7.2 |
| board.lag | Card refresh | Cards keep their measured size between redraws (no vanishing cards) | — | Edit a calendar for a while; collapsed cards stay | 7.1 |

## Galaxy (3D)

| ID | Feature | What it does | Tests | Check by hand | SPEC |
|---|---|---|---|---|---|
| galaxy.view | Galaxy view | Children as dots in 3D, clusters of grandchildren, labels (Hide labels: only on hover) | galaxyModel | Switch to 3D; click Hide labels | 7.3 |
| galaxy.drag | Move in 3D | Drag a dot; its 3D place is saved | galaxyModel | Drag a dot, reopen | 7.3 |
| galaxy.explode | Explode | Spreads cards with no saved place | groupShapes | Click Explode | 7.3 |
| galaxy.tour | Tour | Cruising camera at one speed: whole board, half a round at each major star, throw arcs, whole board; glow; works in Buzzies mode | tour | Switch to 3D, click the route button; turn Buzzies on during it | 7.3 |
| galaxy.evolution | Evolution plot | Items in generations (made from, nesting, both); walls or floors; nebula thickness; lineage highlight on click; outdated rings | evolution | Switch to 3D, click the branch button; switch depth and layout; click an item | 7.16 |
| galaxy.lazy | Load on demand | The 3D code loads only when 3D opens (a faster start) | — | First switch to 3D shows "Opening the galaxy…" | 9 |

## Text pages and the editor

| ID | Feature | What it does | Tests | Check by hand | SPEC |
|---|---|---|---|---|---|
| editor.markdown | Live preview | Markdown marks hidden off the cursor line; "---" lines always show | — | Type **bold**; type a line, then "----" under it, click away | 7.5 |
| editor.cursor | Cursor kept | An item opens again with its cursor where it was (this run of the app) | — | Type in a page, go back, open it again | 7.5 |
| editor.format | Format keys | ⌘B ⌘I ⌘U put marks around the selection | formatting | Select, ⌘B | 7.5 |
| editor.images | Images in text | Paste (screenshot, copied image, image file copied in Finder: the backend reads the clipboard), drop (also from Finder, anywhere on the page), or "Insert image"; width kept as in Obsidian; right-click → place left/right with text beside it | images, reading | Paste a screenshot, an image copied in Preview, and a PNG copied in Finder; drop a PNG from Finder into a page; right-click it → Right, type text beside it | 7.5 |
| editor.marks | Highlights and pen | Highlight text, draw on the page, erase | webPages | Highlight a sentence | 7.5 |
| editor.duplicates | Duplicate check | Warns when another item starts with the same sentence | duplicates | Paste a known first sentence | 7.5 |
| editor.inside | Small items in a page | Comments and notes inside a page, in a column or placed anywhere | inside, boardModel | Add a comment in a page | 1.1 |
| editor.wordcount | Word count | Words and CJK characters in the file details | wordCount | Open file details | 1.1 |
| editor.document | Outline as document | The rows of an outline as one continuous document | outline | Click "Document" | 7.6 |

## Links

| ID | Feature | What it does | Tests | Check by hand | SPEC |
|---|---|---|---|---|---|
| links.text | Text links | `[label](item:…)` links in text; ⌘K | textLinks | ⌘K on selected text | 2.3 |
| links.bench | Link bench | Two slots: link any item, passage, or small item to another; a picked slot takes a clicked card and never stays on unseen | linkEnds | Link two passages; pick a slot, click a card (it fills the slot), then click a card again (it selects) | 7.11 |
| links.passages | Passage links | Exact passage to passage: gray mark + shadow card; on boards only if turned on per link (dashed gray line) | linkEnds | Open a linked passage; eye on its shadow → dashed line on the board; select it → hide | 7.11 |
| links.follow | Link ends follow text | A linked passage moves with its text when you edit | linkEnds | Type before a gray passage | 7.11 |

## Search

| ID | Feature | What it does | Tests | Check by hand | SPEC |
|---|---|---|---|---|---|
| search.find | Search (⌘F) | Names, texts, link labels, saved pages; all languages | search | Search a Chinese word | 7.4 |
| search.options | Search options | Match case, whole word, regular expression | replace | Turn on whole word | 7.4 |
| search.replace | Replace | Replace in all texts in one undo; never breaks links | replace | Replace a word, undo | 7.4 |
| search.page | Find in a page or PDF | ⌘F bar in the reader; type freely | translation | ⌘F in a PDF, type a word | 7.8 |

## Web pages and PDFs

| ID | Feature | What it does | Tests | Check by hand | SPEC |
|---|---|---|---|---|---|
| web.save | Save web pages | The web plugin saves a page as one file in the vault | webPages, cargo:plugins/web | Open a URL card | 7.8 |
| web.notes | Notes on saved pages | Highlights, scribbles, comments on a web page or PDF | webPages | Highlight in a saved page | 7.8 |
| web.local | Local files | Local PDF opens in the reader; other files show in Finder | webPages | Open a local PDF link | 7.8 |
| web.invert | Inverted colors | Invert the page colors in the reader | — | Contrast button | 7.8 |
| pdf.open | Open a PDF | The pdf.js viewer (PDFViewer, as in Firefox): pages near the view draw, text layers, links inside the PDF go to their page, web links open in the browser | pdfTextModel | Open a long PDF; scroll fast; click a reference link | 7.8 |
| pdf.text | PDF text | From the text items of each page (not the screen); lines joined into paragraphs; side-margin line and page numbers left out; a selection maps by its span | pdfTextModel, translation | Read a PDF with line numbers; select text and read from there | 7.8 |
| pdf.draw | Page images (PDFium) | Native page images for the formula store and the compare view | cargo:src-tauri | Compare two PDFs in PDF pages view | 7.8 |
| pdf.highlight | PDF highlights stay in place | A new highlight keeps its page boxes (PDF units, as Zotero); older ones are found by their text; marks come from the places of the text items | webPages, pdfTextModel | Highlight on page 5; zoom; close and open the PDF again (also in a window); the highlight is on the same words | 7.8 |
| pdf.zoom | Zoom | Zoom while reading; the point under the pointer stays; notes and marks stay on their words | — | Pinch while it reads; highlights and comments stay in place | 7.8 |

## Read aloud

| ID | Feature | What it does | Tests | Check by hand | SPEC |
|---|---|---|---|---|---|
| read.play | Read aloud | One sentence at a time with a mark; pause, steps, keys; two players take turns (next clip preloads); readers render once per sentence | speech, cargo:plugins/voice | Read a note; read a PDF: no gap between sentences, the page does not stutter | 7.7 |
| read.ahead | Audio ahead | Up to 100 sentences ahead, to the end, or all first (time left shows) | speech | Long PDF: starts at once | 7.7 |
| read.speed | Speed and volume | Change while it reads (pause/play by itself); type the speed (double-click) | speech | Drag the speed; double-click it | 7.7 |
| read.bar | Read-aloud bar | Fixed width; lock with a reminder; show the text read now | — | Click text with the lock on | 7.7 |
| read.follow | Follow the reading | The view scrolls the sentence to the center at the lowest 15% | — | Read a long PDF | 7.8 |
| read.skip | Do not read | Citations, brackets, reference lists are skipped | reading | Read a paper | 7.7 |
| read.markdown | Voice-out mode | Markdown, paper, or auto | reading | Read a Markdown note | 7.7 |
| read.translation | Read a translation | Reads the English side of a translated text | reading | Translate, then read | 7.7 |
| read.subtitle | Subtitle | Large sentence, also in a window above all apps | — | Turn on Subtitle | 7.7 |
| read.save | Save audio file | One WAV or MP3 file of the whole text | cargo:plugins/voice | Save audio of a note | 7.7 |
| read.voice | Offline voice speed | Threads from the CPU; silence at clip ends trimmed | cargo:plugins/voice | — | 7.7 |
| read.estimate | Listen time | A rough time to listen; time left counted one time per reading | speech | Open the Read aloud menu | 7.7 |

## Formulas

| ID | Feature | What it does | Tests | Check by hand | SPEC |
|---|---|---|---|---|---|
| math.button | Formulas → words | One Σ button; off: no formula work at all | — | Toggle Σ in a PDF | 7.7 |
| math.find | Formulas in text | `$…$`, `$$…$$`, math code blocks; MathML in web pages | formulas | Read a note with LaTeX | 7.7 |
| math.words | Formulas as words | Short English words for formulas (MathCAT) | node:plugins/math | Hear a fraction | 7.7 |
| math.pdf | PDF formulas per sentence | Found and read just before their sentence is said; cached per PDF | formulas | Read a PDF with formulas; no restart | 7.7 |
| math.slower | Formulas slower | Said slower than the reading (Read aloud menu, default 0.5) | formulas, speech | Hear a formula slower | 7.7 |
| math.notes | Formula notes | Words of each formula at the left, placed like the translation boxes | — | Notes level with their formulas | 7.7 |
| math.ocr | Formulas from images | The mathocr plugin finds formula boxes and reads LaTeX | cargo:plugins/mathocr | — | 7.7 |

## Plugins and translation

| ID | Feature | What it does | Tests | Check by hand | SPEC |
|---|---|---|---|---|---|
| plugins.host | Plugin programs | Separate programs, JSON lines; started on first use | plugins, cargo:src-tauri | Settings → Plugins | 7.7 |
| plugins.overlay | View overlay | Plugin results shown in place of text, never saved | plugins | Translate a board | 7.7 |
| plugins.compare | Compare (lab) | Compare bench (own panel, link bench look) → two items or passages side by side, as WinMerge but word by word (layout, line breaks, and in-word hyphens do not count): aligned rows of same text and changes, or (a PDF side) "PDF pages" with boxes on the changes; next/previous difference, copy a change to the other side | compareText, cargo:plugins/compare | Compare bench (More ⋯) → two cards → Compare; two PDFs never opened before (text shows); two versions of one PDF with a different layout ("The texts are the same", or only the real changes); switch to PDF pages: boxes on the right words, the current change in view; a page and a PDF; copy a difference, ⌘Z | 7.15 |
| translate.text | Translate | Translate items, pages, selected text, side by side | translation | Translate a page | 7.7 |
| translate.page | Translate a web page or PDF | Paragraph by paragraph, in a column level with the text | translation | Translate a PDF page | 7.7 |
| translate.skip | Do not translate | Citations and reference lists stay as they are | translation | Translate a paper | 7.7 |
| translate.save | Save translation to a file | Original with the translation after each line | webPages | Save a translation | 7.7 |
| chinese.convert | Chinese conversion | Simplified ↔ Traditional (plugin) | cargo:plugins/chinese | Convert a note | 7.7 |
| buzzies.mode | Buzzies mode | User text as glyphs (Chinese too: mixed symbols and blocks of heights) or an even blur (setting, chip); UI text stays; the app works as usual (no text selection in glyphs); Esc ends | buzz | More → Buzzies mode on a Chinese board; open a card, move one, type in a page; chip → Blur; Esc | 7.13 |

## App

| ID | Feature | What it does | Tests | Check by hand | SPEC |
|---|---|---|---|---|---|
| app.i18n | UI language | English, 简体, 繁體; every text translated | i18n, i18nCoverage | Switch language | 7.9 |
| app.theme | Light and dark | System, dark, light; font weight; page width | groupShapes | Switch theme | 7.10 |
| app.settings | Settings | One dialog with tabs; old settings files read with defaults | session, groupShapes | Open Settings | 7.2 |
| app.keys | Keyboard | US key positions for shortcuts; IME safe | keys | Use ⌘Z with a Chinese IME | 7.2 |
| app.dismiss | Menus close | Click outside or Esc closes menus and pickers | — | Open a menu, press Esc | 7.2 |
| app.freeze | No main-thread freeze | Reads, history, backups, imports run off the main thread | cargo:src-tauri | Back up a big vault while editing | 10 |
