import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, speak, texToMathml } from "../src/math.mjs";

test("LaTeX and MathML become words", async () => {
  await setup("clearspeak");
  assert.equal(speak({ tex: "\\frac{a}{b}" }), "a over b");
  assert.equal(speak({ tex: "x^2 + y^2 = r^2" }), "x squared plus y squared equals r squared");
  assert.equal(speak({ mathml: "<math><msqrt><mi>x</mi></msqrt></math>" }), "the square root of x");
  assert.match(texToMathml("\\alpha", true), /display="block"/);
});

test("a formula with an error gives an empty text", async () => {
  await setup("clearspeak");
  assert.equal(speak({ tex: "\\frac{a" }), "");
  // An unknown command is not an error: it is said as it is.
  assert.equal(speak({ tex: "\\notacommand" }), "backslash notacommand");
});

test("the exact style marks the start and the end", async () => {
  await setup("mathspeak");
  assert.equal(speak({ tex: "\\frac{a}{b}" }), "StartFraction a Over b EndFraction");
  await setup("clearspeak");
});
