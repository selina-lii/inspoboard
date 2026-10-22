// README pictures: screenshots of the app on the sample vault (sample.ts) and GIFs of the app and the demos.
// All content is made up. Nothing reads or writes a vault on disk.
//
// 1. npx vite --port 5191            (the dev server, in the repo folder)
// 2. A folder with the tools:        npm i playwright@1.48.2 gifenc@1.0.3 pngjs@7.0.0 && npx playwright install chromium
// 3. TOOLS=<that folder> node scripts/screenshots/shoot.mjs
// The pictures go into docs/images/ (the README shows them).

import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(join(process.env.TOOLS ?? process.cwd(), "package.json"));
const { chromium } = require("playwright");
const { GIFEncoder, quantize, applyPalette } = require("gifenc");
const { PNG } = require("pngjs");

const SERVER = "http://localhost:5191";
const OUT = join(import.meta.dirname, "..", "..", "docs", "images");
const APP = `${SERVER}/scripts/screenshots/index.html`;

const browser = await chromium.launch({ args: ["--use-gl=angle", "--ignore-gpu-blocklist"] });

/** A page of the app on the sample vault (or a demo vault of data/), with its board ready. */
async function appPage(width = 1440, height = 900, scale = 2, vault = null) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale, colorScheme: "dark" });
  await page.goto(vault === null ? APP : `${APP}?vault=${vault}`);
  await page.waitForSelector(".react-flow__node", { timeout: 15000 });
  await page.waitForTimeout(1500);
  return page;
}

async function shot(page, name) {
  await page.screenshot({ path: join(OUT, name) });
  console.log(name);
}

/**
 * A GIF of `seconds` of a page (frames at `fps`). `step`: runs before each frame (for example a drag); it can return
 * true to end the GIF there.
 */
async function gif(page, name, seconds, fps = 12, step = async () => undefined) {
  const encoder = GIFEncoder();
  const frames = Math.round(seconds * fps);
  for (let index = 0; index < frames; index += 1) {
    const start = Date.now();
    if ((await step(index)) === true) break;
    const png = PNG.sync.read(await page.screenshot());
    const palette = quantize(png.data, 256);
    encoder.writeFrame(applyPalette(png.data, palette), png.width, png.height, { palette, delay: 1000 / fps });
    await page.waitForTimeout(Math.max(0, 1000 / fps - (Date.now() - start)));
  }
  encoder.finish();
  writeFileSync(join(OUT, name), encoder.bytes());
  console.log(name);
}

const openCard = async (page, name) => {
  await page.locator(".react-flow__node", { hasText: name }).first().dblclick();
  await page.waitForTimeout(1500);
};

let page;
// The item table: one picture of each kind of card (the items vault: sample.ts).
page = await appPage(1600, 1300, 2, "items");
// Only the cards: the board, its dots, and the page are transparent (the pictures have no dark edges).
await page.addStyleTag({ content: "html, body, #root, .board-area, .react-flow, .react-flow__renderer, .react-flow__pane { background: transparent !important; } .react-flow__background { display: none !important; }" });
await page.waitForTimeout(300);
for (const [file, name] of [
  ["note", "Note"], ["comment", "Love this one!"], ["quote", "Every dog has its day."], ["flashcard", "Front"], ["todo", "Walk the dog"], ["weblink", "Web link"],
  ["page", "Page"], ["saved", "Saved web page or PDF"], ["board", "Board"], ["picture", "Picture"], ["song", "Song"], ["video", "Video"],
]) {
  const card = page.locator(".react-flow__node", { hasText: name }).first();
  await card.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.activeElement?.blur?.());
  const box = await card.boundingBox();
  await page.screenshot({ path: join(OUT, `item-${file}.png`), omitBackground: true, clip: { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 } });
  console.log(`item-${file}.png`);
}
await page.close();

// The home board.
page = await appPage();
await shot(page, "readme-board.png");
// A board with a calendar.
await openCard(page, "October plan");
await shot(page, "readme-calendar.png");
await page.close();

// A page in the editor.
page = await appPage();
await openCard(page, "Poster draft");
await shot(page, "readme-page.png");
await page.close();

// The galaxy (3D).
page = await appPage();
await page.getByRole("button", { name: "2D" }).click();
await page.waitForTimeout(3000);
await shot(page, "readme-galaxy.png");
await page.close();
// The tour: the demo (prototyping/tour-demo.html), from its first stop to its second, at 2.39:1 (the README banner).
page = await browser.newPage({ viewport: { width: 960, height: 402 }, colorScheme: "dark" });
await page.goto(`${SERVER}/prototyping/tour-demo.html`);
await page.waitForTimeout(2000);
await page.evaluate(() => document.getElementById("next").click());
await page.addStyleTag({ content: ".bar { display: none !important; }" });
await page.waitForTimeout(300);
const circling = () => page.evaluate(() => document.querySelector("#now b")?.textContent ?? "");
const first = await circling();
let reached = null;
await gif(page, "readme-tour.gif", 60, 10, async (index) => {
  const now = (await page.textContent("#now")) ?? "";
  // The end: one second after the second stop starts.
  if (reached === null && now.startsWith("Circling") && (await circling()) !== first) reached = index;
  return reached !== null && index - reached >= 10;
});
await page.close();

// Buzzies mode on the board: glyphs, then the blur style (the chip), then the text again (Esc).
page = await appPage(960, 600, 1);
await page.locator('button[data-tip^="More:"]').click();
await page.getByText("Buzzies mode: hide your text", { exact: false }).click();
setTimeout(() => void page.locator(".buzz-chip button").first().click().catch(() => undefined), 3500);
setTimeout(() => void page.keyboard.press("Escape").catch(() => undefined), 7000);
await page.mouse.move(700, 300);
await gif(page, "readme-buzzies.gif", 9, 8);
await page.close();

// The demo vaults (scripts/demos/make.ts): a moodboard, and a branching story game.
page = await appPage(1440, 900, 2, "demo-dogs");
await shot(page, "readme-dogs.png");
await page.close();
page = await appPage(1440, 900, 2, "demo-story");
await shot(page, "readme-story.png");
await page.close();

// The story game: open the first scene, then choose (a choice is a passage link: its card shows "Go to").
page = await appPage(1100, 620, 1, "demo-story");
const choose = async (choice) => {
  const box = await page.getByText(choice).first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: "Go to" }).first().click();
  await page.mouse.move(1000, 560);
};
const script = [
  [0, async () => openCard(page, "1 · The harbor")],
  [20, async () => choose("Follow the sound of a bell")],
  [44, async () => choose("Climb the stairs")],
];
let pending = Promise.resolve();
await gif(page, "readme-story.gif", 9, 8, async (index) => {
  const entry = script.find(([at]) => at === index);
  if (entry !== undefined) pending = pending.then(entry[1]);
  if (index === 0 || entry !== undefined) await pending;
});
await page.close();

// The demos (prototyping/).
// The evolution plot: the view turns slowly (a drag), so the generations show as planes.
page = await browser.newPage({ viewport: { width: 960, height: 600 }, colorScheme: "dark" });
await page.goto(`${SERVER}/prototyping/evolution-demo.html`);
await page.waitForTimeout(4000);
await page.mouse.move(480, 300);
await page.mouse.down();
await gif(page, "readme-evolution.gif", 8, 8, (index) => page.mouse.move(480 + index * 1.6, 300 + index * 0.4));
await page.mouse.up();
await page.close();
await browser.close();
