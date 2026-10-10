// Makes the Simplified Chinese pack (zh.json) from the Traditional Chinese pack (zh-Hant.json).
// zh-Hant.json is the source: edit it, then run this script. The conversion is character by character
// (the Chinese plugin of the app: OpenCC and MediaWiki rules), so the words stay the same.
// Use: node scripts/i18n/make-hans.mjs [path to the inspoboard-chinese program]
// Default program: data/plugins/chinese/inspoboard-chinese (npm run plugin:chinese:dev-install).

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const program = process.argv[2] ?? join(ROOT, "data/plugins/chinese/inspoboard-chinese");
const source = JSON.parse(readFileSync(join(ROOT, "src/ui/i18n/zh-Hant.json"), "utf8"));
const keys = Object.keys(source);

const child = spawn(program, [], { stdio: ["pipe", "pipe", "inherit"] });
let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk;
  const line = output.split("\n").find((candidate) => candidate.trim() !== "");
  if (line === undefined || !output.includes("\n")) return;
  const reply = JSON.parse(line);
  child.stdin.end();
  if (reply.error !== undefined) throw new Error(JSON.stringify(reply.error));
  const texts = reply.result.texts;
  const pack = Object.fromEntries(keys.map((key, index) => [key, texts[index]]));
  writeFileSync(join(ROOT, "src/ui/i18n/zh.json"), `${JSON.stringify(pack, null, 2)}\n`);
  console.log(`zh.json: ${keys.length} texts`);
});
child.stdin.write(`${JSON.stringify({ id: 1, method: "transform", params: { texts: keys.map((key) => source[key]), options: { target: "hans" } } })}\n`);
