// LaTeX and MathML formulas as words: MathJax makes MathML from LaTeX, MathCAT (a Rust helper program next to the
// plugin: ../mathcat) makes words from MathML. Offline. English only (the read-aloud voices speak English).
//
// Before MathCAT, the MathML gets some changes, so that the words are short and say what papers mean:
// - "∣" (\mid) is "|": MathCAT says "given" (p(θ | y)), or "such that" in a set.
// - y^* is "y star" (not "y superscript times"). A label or index above (x^{\mathrm{R}}, W^{\mu\nu}) is "superscript".
// - 𝔼 is "the expectation over …".
// - f(x), p(θ | y), softmax(x) are functions ("f of x").
// - A fraction with an operator above or below is "A, over B".
// - A matrix with dots (⋯ ⋮ ⋱) is "the matrix from a sub 1 1 to a sub n n"; one column: "the vector from … to …".
// After MathCAT, the words get some changes: "f of x, y, z" (no "open paren … close paren" around the arguments of a
// function), "equals", capital letters as capitals ("Q", not "cap q"). The text for the screen ("display") also has
// no sound spellings ("xi", not "zai") and commas for pauses.

import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { SerializedMmlVisitor } from "mathjax-full/js/core/MmlTree/SerializedMmlVisitor.js";
import { STATE } from "mathjax-full/js/core/MathItem.js";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";


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

/** The helper program: next to the plugin program (a build), or the Cargo build (development). */
function helperPath() {
  const beside = join(dirname(process.execPath), "inspoboard-mathcat");
  if (existsSync(beside)) return beside;
  return join(dirname(fileURLToPath(import.meta.url)), "..", "mathcat", "target", "release", "inspoboard-mathcat");
}

let helper = null;
function startHelper() {
  if (helper !== null) return helper;
  const child = spawn(helperPath(), [], { stdio: ["pipe", "pipe", "inherit"] });
  const waiting = [];
  createInterface({ input: child.stdout }).on("line", (line) => {
    let reply;
    try {
      reply = JSON.parse(line);
    } catch {
      reply = { error: "The helper gave a bad reply." };
    }
    waiting.shift()?.(reply);
  });
  const fail = (message) => {
    for (const resolve of waiting.splice(0)) resolve({ error: message });
    helper = null;
  };
  child.on("error", (error) => fail(`The MathCAT helper did not start: ${error.message}`));
  child.on("exit", () => fail("The MathCAT helper stopped."));
  helper = { child, waiting };
  return helper;
}

/** The words of MathCAT for MathML (an empty string on an error). */
function mathcat(mathml) {
  const { child, waiting } = startHelper();
  return new Promise((resolve) => {
    waiting.push((reply) => resolve(typeof reply.text === "string" ? reply.text : ""));
    child.stdin.write(`${JSON.stringify({ mathml, prefs: PREFS })}\n`);
  });
}

/** Stops the helper (when the app closes the plugin). */
export function stopHelper() {
  helper?.child.stdin.end();
  helper = null;
}

/** ClearSpeak, with short words (the changes below do the rest). */
const PREFS = {
  SpeechStyle: "ClearSpeak",
  Verbosity: "Medium",
  ClearSpeak_VerticalLine: "Given",
  ClearSpeak_MultiLineLabel: "None",
  ClearSpeak_MultiLineOverview: "None",
  ClearSpeak_Matrix: "Combinatorics",
  ClearSpeak_Fractions: "Over",
};

const MATH_NS = "http://www.w3.org/1998/Math/MathML";
const STAR = /^[*∗⋆★]$/u;
const DOTS = /[⋯…⋮⋱⋰]/u;
/** Letters that name functions in papers: f(x), p(θ), P(A), L(θ), … */
const FUNCTION_LETTERS = ["f", "g", "h", "p", "q", "F", "G", "H", "P", "Q", "L"];
const children = (node) => [...node.childNodes].filter((child) => child.nodeType === 1);
const nameOf = (node) => node.localName ?? node.nodeName;

function element(doc, name, text) {
  const node = doc.createElementNS(MATH_NS, name);
  if (text !== undefined) node.appendChild(doc.createTextNode(text));
  return node;
}

