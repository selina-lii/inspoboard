// Demo vaults (made-up content), built with the app's own actions, so they have the format of a real vault.
// - "Small white dogs": a moodboard. Public-domain and CC0 photos (scripts/demos/dogs/CREDITS.md), on a cork board
//   (an original picture: scripts/demos/cork.ts) that lies on the board, the three item sizes, media items, and links on cards, on passages, and inside a page.
// - "Biscuit and the Lighthouse": a branching story game. Each scene is a page; its choices are passage links
//   ("[text](link:<id>)") to the next scene. A click on a choice jumps there.

import { createItemOnBoard, type ActionContext } from "../../src/core/actions";
import { History, makeOp, type Command } from "../../src/core/commands";
import { decodeVault, encodeVault, type VaultFiles } from "../../src/core/format";
import { GraphIndex } from "../../src/core/graph";
import { createGroupShape } from "../../src/core/groupShapes";
import { createInside } from "../../src/core/inside";
import { createMediaItem } from "../../src/core/media";
import { createRelation } from "../../src/core/relations";
import type { Id, ItemRecord, PlaceLink, RelationLink, ViewStyle } from "../../src/core/types";
import { newVaultFiles } from "../../src/io/session";

type Card = { itemId: Id; placeId: Id };
type Extra = { board?: boolean; color?: string; url?: string; on?: Id; size?: { w: number; h: number } };

/** A new vault with a named root, and helpers that run commands on it. */
function builder(prefix: string, rootName: string) {
  const { store, meta } = decodeVault(new Map(newVaultFiles().map((file) => [file.path, file.content])));
  const graph = new GraphIndex(store);
  let next = 0;
  // IDs: 12 characters [0-9a-z], as the app makes them.
  const context: ActionContext = { store, graph, newId: () => `${prefix}${String((next += 1)).padStart(12 - prefix.length, "0")}`, now: () => "2026-10-18T09:00:00.000Z" };
  const history = new History(store);
  const run = (command: Command) => history.run(command);
  const root = meta!.root;
  const update = (id: Id, change: Partial<ItemRecord>) => run({ label: "change", ops: [makeOp("items", id, store.get("items", id)!, { ...store.get("items", id)!, ...change })] });
  update(root, { name: rootName });
  const card = (boardId: Id, view: ViewStyle, x: number, y: number, name: string, body = "", extra: Extra = {}): Card => {
    const made = createItemOnBoard(context, { boardId, view, x, y, name, body, ...extra });
    run(made.command);
    return made;
  };
  const link = (from: Id, to: Id, fields: Partial<RelationLink> = {}) => {
    const made = createRelation(context, { from, to });
    const op = made.command.ops[0]!;
    run({ ...made.command, ops: [{ ...op, after: { ...(op.after as RelationLink), ...fields } }] });
    return made.linkId;
  };
  const resize = (placeId: Id, w: number, h: number) => {
    const place = store.get("links", placeId) as PlaceLink;
    run({ label: "size", ops: [makeOp("links", placeId, place, { ...place, w: Math.round(w), h: Math.round(h) })] });
  };
  const write = (id: Id, body: string) => run({ label: "text", ops: [makeOp("texts", id, store.get("texts", id) ?? null, { id, body })] });
  return { store, context, run, root, update, card, link, resize, write, files: () => encodeVault(store, meta!) };
}

/** A dog photo of the moodboard: its file in `images/`, and its width and height (for the card shape). */
export type DogPhoto = { file: string; name: string; w: number; h: number };

