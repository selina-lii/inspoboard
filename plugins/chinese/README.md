# Simplified ↔ Traditional Chinese conversion plugin

Converts Simplified ↔ Traditional Chinese (also Taiwan and Hong Kong forms) for one item, the selected items, or a whole board. It replaces characters (and fixed phrases); it does not translate.

- Capability `convert-text`: the app writes the result into the item names and texts, as one command. ⌘Z gives the old texts back. Code names (made by the app) do not change.

- Offline: the conversion rules (OpenCC and MediaWiki, through the `zhconv` crate) are in the program. No network, no files.
- Code blocks and Markdown link targets do not change.

## Build and install

```sh
npm run plugin:chinese
```

Then copy `target/release/inspoboard-chinese` and `plugin.json` into `<plugins folder>/chinese/`, and restart the app. For the test vault: `npm run plugin:chinese:dev-install`.