/** The changes of the MathML before MathCAT (see the top). Matrices with dots need words of their cells: async. */
async function prepare(mathml) {
  const doc = new DOMParser().parseFromString(mathml.replace(/<math(?![^>]*xmlns)/, `<math xmlns="${MATH_NS}"`), "text/xml");
  const all = (name) => [...doc.getElementsByTagNameNS(MATH_NS, name)];
  for (const mo of all("mo")) if (mo.textContent === "∣") mo.textContent = "|";
  for (const msup of all("msup")) {
    const [base, script] = children(msup);
    if (base === undefined || script === undefined || !STAR.test(script.textContent.trim())) continue;
    const row = element(doc, "mrow");
    row.appendChild(base);
    row.appendChild(element(doc, "mtext", " star"));
    msup.parentNode.replaceChild(row, msup);
  }
  // A label or an index above (x^{\mathrm{R}}, x^{\text{max}}, W^{\mu\nu}): "superscript …", not a power.
  for (const msup of [...all("msup"), ...all("msubsup")]) {
    const parts0 = children(msup);
    const subsup = nameOf(msup) === "msubsup";
    const script = parts0[subsup ? 2 : 1];
    if (parts0[0] === undefined || script === undefined || (subsup && parts0[1] === undefined)) continue;
    // MathJax wraps \mathrm{…} in a group of one part: look inside.
    let inner = script;
    while (nameOf(inner) === "mrow" && children(inner).length === 1) inner = children(inner)[0];
    const parts = nameOf(inner) === "mrow" ? children(inner) : [inner];
    const upright = parts.length > 0 && parts.every((part) => nameOf(part) === "mtext" || (nameOf(part) === "mi" && part.getAttribute("mathvariant") === "normal" && part.textContent.trim() !== "T"));
    const greekIndices = parts.length >= 2 && parts.every((part) => nameOf(part) === "mi" && /^[\u0370-\u03ff]$/u.test(part.textContent.trim()));
    if (!upright && !greekIndices) continue;
    const row = element(doc, "mrow");
    if (subsup) {
      // x_l^{R}: "x sub l, superscript R".
      const sub = element(doc, "msub");
      sub.appendChild(parts0[0]);
      sub.appendChild(parts0[1]);
      row.appendChild(sub);
    } else row.appendChild(parts0[0]);
    row.appendChild(element(doc, "mtext", "\u00a0superscript\u00a0"));
    row.appendChild(script);
    msup.parentNode.replaceChild(row, msup);
  }
  for (const mi of all("mi")) {
    const text = mi.textContent.trim();
    if (text === "𝔼" || (text === "E" && mi.getAttribute("mathvariant") === "double-struck")) mi.parentNode.replaceChild(element(doc, "mtext", "expectation"), mi);
  }
  // f(x), p(θ | y), softmax(x): a function (MathCAT then says "of"), for the letters that papers use for functions
  // and for names of more than one letter.
  for (const mi of all("mi")) {
    const text = mi.textContent.trim();
    if (!(FUNCTION_LETTERS.includes(text) || /^\p{L}{2,}$/u.test(text))) continue;
    let next = mi.nextSibling;
    while (next !== null && next.nodeType !== 1) next = next.nextSibling;
    if (next === null) continue;
    const opens = (node) => nameOf(node) === "mo" && node.textContent.trim() === "(";
    if (!(opens(next) || (nameOf(next) === "mrow" && children(next)[0] !== undefined && opens(children(next)[0])))) continue;
    mi.parentNode.insertBefore(element(doc, "mo", "\u2061"), next);
  }
  for (const mfrac of all("mfrac")) {
    const [top, bottom] = children(mfrac);
    if (top === undefined || bottom === undefined || mfrac.getAttribute("linethickness") === "0") continue;
    // Long: it has an operator ("a − b", "β·ξ·q", "p(y | θ)"); "d x" or "Q Kᵀ" is not long.
    const long = (part) => [...part.getElementsByTagNameNS(MATH_NS, "mo")].some((mo) => !/^[\u2061-\u2064]?$/u.test(mo.textContent.trim())) || (nameOf(part) === "mo" && part.textContent.trim() !== "");
    if (!long(top) && !long(bottom)) continue;
    const row = element(doc, "mrow");
    row.appendChild(top);
    row.appendChild(element(doc, "mtext", ", over "));
    row.appendChild(bottom);
    mfrac.parentNode.replaceChild(row, mfrac);
  }
  for (const table of all("mtable")) {
    const cells = all("mtd").filter((cell) => cell.parentNode?.parentNode === table);
    if (cells.length < 2 || !cells.some((cell) => DOTS.test(cell.textContent))) continue;
    const rows = children(table).filter((row) => nameOf(row) === "mtr" || nameOf(row) === "mlabeledtr");
    const columns = Math.max(...rows.map((row) => children(row).length));
    const words = async (cell) => (await mathcat(`<math xmlns="${MATH_NS}">${new XMLSerializer().serializeToString(cell).replace(/^<mtd[^>]*>|<\/mtd>$/g, "")}</math>`)).trim();
    const [first, last] = [await words(cells[0]), await words(cells[cells.length - 1])];
    const text = element(doc, "mtext", `the ${columns === 1 ? "vector" : "matrix"} from ${first} to ${last}`);
    // The brackets around the matrix go too ("open paren … close paren" would be noise).
    const parent = table.parentNode;
    const siblings = parent === null ? [] : children(parent);
    const fenced = parent !== null && nameOf(parent) === "mrow" && siblings.length === 3 && siblings[1] === table && nameOf(siblings[0]) === "mo" && nameOf(siblings[2]) === "mo";
    (fenced ? parent.parentNode : parent).replaceChild(text, fenced ? parent : table);
  }
  return new XMLSerializer().serializeToString(doc);
}

