# Math from images plugin

Finds the formulas on a page image (a page of a PDF) and reads their LaTeX, offline. The app uses it for read-aloud
and the formula notes of PDFs. The words of the formulas come from the "Math to words" plugin (plugins/math).

- Models: Pix2Text 1.5 (formula detection MFD and recognition MFR, ONNX, about 200 MB). They download only when you
  click "Download the formula models" in Settings → Plugins. Each file has a fixed address and SHA-256.
- Engine: ONNX Runtime (CPU), in the program. No Python.

## Build

This plugin is not part of the app build.

```sh
cd plugins/mathocr
cargo build --release
cargo test --release
```

The first build downloads the ONNX Runtime library (the `ort` crate does this once).

## Install

```sh
mkdir -p "<plugins folder>/mathocr"
# On macOS, remove the old program first. Copying over it makes macOS stop the new one (code signature cache).
rm -f "<plugins folder>/mathocr/inspoboard-mathocr"
cp target/release/inspoboard-mathocr plugin.json "<plugins folder>/mathocr/"
```

- Development app: the plugins folder is `data/plugins/` in the repository.
- The models go into `<plugins folder>/mathocr/models/`.

## Licenses

- Pix2Text models: MIT (model cards of breezedeus/pix2text-mfd-1.5 and pix2text-mfr-1.5). Note: the metadata in the
  detection model file names Ultralytics (AGPL-3.0), the library that trained it.
- ONNX Runtime: MIT.
