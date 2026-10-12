// Builds one program: esbuild makes one script, and Node makes a single executable application (SEA) from it.
// Output: dist/inspoboard-math and dist/mathmaps/ (the rule files of Speech Rule Engine). Install both.

import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

/**
 * The Node program that the plugin program is made from. Some Node builds (for example Homebrew) cannot make a
 * single executable. Thus the build gets the official Node of the same version from nodejs.org once (into .cache/),
 * and checks its SHA-256 against the list on nodejs.org.
 */
async function officialNode() {
  const version = process.version;
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const platform = process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : null;
  if (platform === null) throw new Error("Build on macOS or Linux.");
  const name = `node-${version}-${platform}-${arch}`;
  const program = `.cache/${name}/bin/node`;
  if (existsSync(program)) return program;
  mkdirSync(".cache", { recursive: true });
  const base = `https://nodejs.org/dist/${version}`;
  const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
  const expected = sums.split("\n").find((line) => line.endsWith(`  ${name}.tar.gz`))?.split(" ")[0];
  if (expected === undefined) throw new Error(`No checksum for ${name}.tar.gz on nodejs.org.`);
  console.log(`Downloading ${name}.tar.gz from nodejs.org…`);
  const data = Buffer.from(await (await fetch(`${base}/${name}.tar.gz`)).arrayBuffer());
  const actual = createHash("sha256").update(data).digest("hex");
  if (actual !== expected) throw new Error(`Checksum mismatch for ${name}.tar.gz.`);
  writeFileSync(`.cache/${name}.tar.gz`, data);
  execFileSync("tar", ["-xzf", `${name}.tar.gz`, `${name}/bin/node`], { cwd: ".cache", stdio: "inherit" });
  rmSync(`.cache/${name}.tar.gz`);
  return program;
}

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
/**
 * Speech Rule Engine loads its libraries with eval("require") at run time. A single executable has no node_modules:
 * give it the bundled libraries instead (the command line part, "commander", is not needed: an empty object).
 */
const sreRequire = {
  name: "sre-require",
  setup(context) {
    context.onLoad({ filter: /speech-rule-engine[\\/]js[\\/]common[\\/]system_external\.js$/ }, (args) => ({
      contents: readFileSync(args.path, "utf8").replace(
        "return eval('require');",
        `return Object.assign((name) => ({ "@xmldom/xmldom": require("@xmldom/xmldom"), "wicked-good-xpath": require("wicked-good-xpath"), fs: require("fs") })[name] ?? (() => { try { return require(name); } catch { return {}; } })(), { resolve: () => { throw new Error("bundled"); } });`,
      ),
      loader: "js",
    }));
  },
};
await build({ entryPoints: ["src/main.mjs"], bundle: true, platform: "node", format: "cjs", outfile: "dist/main.cjs", logLevel: "warning", plugins: [sreRequire] });
if (!readFileSync("dist/main.cjs", "utf8").includes('"wicked-good-xpath": require')) throw new Error("The require patch of Speech Rule Engine did not apply.");
cpSync("node_modules/speech-rule-engine/lib/mathmaps", "dist/mathmaps", { recursive: true });
const executable = await officialNode();
writeFileSync("dist/sea-config.json", JSON.stringify({ main: "dist/main.cjs", output: "dist/inspoboard-math", executable, disableExperimentalSEAWarning: true }));
execFileSync(process.execPath, ["--build-sea", "dist/sea-config.json"], { stdio: "inherit" });
// macOS: the program needs a signature again (ad hoc) after Node wrote into it.
if (process.platform === "darwin") execFileSync("codesign", ["--sign", "-", "--force", "dist/inspoboard-math"], { stdio: "inherit" });
rmSync("dist/sea-config.json");
rmSync("dist/main.cjs");
console.log("Built dist/inspoboard-math and dist/mathmaps/.");