export function dogsVault(photos: readonly DogPhoto[], background: string): VaultFiles {
  const v = builder("dogs", "Small white dogs");
  const { card, link, resize, run, context, root } = v;
  // The cork board lies on the board: it holds all the cards (backgroundOnBoard), and moves and zooms with them.
  v.update(root, { background, backgroundOnBoard: true });

  // Large: a collection (a board in the board).
  const breeds = card(root, "note", -280, 260, "Breeds", "", { board: true });
  // Pictures (multimedia items), loose like prints pinned to a board: each goes to the shortest column, with its own
  // width, a nudge off the grid, and now and then a small overlap. The height keeps the photo shape (plus the
  // caption). The owner's pictures (star-*) come first, in the "Favorites" frame; the others are shuffled.
  let seed = 11;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const stars = photos.filter((photo) => photo.file.startsWith("star"));
  const others = photos.filter((photo) => !photo.file.startsWith("star"));
  for (let at = others.length - 1; at > 0; at -= 1) {
    const other = Math.floor(random() * (at + 1));
    [others[at], others[other]] = [others[other]!, others[at]!];
  }
  const slot = 236;
  const columns = [0, 0, 0, 0, 0];
  const boxes = new Map<string, { x: number; y: number; w: number; h: number }>();
  [...stars, ...others].forEach((photo, index) => {
    // The first row (favorites) is a band of its own: the rest start below its frame.
    if (index === columns.length) columns.fill(Math.max(...columns) + 50);
    const column = columns.indexOf(Math.min(...columns));
    const w = Math.round(170 + random() * 100);
    const h = Math.round(w * (photo.h / photo.w)) + 40;
    const box = { x: Math.round(column * slot + (slot - w) / 2 + (random() - 0.5) * 50), y: Math.round(columns[column]! + (random() - 0.5) * 30), w, h };
    columns[column] += h + Math.round(-14 + random() * 40);
    boxes.set(photo.file, box);
  });
  const pictures = photos.map((photo) => {
    const box = boxes.get(photo.file)!;
    const made = createMediaItem(context, { boardId: root, x: box.x, y: box.y, kind: "image", file: `images/${photo.file}`, name: photo.name });
    run(made.command);
    resize(made.placeId, box.w, box.h);
    return made;
  });
  // A picture by its file (the first picture if the file is not there).
  const picture = (file: string) => pictures[Math.max(0, photos.findIndex((photo) => photo.file === file))]!;
  // The small items: a column at the right (a gap for the comment of the last picture).
  const right = columns.length * slot + 200;

  // Small: notes, a quote, a flashcard, an action item, a web link, a comment on a picture.
  const cloud = card(root, "note", right + 20, 0, "Cloud energy", "Soft, round, white.\nEverything at nose height.", { color: "#f4efe6" });
  card(root, "quote", right + 20, 200, "Moodboard rule", "A small dog fills a big room.");
  card(root, "flashcard", right + 20, 320, "Bichon Frisé", "Frisé is French for curly.");
  card(root, "todo", right + 20, 520, "", "Buy a soft slicker brush");
  card(root, "weblink", right + 20, 670, "More public-domain dogs", "", { url: "https://commons.wikimedia.org/wiki/Category:Maltese_(dog)" });
  card(root, "comment", -260, 20, "", "This one is the mood.", { on: picture("star-05.jpg").itemId });

  // Medium: a page, with a small item inside it and a passage that links to a picture.
  const grooming = card(root, "page", -280, 420, "Grooming notes", "");
  const topknotLink = link(grooming.itemId, picture("dog-03.jpg").itemId, { onBoard: true, label: "topknot" });
  v.write(grooming.itemId, `Brush every day, from the skin out.\n\n[A topknot keeps the hair out of the eyes](link:${topknotLink}), and soft wraps keep it clean.\n\nWipe the corners of the eyes with a damp cloth.`);
  run(createInside(context, { homeId: grooming.itemId, view: "comment", at: null, body: "Ask the groomer about tear stains." }).command);

  // In the collection: one note for each breed, each with an item link to its photo.
  const breedNotes: [string, string, string][] = [["Maltese", "dog-02.jpg", "Long, silky, straight coat."], ["Bichon Frisé", "dog-04.jpg", "Curly, like a cotton ball."], ["West Highland White Terrier", "dog-06.jpg", "Wiry coat, upright ears."], ["Miniature Schnauzer", "dog-08.jpg", "A beard, and a lot of energy."]];
  breedNotes.forEach(([name, file, text], row) => {
    card(breeds.itemId, "note", (row % 2) * 260, Math.floor(row / 2) * 200, name, `${text}\n\n[See the photo](item:${picture(file).itemId})`);
  });

  // Links between cards, and a group around the favorites.
  link(cloud.itemId, picture("star-01.jpg").itemId, { label: "this", color: "#c9a227" });
  link(picture("dog-07.jpg").itemId, picture("dog-06.jpg").itemId, { label: "puppy → grown", dashed: true });
  link(breeds.itemId, picture("dog-04.jpg").itemId);
  // A group frame around the owner's pictures: the favorites.
  // Only the first row: a frame holds every card inside it, so it must not reach the photos below.
  const firstRow = Math.min(...stars.map((photo) => boxes.get(photo.file)!.y)) + 60;
  const starred = stars.map((photo) => boxes.get(photo.file)!).filter((box) => box.y < firstRow);
  const left = Math.min(...starred.map((box) => box.x)) - 24;
  const top = Math.min(...starred.map((box) => box.y)) - 34;
  const frame = createGroupShape(context, {
    boardId: root,
    box: { x: left, y: top, w: Math.max(...starred.map((box) => box.x + box.w)) + 24 - left, h: Math.max(...starred.map((box) => box.y + box.h)) + 20 - top },
    shape: "rect",
  });
  run(frame.command);
  v.update(frame.itemId, { name: "Favorites" });
  return v.files();
}

