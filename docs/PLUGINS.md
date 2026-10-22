# Inspoboard plugin protocol, version 1

A plugin is a separate program. The core app does not compile it. The user installs it by hand.

## 1. Install

1. Build the plugin (see the README of the plugin).
2. Make a folder in the plugins folder, for example `<plugins>/translate/`.
3. Put these files in it:
   - `plugin.json`
   - the program that `plugin.json` names in `exec`
4. In the app, open Settings → Plugins and click "Read the plugins folder again".

Plugins folder:

- Release build: select it in Settings → Plugins.
- Development build: always `data/plugins/` in the repository. Git ignores this folder.

## 2. `plugin.json`

```json
{
  "protocol": 1,
  "title": "Translate",
  "version": "0.1.0",
  "exec": "inspoboard-translate",
  "capabilities": ["transform-text"]
}
```

- `lab` (optional, `true`): an experimental plugin. The app marks it "Lab" in Settings → Plugins.
- `exec` is a file name in the plugin folder. It cannot contain a path. On Windows, the app also finds `exec` + `.exe`.
- The app ignores unknown fields.
- If `protocol` is not 1, the app does not start the plugin.

## 3. Messages

- The app writes requests to stdin. The plugin writes replies and notes to stdout.
- Each message is one line of JSON.
- Write logs to stderr only. stdout is only for messages.
- When stdin closes, the plugin must stop.
- The app can send a request while a different request runs (for example, `cancel`). Handle each request on its own thread.

| Message | Shape |
|---|---|
| Request | `{"id": 7, "method": "transform", "params": {...}}` |
| Reply | `{"id": 7, "result": {...}}` or `{"id": 7, "error": {"message": "..."}}` |
| Note | `{"method": "progress", "params": {"done": 3, "total": 10, "label": "..."}}` |

## 4. Methods

### `info` (required)

The reply tells the app what to show.

```json
{
  "title": "Translate",
  "description": "One sentence for Settings.",
  "icon": "languages",
  "options": [
    { "key": "target", "label": "To", "default": "zh", "choices": [{ "value": "zh", "label": "Chinese" }] }
  ],
  "actions": [
    { "id": "download:zh-en", "label": "Download pack: Chinese ↔ English", "detail": "1.1 GB", "enabled": true }
  ]
}
```

- `icon`: `languages`, `speech`, `globe`, `sparkles`, `wand`, or `han` (one character for the option `target`: 繁 when it is `hans`, else 簡). Other values give a puzzle icon.
- `options`: the fields in the plugin menu. The app sends the values with each call. The app keeps the values in the vault settings.
  - A select box: `{"key", "label", "default", "choices": [{"value", "label"}]}`.
  - A text field: `{"key", "kind": "text", "label", "default", "placeholder", "pattern", "unit"}`. `pattern` is a regular expression (case is ignored). The app keeps only a value that matches it. `unit` shows after the field. Example: the pitch of the voice plugin, `"+2"` with the unit `"Hz"`.
- `actions`: buttons in Settings → Plugins. After an action, the app calls `info` again.

### `transform` (capability `transform-text`)

- Params: `{"texts": ["...", "..."], "options": {"target": "zh"}}`
- Reply: `{"texts": ["...", "..."]}`. It must have one string for each input text, in the same order.
- The texts are item names and Markdown body texts. Keep the Markdown structure.
- The app shows the result as a view overlay. The app never saves it.
- Progress notes: `done` and `total` count texts. `done` can be a fraction.
- A progress note can have `partial: {"index": <text index in the call>, "text": "<the text so far>"}`. The app shows it at once. The final reply replaces it.

### `transform` (capability `convert-text`)

- The same call as for `transform-text`. The app sends the name and the text of each item (two texts for each item, in that order).
- The app writes the result into the item names and texts, as one command: undo gives the old texts back. It shows no overlay. Code names (made by the app) do not change.
- Use it only for a change that keeps the meaning, for example a script conversion (Simplified ↔ Traditional Chinese). For a translation, use `transform-text`.
- The menu has "Current item" (or "Selected items") and "Whole board".

