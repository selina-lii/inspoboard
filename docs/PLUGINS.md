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
- `export`: params `{"text", "speeches", "options", "path", "rate", "volume"}`. `speeches` (optional) are the words to say, one for each sentence, after the skip rules of the app. Without it, the plugin splits `text`. The plugin writes one audio file. It can change the extension of `path` to its audio format. Reply `{"path": "<final path>"}`. Send progress notes.

### `math` (capability `math-text`)

Read aloud says formulas as words with this plugin (for example "a over b"). The app finds the formulas: in a note or a page, LaTeX between `$…$`, `$$…$$`, `\(…\)`, `\[…\]`, or in a code block with the language `math`; in a saved web page, MathML (with its LaTeX source, if the page has it).

- Params: `{"formulas": [{"tex": "\\frac{a}{b}", "display": false}, {"mathml": "<math>…</math>", "display": true}], "options": {...}}`. Each formula has `tex` or `mathml`.
- Reply: `{"texts": ["a over b", "…"]}`: one string for each formula, in the same order. An empty string if the plugin cannot read a formula: the app then says its LaTeX.
- The plugin gets no toolbar button. Its options show in the Read aloud menu.

### `save_page` (capability `save-page`)

- Params: `{"url": "https://…"}`. Reply: `{"kind": "html", "title", "url", "html"}`, or for a PDF `{"kind": "pdf", "title", "url", "data": "<base64>"}`. `url` is the address after redirects.
- `html` is one HTML document with all its files inside (data URLs). It has no scripts, no frames, and no event attributes. Its links are absolute.
- Add a content security policy to the page that blocks all network access: the app shows the page as it is.
- Progress notes: `done` and `total` count files. `label` is shown.
- The app stores the page in the vault (`web/<key>.html`). The plugin keeps nothing.

### `run_action` (optional)

- Params: `{"id": "<action id>"}`. Reply: any value.
- Progress notes: `done` and `total` in any unit (for example, bytes). `label` is shown.

### `cancel` (required)

- Stop the running `transform`, `export`, `save_page`, or `run_action` as soon as possible. The stopped request replies with an error.

## 5. Rules for plugins

- Do not write to the vault. A plugin gets no vault path.
- Use the network only for an action that the user starts (a download, a page to save, an online voice), and say so in the action detail or option label.
- Keep files in the plugin folder only.