export function storyVault(): VaultFiles {
  const v = builder("story", "Biscuit and the Lighthouse");
  const { card, link, root } = v;
  type Scene = { id: string; name: string; text: string; choices: [string, string][]; x: number; y: number; ending?: "good" | "best" | "soft" };
  const scenes: Scene[] = [
    { id: "start", name: "1 · The harbor", x: 0, y: 220, text: "Biscuit, a small white dog, wakes up on a coil of rope at the harbor. The fog is thick, and home is nowhere to be seen.", choices: [["Follow the smell of fish", "market"], ["Follow the sound of a bell", "door"]] },
    { id: "market", name: "2 · The fish market", x: 420, y: 0, text: "Crates, gulls, and a fishmonger with a striped apron. A silver sardine lies at the edge of a crate.", choices: [["Take the sardine", "beach"], ["Sit very still and look cute", "apron"]] },
    { id: "door", name: "2 · The lighthouse door", x: 420, y: 440, text: "A tall white tower. The bell rings again, high above. The door is open a crack.", choices: [["Climb the stairs", "top"], ["Wait by the door", "keeper"]] },
    { id: "keeper", name: "3 · The keeper", x: 840, y: 560, text: "An old keeper comes down with a lamp. \"Lost, are you?\" she says, and holds the door open.", choices: [["Go up with the keeper", "top"], ["Run back to the harbor", "start"]] },
    { id: "beach", name: "End · Sandy paws", x: 840, y: -120, ending: "soft", text: "The gulls chase Biscuit all the way to the beach. The sardine is gone, but the sand is warm. Not home, not yet.", choices: [["Try again", "start"]] },
    { id: "apron", name: "End · A new friend", x: 840, y: 120, ending: "good", text: "The fishmonger laughs, shares her lunch, and reads the tag on Biscuit's collar. She knows the street. A walk home, a full belly.", choices: [] },
    { id: "top", name: "End · Home by lamplight", x: 1260, y: 440, ending: "best", text: "From the top of the tower, the lamp sweeps the town. There: the blue door, and someone at the window, waving. Biscuit barks once. Home.", choices: [] },
  ];
  const colors = { soft: "#8e8e93", good: "#30a46c", best: "#e5b400" } as const;
  const cards = new Map(scenes.map((scene) => [scene.id, card(root, "page", scene.x, scene.y, scene.name, "", scene.ending ? { color: colors[scene.ending] } : {})]));
  // Each choice: a passage link from the scene to the next scene (shown on the board as a dashed line).
  for (const scene of scenes) {
    const choices = scene.choices.map(([label, to]) => `- [${label}](link:${link(cards.get(scene.id)!.itemId, cards.get(to)!.itemId, { onBoard: true, end: "arrow", label })})`);
    v.write(cards.get(scene.id)!.itemId, [scene.text, "", ...(choices.length > 0 ? ["What does Biscuit do?", "", ...choices] : ["**The end.** [Play again](item:" + cards.get("start")!.itemId + ")"])].join("\n"));
  }
  card(root, "note", -360, 200, "How to play", "Open the page \"1 · The harbor\". Read, then click a choice: it jumps to the next scene.\n\nThree endings. Can you find the best one?", { color: "#f4efe6" });
  return v.files();
}
