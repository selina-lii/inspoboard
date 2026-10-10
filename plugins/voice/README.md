# Voice plugin (read aloud)

Reads notes and pages aloud in English, for Inspoboard. Three ways to use it:

- **Highlight**: the app marks each sentence in the text while it reads.
- **Subtitle**: the app also shows each sentence large: in a window above all apps (drag it to move it), or above the board.
- **Save audio file**: one WAV (offline voices) or MP3 (online voices) file at a location that you select.

Speed and volume change while it reads (the bar at the bottom), and their values stay in the vault settings. Voice and pitch are in the plugin menu. Type the pitch as a change in Hz: `+2`, `-1` (the field shows the unit). `0` is the natural voice.

Keys while it reads: ← and → go to the previous and next sentence. Ctrl + ← and → change the speed by 0.1 (Settings can change Ctrl to ⌥).

"Do not read" in the plugin menu skips citations (APA, MLA, IEEE, and others), text in brackets, or parts of the reference list. The app applies these rules; the plugin gets only the words to say.

## Voices

- **Offline (Kokoro)**: 11 English voices (US and UK) in one 320 MB pack (the full model: it speaks about two times faster than the small one). Download it in Settings → Plugins. After that, no network.
- **Online (Microsoft Edge)**: 8 English voices. These send the text to Microsoft each time they read. Use them only for text that can leave your computer.

## Build

This plugin is not part of the app build (`npm run build` and `npm run tauri build` do not build it).

```sh
cd plugins/voice
cargo build --release
cargo test --release
```

The first build downloads the sherpa-onnx libraries (static, about 40 MB) from the sherpa-onnx GitHub releases.

## Install

```sh
mkdir -p "<plugins folder>/voice"
# On macOS, remove the old program first. Copying over it makes macOS stop the new one (code signature cache).
rm -f "<plugins folder>/voice/inspoboard-voice"
cp target/release/inspoboard-voice plugin.json "<plugins folder>/voice/"
```

The voice pack goes into `<plugins folder>/voice/packs/`.

## Licenses

- Kokoro 82M: Apache 2.0. sherpa-onnx: Apache 2.0. espeak-ng data: GPL-3.0 (in the pack, used as data).
- Microsoft Edge voices: the online service of Microsoft. Its terms apply.