### `sentences`, `speak`, `export` (capability `speak-text`)

The app reads a note, a page, or a saved web page aloud. It plays one sentence at a time and marks it in the text. In subtitle mode, it also shows the sentence as a large subtitle. The app applies its skip rules (citations, reference lists) to the `speech` of each sentence before `speak`. Speed and volume change while it plays: the app changes the playback, not the audio.

- `sentences`: params `{"text": "...", "options": {...}}`. Reply `{"sentences": [{"start": 0, "end": 12, "speech": "Hello there."}]}`.
  - `start` and `end` are string indexes in UTF-16 units (as JavaScript counts them). The ranges must not overlap and must be in order.
  - `speech` is the text to say: without Markdown marks.
- `speak`: params `{"text": "<speech of one sentence>", "options": {...}}`. Reply `{"audio": "<base64>", "mime": "audio/wav"}`. The mime type must start with `audio/`.
  - Optional `"parts": [{"text": "...", "rate": 0.67}, ...]`: the sentence in parts, each said at its own speed (a formula slower than the text around it); `rate` is relative to normal speed. The parts make one clip, with a short pause between them. The app also sends `text` (all the parts): a plugin without `parts` says that at one speed.
- `export`: params `{"text", "speeches", "options", "path", "rate", "volume"}`. `speeches` (optional) are the words to say, one for each sentence, after the skip rules of the app. Without it, the plugin splits `text`. The plugin writes one audio file. It can change the extension of `path` to its audio format. Reply `{"path": "<final path>"}`. Send progress notes.

### `math` (capability `math-text`)

Read aloud says formulas as words with this plugin (for example "a over b"). The app finds the formulas: in a note or a page, LaTeX between `$…$`, `$$…$$`, `\(…\)`, `\[…\]`, or in a code block with the language `math`; in a saved web page, MathML (with its LaTeX source, if the page has it).

- Params: `{"formulas": [{"tex": "\\frac{a}{b}", "display": false}, {"mathml": "<math>…</math>", "display": true}], "options": {...}}`. Each formula has `tex` or `mathml`.
- Reply: `{"texts": ["a over b", "…"], "display": ["a over b", "…"]}`: one string for each formula, in the same order. `texts` is for speech; `display` (optional) is the same words for the screen (the formula notes), without the sound spellings that a speech engine needs. An empty string if the plugin cannot read a formula: the app then says its LaTeX.
- The plugin gets no toolbar button. Its options (if it has any) show in the Read aloud menu.
- plugins/math: MathJax (LaTeX to MathML) and MathCAT (MathML to words, ClearSpeak, a Rust helper next to the plugin program).

### `formulas` and `recognize` (capability `math-image`)

The app finds the formulas of a PDF with this plugin (plugins/mathocr: Pix2Text 1.5 models on ONNX Runtime). A PDF keeps formulas as glyphs or pictures, not as LaTeX. The words come from a `math-text` plugin.

- `formulas`: params `{"image": "<PNG, JPEG, or WebP as base64, or a data URL>", "read": true}`. Reply `{"width", "height", "formulas": [{"box": [left, top, right, bottom], "display": true, "score": 0.9, "tex": "\\frac{a}{b}", "texScore": 0.95}]}`. `box` is in pixels of the image. `display`: a formula on its own line (else in a line of text). With `"read": false`, the formulas have no `tex` (boxes only, faster).
- `recognize`: params `{"images": ["<base64>", …]}` (each image shows one formula). Reply `{"texts": ["<LaTeX>", …]}`.
- Progress notes: `done` and `total` count formulas.
- The models (about 200 MB) download only with the action "Download the formula models". Each file has a fixed address and SHA-256.
- The plugin gets no toolbar button.

### `save_page` (capability `save-page`)

