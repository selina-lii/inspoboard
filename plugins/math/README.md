# Math plugin (formulas as words)

Read aloud says formulas as words, for Inspoboard. For example, `$\frac{a}{b}$` is read as "a over b", and `$x^2 + y^2$` as "x squared plus y squared".

- **Notes and pages**: LaTeX between `$…$`, `$$…$$`, `\(…\)`, `\[…\]`, or in a code block with the language `math`. Text in code is not a formula. Amounts such as "$5 and $10" are not formulas.
- **Saved web pages**: formulas as MathML (KaTeX, MathJax, Wikipedia). The plugin reads the LaTeX source of the formula if the page has it, else the MathML.
- **Formulas** in the Read aloud menu: "Natural (ClearSpeak)" (short) or "Exact (MathSpeak)" (it says where each part starts and ends).

Offline. English only (the voices speak English). It uses MathJax (LaTeX to MathML) and Speech Rule Engine (MathML to words), both Apache 2.0.

## Build

This plugin is not part of the app build. It needs Node 22 or later.

```sh
cd plugins/math
npm install
npm test
npm run build
```

The build makes one program from Node (a single executable application). The first build downloads the official Node program of the same version from nodejs.org into `.cache/` and checks its SHA-256 (some Node builds, for example Homebrew, cannot make one). The program is about 140 MB.

## Install

```sh
mkdir -p "<plugins folder>/math"
# On macOS, remove the old program first. Copying over it makes macOS stop the new one (code signature cache).
rm -f "<plugins folder>/math/inspoboard-math"
cp -R dist/inspoboard-math dist/mathmaps plugin.json "<plugins folder>/math/"
```

Then in the app: Settings → Plugins → "Read the plugins folder again".
