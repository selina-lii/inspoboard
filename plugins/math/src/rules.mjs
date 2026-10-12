// The folder of the rule files of Speech Rule Engine. It must be known before the engine loads (it reads it at load).
// A build: "mathmaps" next to the program. Development: the folder in node_modules (the engine finds it).

import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const beside = join(dirname(process.execPath), "mathmaps");
export const RULES = existsSync(beside) ? beside : undefined;
if (RULES !== undefined) process.env.SRE_JSON_PATH = RULES;
