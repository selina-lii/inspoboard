# Translate plugin

Offline translation for Inspoboard, for view only. The app shows the translation while it is open. It never saves it.

- Chinese ↔ English: Tencent Hy-MT 1.5 (1.8B, 1.1 GB pack).
- All other pairs: Google TranslateGemma (4B, 2.5 GB pack). 50+ languages of Europe and Asia.
- Packs download only when you click "Download pack" in Settings → Plugins. After that, translation needs no network.

## Build

This plugin is not part of the app build (`npm run build` and `npm run tauri build` do not build it).

You need Rust and CMake (`brew install cmake`). The first build compiles llama.cpp. It takes some minutes.

```sh
cd plugins/translate
cargo build --release
cargo test --release
```

## Install

Copy two files into a `translate` folder in your plugins folder:

```sh
mkdir -p "<plugins folder>/translate"
# On macOS, remove the old program first. Copying over it makes macOS stop the new one (code signature cache).
rm -f "<plugins folder>/translate/inspoboard-translate"
cp target/release/inspoboard-translate plugin.json "<plugins folder>/translate/"
```

- Release app: select the plugins folder in Settings → Plugins.
- Development app: the plugins folder is `data/plugins/` in the repository.

The packs go into `<plugins folder>/translate/packs/`.

## Licenses of the models

- Hy-MT 1.5: Tencent HY Community License. It does not apply in the EU, the UK, or South Korea.
- TranslateGemma: Gemma Terms of Use.