- Params: `{"url": "https://…"}`. Reply: `{"kind": "html", "title", "url", "html"}`, or for a PDF `{"kind": "pdf", "title", "url", "data": "<base64>"}`. `url` is the address after redirects.
- `html` is one HTML document with all its files inside (data URLs). It has no scripts, no frames, and no event attributes. Its links are absolute.
- Add a content security policy to the page that blocks all network access: the app shows the page as it is.
- Progress notes: `done` and `total` count files. `label` is shown.
- The app stores the page in the vault (`web/<key>.html`). The plugin keeps nothing.

### `media_info` (capability `media-info`)

- Params: `{"url": "https://…"}` (the link of one media item, SPEC 7.14). Reply: `{"title"?, "artist"?, "kind"?, "duration"?, "cover"?, "coverType"?}`. All fields are optional.
  - `kind`: `"audio"`, `"video"`, or `"image"`. `duration`: seconds.
  - `cover`: the cover image as base64, and `coverType` its media type. The app keeps only `image/png`, `image/jpeg`, `image/gif`, and `image/webp`, and saves the cover in `images/` of the vault.
- The app calls it only when the user clicks "Get title and cover" on a media card. Never automatically.
- No login and no key. Read public data only: the preview tags of the page (Open Graph, Twitter) and its oEmbed data. Use no site-specific rules.
- The plugin keeps nothing.

### `compare` (capability `compare-text`, lab)

The app shows two items side by side with their differences, as WinMerge does (SPEC 7.15). The app finds the two texts (an item text, a passage, or the page text of a saved web page or PDF) and shows the result. The plugin only compares.

- Params: `{"left": "...", "right": "...", "options": {"detail": "word" | "char", "case": "compare" | "ignore"}}`.
- The plugin compares words (or characters), not lines: spaces, line breaks, and hyphens inside words do not count.
- Reply: `{"changes": [{"left": {"from", "start", "end"}, "right": {"from", "start", "end"}}, …], "words": [left count, right count]}`.
  - The changes are in order. `start`, `end`: the changed part of each text (UTF-16 indexes; `end` not included). A side with no words in the change has `start` = `end` (the place where the other side's words would go).
  - `from`: the end of the word before the change (0 at the start). A copy to the other side takes the text from `from` (the space before the words too).
  - The app refuses a reply whose changes are not in order or not inside the texts.
- The plugin gets no toolbar button.
- plugins/compare: the `similar` crate (Rust).

### `embed` and `answer` (capability `ask-vault`, lab)

"Ask the vault": an answer to a question from the user's own texts, with the passages that it comes from. The app finds the passages (its index of item texts, saved web pages, and PDFs) and shows the answer. The plugin only makes vectors and writes answers. It keeps nothing.

- `embed`: params `{"texts": ["..."], "titles": ["..." | null], "query": false}`. `query: true`: the texts are questions (no titles).
  - Reply: `{"dims": 768, "vectors": ["<base64>", …]}`, one for each text, in order. Each vector is little-endian f32 values, of unit length (a dot product is the cosine).
- `answer`: params `{"question": "...", "passages": [{"n": 1, "title": "...", "text": "..."}, …], "options": {...}}`.
  - Reply: `{"text": "..."}`. The answer uses only the passages, and cites them by their numbers in square brackets: `[2]`, `[1][3]`.
  - While it writes, progress notes have the text so far: `"partial": {"index": 0, "text": "..."}`.
- Options (`info`): `language` (the answer language, or `auto`), `passages` (how many passages the app sends).
- The plugin gets no toolbar button.
- plugins/ask: llama.cpp (`llama-cpp-2`), EmbeddingGemma 300M and Gemma 3 4B (packs).

### `run_action` (optional)

- Params: `{"id": "<action id>"}`. Reply: any value.
- Progress notes: `done` and `total` in any unit (for example, bytes). `label` is shown.

### `cancel` (required)

- Stop the running `transform`, `export`, `save_page`, or `run_action` as soon as possible. The stopped request replies with an error.

## 5. Rules for plugins

- Do not write to the vault. A plugin gets no vault path.
- Use the network only for an action that the user starts (a download, a page to save, an online voice), and say so in the action detail or option label.
- Keep files in the plugin folder only.
