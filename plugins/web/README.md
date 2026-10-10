# Web pages plugin

Saves a web page (or a PDF from the web) as one file in the vault, so that Inspoboard can show it and read it aloud offline.

- The plugin gets the page, its style sheets, images, and fonts. They go into the page as data.
- Scripts, frames, forms actions, and event attributes are removed. The saved page has a content security policy that blocks all network access.
- The app stores the page as `web/<key>.html` in the vault. Your highlights and scribbles go to `web/<key>.notes.json`: the page file never changes for them.
- Limits: 4 MB for each file, about 24 MB for all files of a page, 55 MB for the saved page. After that, more images keep only their text.
- Pages that need scripts to show their text (some web apps) save without that text. Some sites refuse programs that are not browsers (error 403).

Network: only for the page that you ask to save, and the files of that page. The plugin keeps nothing.

## Build

This plugin is not part of the app build (`npm run build` and `npm run tauri build` do not build it).

```sh
cd plugins/web
cargo build --release
cargo test --release
```

## Install

```sh
mkdir -p "<plugins folder>/web"
# On macOS, remove the old program first. Copying over it makes macOS stop the new one (code signature cache).
rm -f "<plugins folder>/web/inspoboard-web"
cp target/release/inspoboard-web plugin.json "<plugins folder>/web/"
```

For development (the test plugins folder `data/plugins`): `npm run plugin:web:dev-install`.
