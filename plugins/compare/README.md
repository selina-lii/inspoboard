# Compare plugin (lab)

Shows the differences between two items side by side, word by word. Spaces, line breaks, and hyphens inside words are not compared, so two PDFs with the same text and a different layout are the same. Small same parts between two changes join them, so a changed sentence is one change. It works for notes, pages, text cards, and the text of saved web pages and PDFs. Chinese and other text without spaces differs by character.

- Capability `compare-text` (docs/PLUGINS.md). The app finds the texts and shows the result; the plugin only compares.
- Lab: experimental (`"lab": true` in plugin.json). The app marks it as such.
- Offline: the `similar` crate (Apache-2.0 / MIT). No network, no files.

## Use

Put two items in the compare bench (More ⋯ › Compare bench; drag cards onto its slots), then click "Compare". Or select two cards on a board and right-click → "Compare side by side".

## Build and install

```sh
npm run plugin:compare
```

Then copy `target/release/inspoboard-compare` and `plugin.json` into `<plugins folder>/compare/`, and restart the app. For the test vault: `npm run plugin:compare:dev-install`.
