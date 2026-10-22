import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanWords, displayWords, speak, stopHelper, texToMathml } from "../src/math.mjs";

after(() => stopHelper());
const words = async (tex) => (await speak({ tex, display: true })).display;

test("LaTeX and MathML become words (MathCAT)", async () => {
  assert.equal(await words("\\frac{a}{b}"), "a over b");
  assert.equal(await words("x^2 + y^2 = r^2"), "x squared plus y squared, equals r squared");
  assert.equal((await speak({ mathml: "<math><msqrt><mi>x</mi></msqrt></math>" })).display, "the square root of x");
  assert.match(texToMathml("\\alpha", true), /display="block"/);
});

test("short words: function arguments, given, star, expectation, choose, long fractions", async () => {
  assert.equal(await words("\\iiint_{V} f ( x , y , z ) \\, d V=F"), "the triple integral over V of, f of x, y, z, d V, equals F");
  assert.equal(await words("\\mathbb E_{y^{*}} \\left[ p ( \\theta\\mid y^{*} ) \\right]"), "the expectation over y star of p of theta given y star");
  assert.equal(await words("F ( \\frac{\\beta \\cdot \\xi \\cdot q} {1-\\alpha} )"), "F of beta times xi times q, over 1 minus alpha");
  assert.match(await words("\\binom{n}{k}"), /^n choose k$/);
  assert.equal(await words("X=\\{x\\in\\mathbb{R}\\mid x>0\\}"), "X equals, the set of all x in the real numbers such that x is greater than 0");
});

test("a matrix with dots: from its first to its last entry", async () => {
  const tex = "\\left( \\begin{matrix} a_{11} & \\dots & a_{1n} \\\\ \\vdots & \\ddots & \\vdots \\\\ a_{n1} & \\dots & a_{nn} \\end{matrix} \\right) \\left( \\begin{matrix} v_{1} \\\\ \\vdots \\\\ v_{n} \\end{matrix} \\right)";
  assert.equal(await words(tex), "the matrix from a sub 11 to a sub n n, the vector from v sub 1 to v sub n");
});

test("the text for the screen has no sound spellings", () => {
  assert.equal(displayWords("beta zai; eigh, nahblah"), "beta xi, a, nabla");
  assert.equal(cleanWords("f of, open paren, x comma, y; close paren; is equal to cap q"), "f of x, y; equals Q");
});

test("a formula with an error gives empty texts", async () => {
  assert.deepEqual(await speak({ tex: "\\frac{a" }), { speech: "", display: "" });
});
