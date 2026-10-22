# Math plugin (formulas as words)

Read aloud says formulas as words, for Inspoboard. For example, `$\frac{a}{b}$` is read as "a over b", and `$x^2 + y^2$` as "x squared plus y squared".

- **Notes and pages**: LaTeX between `$…$`, `$$…$$`, `\(…\)`, `\[…\]`, or in a code block with the language `math`. Text in code is not a formula. Amounts such as "$5 and $10" are not formulas.
- **Saved web pages**: formulas as MathML (KaTeX, MathJax, Wikipedia). The plugin reads the LaTeX source of the formula if the page has it, else the MathML.
- **PDFs**: the formulas that the plugin "Math from images" (plugins/mathocr) reads from the pages.
- Short words: "f of x, y, z" (no brackets around the arguments), "p of theta given y star", "the expectation over y star of …", "n choose k", "beta times xi, over 1 minus alpha", "the matrix from a sub 1 1 to a sub n n". The app gets two texts for each formula: one for speech and one for the screen (no sound spellings).

Offline. English only (the voices speak English). It uses MathJax (LaTeX to MathML, Apache 2.0) and MathCAT (MathML to words, MIT; ClearSpeak). MathCAT is a Rust helper program next to the plugin program (`mathcat/`).

## Build

This plugin is not part of the app build. It needs Node 22 or later and Rust (for the MathCAT helper).

```sh
cd plugins/math
npm install
npm test
npm run build
```

The build makes one program from Node (a single executable application). The first build downloads the official Node program of the same version from nodejs.org into `.cache/` and checks its SHA-256 (some Node builds, for example Homebrew, cannot make one). The program is about 140 MB, the helper about 5 MB.

## Install

```sh
mkdir -p "<plugins folder>/math"
# On macOS, remove the old program first. Copying over it makes macOS stop the new one (code signature cache).
rm -rf "<plugins folder>/math/inspoboard-math" "<plugins folder>/math/inspoboard-mathcat" "<plugins folder>/math/mathmaps"
cp dist/inspoboard-math dist/inspoboard-mathcat plugin.json "<plugins folder>/math/"
```

Then in the app: Settings → Plugins → "Read the plugins folder again".
