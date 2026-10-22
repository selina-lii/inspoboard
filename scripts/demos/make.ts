// Writes the demo vaults into the test data folder: data/demo-dogs and data/demo-story (open them in a development
// build: Vault › Open Vault…). A folder that exists is replaced only with --force, only if it is a demo vault (it
// has the file DEMO.md), and only if it has no file that this script did not make (DEMO-FILES.txt lists the files of the last run): else
// the script stops and lists them.
//
//   npx rolldown scripts/demos/make.ts --platform node --format esm -o <scratch>/make.mjs && node <scratch>/make.mjs [--force]

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { dogsVault, storyVault, type DogPhoto } from "./vaults";

const REPO = process.env.REPO ?? process.cwd();
const DATA = join(REPO, "data");
const PHOTOS = join(REPO, "scripts", "demos", "dogs");
/** The cork board behind the photos (an original picture: scripts/demos/cork.ts). */
const CORK = "cork-board.jpg";
const force = process.argv.includes("--force");
/** The files that the last run wrote into a demo vault: a new run may replace only these. */
const MANIFEST = "DEMO-FILES.txt";

/** The caption of each photo. The owner's pictures (star-*) come first: the top row, in the "Favorites" frame. */
const PHOTO_NAMES: Record<string, string> = {
  "star-01.jpg": "Hello!", "star-02.jpg": "Close-up", "star-03.jpg": "Sweater day", "star-04.jpg": "Tongue out", "star-05.jpg": "The star", "star-06.png": "萌混过关",
  "dog-01.jpg": "On the lawn", "dog-02.jpg": "Show coat", "dog-03.jpg": "Topknot day", "dog-04.jpg": "Cotton ball", "dog-05.jpg": "Nap time",
  "dog-06.jpg": "Westie", "dog-07.jpg": "Westie puppy", "dog-08.jpg": "Zoomies", "dog-09.jpg": "Tennis ball", "dog-10.jpg": "From an old book",
};

/** The size of a PNG (its header) or a JPEG (its start-of-frame marker). */
function imageSize(bytes: Buffer): { w: number; h: number } {
  if (bytes.subarray(1, 4).toString("ascii") === "PNG") return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
  for (let at = 2; at < bytes.length; ) {
    const marker = bytes[at + 1]!;
    const length = bytes.readUInt16BE(at + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { h: bytes.readUInt16BE(at + 5), w: bytes.readUInt16BE(at + 7) };
    at += 2 + length;
  }
  throw new Error("Not a JPEG.");
}

/** The files in a folder, as paths relative to it ("a/b.md"). */
function listFiles(folder: string, prefix = ""): string[] {
  return readdirSync(join(folder, prefix), { withFileTypes: true }).flatMap((entry) => {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    return entry.isDirectory() ? listFiles(folder, path) : [path];
  });
}

function writeVault(name: string, files: ReadonlyMap<string, string>, images: Record<string, Buffer>, about: string): void {
  const folder = join(DATA, name);
  if (existsSync(folder)) {
    if (!force || !existsSync(join(folder, "DEMO.md"))) throw new Error(`${folder} exists. Use --force to replace a demo vault (one with DEMO.md).`);
    // Never delete a file that this script did not make (for example a picture that the user put there): the
    // script removes only the files of its last run (DEMO-FILES.txt), and stops if there are others.
    const listed = existsSync(join(folder, MANIFEST)) ? readFileSync(join(folder, MANIFEST), "utf8").split("\n").filter(Boolean) : [];
    const made = new Set([...listed, MANIFEST]);
    // A file that is the same as one that this run writes is not lost (for example a picture that is also in
    // scripts/demos/dogs).
    const same = (path: string) => path.startsWith("images/") && images[path.slice(7)]?.equals(readFileSync(join(folder, path))) === true;
    const others = listFiles(folder).filter((path) => !made.has(path) && !path.startsWith(".inspoboard/") && !same(path));
    if (others.length > 0) throw new Error(`${folder} has files that this script did not make. Move them out first:\n${others.join("\n")}`);
    for (const path of listed) if (existsSync(join(folder, path))) rmSync(join(folder, path));
  }
  for (const [path, content] of files) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), content);
  }
  mkdirSync(join(folder, "images"), { recursive: true });
  for (const [file, bytes] of Object.entries(images)) writeFileSync(join(folder, "images", file), bytes);
  const written = [...files.keys(), ...Object.keys(images).map((file) => `images/${file}`), "DEMO.md"].sort();
  writeFileSync(join(folder, MANIFEST), `${written.join("\n")}\n`);
  writeFileSync(join(folder, "DEMO.md"), `${about}\n\nMade by scripts/demos/make.ts. All content is made up; the photos are public domain or CC0 (scripts/demos/dogs/CREDITS.md).\n`);
  console.log(folder);
}

const photos: DogPhoto[] = readdirSync(PHOTOS)
  .filter((file) => /\.(jpe?g|png)$/i.test(file) && file !== CORK)
  .sort((a, b) => Number(b.startsWith("star")) - Number(a.startsWith("star")) || a.localeCompare(b))
  .map((file) => ({ file, name: PHOTO_NAMES[file] ?? file, ...imageSize(readFileSync(join(PHOTOS, file))) }));
const dogImages: Record<string, Buffer> = { [CORK]: readFileSync(join(PHOTOS, CORK)) };
for (const photo of photos) dogImages[photo.file] = readFileSync(join(PHOTOS, photo.file));
writeVault("demo-dogs", dogsVault(photos, `images/${CORK}`), dogImages, "# Small white dogs\n\nA demo moodboard vault.");
writeVault("demo-story", storyVault(), {}, "# Biscuit and the Lighthouse\n\nA demo vault: a branching story game.");
