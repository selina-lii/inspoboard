// Builds the plugin: esbuild makes one script, and Node makes a single executable application (SEA) from it. Cargo
// builds the MathCAT helper (mathcat/). Output: dist/inspoboard-math and dist/inspoboard-mathcat. Install both.

import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";

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
await build({ entryPoints: ["src/main.mjs"], bundle: true, platform: "node", format: "cjs", outfile: "dist/main.cjs", logLevel: "warning" });
// The MathCAT helper (Rust). Its rule files are inside the program.
execFileSync("cargo", ["build", "--release"], { cwd: "mathcat", stdio: "inherit" });
cpSync("mathcat/target/release/inspoboard-mathcat", "dist/inspoboard-mathcat");
const executable = await officialNode();
writeFileSync("dist/sea-config.json", JSON.stringify({ main: "dist/main.cjs", output: "dist/inspoboard-math", executable, disableExperimentalSEAWarning: true }));
execFileSync(process.execPath, ["--build-sea", "dist/sea-config.json"], { stdio: "inherit" });
// macOS: the program needs a signature again (ad hoc) after Node wrote into it.
if (process.platform === "darwin") execFileSync("codesign", ["--sign", "-", "--force", "dist/inspoboard-math"], { stdio: "inherit" });
rmSync("dist/sea-config.json");
rmSync("dist/main.cjs");
console.log("Built dist/inspoboard-math and dist/inspoboard-mathcat.");
