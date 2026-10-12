// Inspoboard plugin "Math to words". Protocol: JSON lines on stdin and stdout (docs/PLUGINS.md in the app repository).
// - Capability "math-text": method "math" gets formulas (LaTeX or MathML) and gives their words, for read-aloud.
// - No network. It saves nothing.

import { RULES } from "./rules.mjs";
import { createInterface } from "node:readline";
import { setup, speak, STYLES } from "./math.mjs";

function info() {
  return {
    title: "Math to words",
    icon: "sigma",
    description: "Read aloud says formulas as words (LaTeX in pages, formulas in web pages). Offline, English.",
    options: [{ key: "style", label: "Formulas", default: "clearspeak", choices: STYLES }],
    actions: [],
  };
}

async function math(params) {
  const formulas = Array.isArray(params?.formulas) ? params.formulas : null;
  if (formulas === null) throw new Error('"formulas" is missing.');
  await setup(params?.options?.style, RULES);
  return { texts: formulas.map((formula) => (formula !== null && typeof formula === "object" ? speak(formula) : "")) };
}

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

// One request at a time is enough: a call is fast (about 1 ms for each formula). Requests wait in order.
let queue = Promise.resolve();
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  const { id = null, method = "", params = null } = request ?? {};
  queue = queue.then(async () => {
    try {
      const result = method === "info" ? info() : method === "math" ? await math(params) : method === "cancel" ? null : (() => { throw new Error(`Unknown method "${method}".`); })();
      send({ id, result });
    } catch (error) {
      send({ id, error: { message: error instanceof Error ? error.message : String(error) } });
    }
  });
});
// When the app closes the input, stop.
lines.on("close", () => void queue.then(() => process.exit(0)));
