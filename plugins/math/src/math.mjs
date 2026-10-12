// LaTeX and MathML formulas as words: MathJax makes MathML from LaTeX, Speech Rule Engine makes words from MathML.
// Offline. English only (the read-aloud voices speak English).

import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { SerializedMmlVisitor } from "mathjax-full/js/core/MmlTree/SerializedMmlVisitor.js";
import { STATE } from "mathjax-full/js/core/MathItem.js";
import sreModule from "speech-rule-engine/js/index.js";

const sre = sreModule.default ?? sreModule;

/** The ways to say a formula. ClearSpeak: short and natural. MathSpeak: exact (it marks each start and end). */
export const STYLES = [
  { value: "clearspeak", label: "Natural (ClearSpeak)" },
  { value: "mathspeak", label: "Exact (MathSpeak)" },
];

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
// "bussproofs" needs an output that measures boxes. Words need none.
const tex = new TeX({ packages: AllPackages.filter((name) => name !== "bussproofs"), formatError: (_jax, error) => { throw error; } });
const document = mathjax.document("", { InputJax: tex });
const visitor = new SerializedMmlVisitor();

/** MathML for a LaTeX formula. */
export function texToMathml(source, display = false) {
  return visitor.visitTree(document.convert(source, { display, end: STATE.CONVERT }));
}

let current = null;

/** Starts the engine with a style. `json`: the folder of the rule files (next to the program in a build). */
export async function setup(style, json) {
  const domain = STYLES.some((entry) => entry.value === style) ? style : "clearspeak";
  if (current === domain) return;
  await sre.setupEngine({ locale: "en", domain, modality: "speech", ...(json === undefined ? {} : { json }) });
  await sre.engineReady();
  current = domain;
}

/** The words of one formula: `{tex}` or `{mathml}`. An empty string if the formula has an error. */
export function speak(formula) {
  try {
    const mathml = typeof formula.mathml === "string" ? formula.mathml : texToMathml(String(formula.tex ?? ""), formula.display === true);
    return sre.toSpeech(mathml).replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}