/** The changes of the words after MathCAT (for speech). */
export function cleanWords(text) {
  let out = ` ${text} `.replace(/\s+/g, " ");
  // The arguments of a function: "f of x, y, z" (no brackets), if there are no brackets inside.
  for (let step = 0; step < 5; step += 1) {
    const next = out.replace(/\bof[,;]? open (paren|bracket)[,;]? ((?:(?!\bopen (?:paren|bracket)\b|\bclose (?:paren|bracket)\b).)+?)[,;]? close \1\b/g, "of $2");
    if (next === out) break;
    out = next;
  }
  out = out
    .replace(/\bexpectation sub (.+?)(?:,? end sub\b|[;]|$)/g, "the expectation over $1,")
    // 𝔼[…]: "the expectation over y star of …" (no "open bracket … close bracket"), if there are no brackets inside.
    .replace(/\bexpectation( over [^,;]+?)?[,;\s]*open bracket[,;\s]*((?:(?!\bopen bracket\b|\bclose bracket\b).)+?)[,;\s]*close bracket\b/g, (_whole, over, inside) => `expectation${over ?? ""} of ${inside}`)
    .replace(/ comma,?/g, ",")
    .replace(/\bis equal to\b/g, "equals")
    .replace(/\bcap ([a-z])\b/g, (_whole, letter) => letter.toUpperCase())
    .replace(/\bcap (?=[a-z]{2,})/g, "capital ")
    .replace(/\s+([,;])/g, "$1")
    .replace(/([,;])(?:\s*[,;])+/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,;]\s*|[,;]$/g, "");
  return out;
}

/** The text for the screen: no sound spellings, commas for pauses. */
export function displayWords(speech) {
  return speech
    .replace(/\bzai\b/g, "xi")
    .replace(/\beigh\b/g, "a")
    .replace(/\bnahblah\b/g, "nabla")
    .replace(/\blahplahsian\b/g, "Laplacian")
    .replace(/;/g, ",")
    .replace(/,(?:\s*,)+/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

/** The words of one formula: `{tex}` or `{mathml}`, for speech and for the screen. Empty strings on an error. */
export async function speak(formula) {
  try {
    const mathml = typeof formula.mathml === "string" ? formula.mathml : texToMathml(String(formula.tex ?? ""), formula.display === true);
    const speech = cleanWords(await mathcat(await prepare(mathml)));
    return { speech, display: displayWords(speech) };
  } catch {
    return { speech: "", display: "" };
  }
}
