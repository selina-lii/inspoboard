# Ask the vault plugin

Questions about your notes, saved web pages, and PDFs, answered offline from your own texts. A lab plugin.

- Search: EmbeddingGemma 300M (0.3 GB pack). It makes the vectors of passages and questions: search by meaning.
- Answers: Gemma 3 4B (2.5 GB pack). It answers from the numbered passages only, and cites their numbers.
- Packs download only when you click "Download pack" in Settings → Plugins. After that, the plugin needs no network.
- The plugin keeps nothing. The app keeps the search index in the vault (`.inspoboard/cache/ask/`).
- Memory: about 0.5 GB for search, and about 3 GB more while it answers. The answer model is freed after 5 minutes
  without a question.

## Build

This plugin is not part of the app build (`npm run build` and `npm run tauri build` do not build it).

You need Rust and CMake (`brew install cmake`). The first build compiles llama.cpp. It takes some minutes.

```sh
cd plugins/ask
cargo build --release
cargo test --release
```

## Install

Copy two files into an `ask` folder in your plugins folder:

```sh
mkdir -p "<plugins folder>/ask"
# On macOS, remove the old program first. Copying over it makes macOS stop the new one (code signature cache).
rm -f "<plugins folder>/ask/inspoboard-ask"
cp target/release/inspoboard-ask plugin.json "<plugins folder>/ask/"
```

- Release app: select the plugins folder in Settings → Plugins.
- Development app: the plugins folder is `data/plugins/` in the repository (`npm run plugin:ask:dev-install`).

The packs go into `<plugins folder>/ask/packs/`.

## Licenses of the models

- EmbeddingGemma and Gemma 3: Gemma Terms of Use.
