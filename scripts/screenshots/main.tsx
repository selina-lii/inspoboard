// The app in a web browser, for the README screenshots (shoot.mjs). The backend keeps the files in memory (the test
// backend): nothing is written to disk.
// - No query: the sample vault (sample.ts).
// - `?vault=demo-dogs` or `?vault=demo-story`: a demo vault of data/ (scripts/demos/make.ts), read as it is.

import { createRoot } from "react-dom/client";
import type { VaultFiles } from "../../src/core/format";
import { App } from "../../src/ui/app/App";
import { FakeBackend } from "../../tests/fakeBackend";
import { itemsVault, sampleVault } from "./sample";
import "../../src/ui/theme/theme.css";
import "../../src/ui/app/layout.css";

const texts = import.meta.glob<string>("../../data/demo-*/**/*.{md,jsonl,json}", { query: "?raw", import: "default" });
const images = import.meta.glob<string>("../../data/demo-*/images/*", { query: "?url", import: "default" });

async function demoVault(name: string): Promise<{ files: VaultFiles; images: Map<string, ArrayBuffer> }> {
  const prefix = `../../data/${name}/`;
  const files: VaultFiles = new Map();
  for (const [path, load] of Object.entries(texts)) if (path.startsWith(prefix) && !path.endsWith("DEMO.md")) files.set(path.slice(prefix.length), await load());
  const bytes = new Map<string, ArrayBuffer>();
  for (const [path, load] of Object.entries(images)) if (path.startsWith(prefix)) bytes.set(path.slice(prefix.length), await (await fetch(await load())).arrayBuffer());
  return { files, images: bytes };
}

/** `?vault=items`: one card of each kind (sample.ts), with a picture from the demo photos. */
async function items(): Promise<{ files: VaultFiles; images: Map<string, ArrayBuffer> }> {
  const file = "star-05.jpg";
  const url = (await import(`../demos/dogs/${file}?url`)).default as string;
  return { files: itemsVault(file), images: new Map([[`images/${file}`, await (await fetch(url)).arrayBuffer()]]) };
}

const name = new URLSearchParams(location.search).get("vault");
const vault = name === null ? { files: sampleVault(), images: new Map<string, ArrayBuffer>() } : name === "items" ? await items() : await demoVault(name);
const backend = new FakeBackend(vault.files);
backend.images = vault.images;
backend.startupVault = async () => `/${name ?? "sample-vault"}`;
createRoot(document.getElementById("root")!).render(<App backend={backend} />);
