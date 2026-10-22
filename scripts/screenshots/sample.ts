// A sample vault for screenshots (README). All its content is made up: no user data.
// It is built with the app's own actions, so it has the format of a real vault.

import { createItemOnBoard, setPlacementExpanded, type ActionContext } from "../../src/core/actions";
import { History, type Command } from "../../src/core/commands";
import { decodeVault, encodeVault, type VaultFiles } from "../../src/core/format";
import { GraphIndex } from "../../src/core/graph";
import { createCalendar, createOnDay } from "../../src/core/groups";
import { createOutline } from "../../src/core/outline";
import { createRadial, joinRadial } from "../../src/core/radial";
import { createRelation } from "../../src/core/relations";
import { createInside } from "../../src/core/inside";
import { createMediaItem } from "../../src/core/media";
import type { Id, ViewStyle } from "../../src/core/types";
import { newVaultFiles } from "../../src/io/session";

export function sampleVault(): VaultFiles {
  const { store, meta } = decodeVault(new Map(newVaultFiles().map((file) => [file.path, file.content])));
  const graph = new GraphIndex(store);
  let next = 0;
  const context: ActionContext = { store, graph, newId: () => `sample${String((next += 1)).padStart(6, "0")}`, now: () => "2026-10-18T09:00:00.000Z" };
  const history = new History(store);
  const run = (command: Command) => history.run(command);
  const root = meta!.root;
  run({ label: "name", ops: [{ table: "items", id: root, before: store.get("items", root)!, after: { ...store.get("items", root)!, name: "Studio" } }] });

  const card = (boardId: Id, view: ViewStyle, x: number, y: number, name: string, body = "", extra: { board?: boolean; color?: string; url?: string; on?: Id; size?: { w: number; h: number } } = {}) => {
    const made = createItemOnBoard(context, { boardId, view, x, y, name, body, ...extra });
    run(made.command);
    return made;
  };

  // The home board: a mix of cards, a radial, an outline, and links.
  const garden = card(root, "note", 0, 0, "Garden studio", "", { board: true });
  card(garden.itemId, "note", 0, 0, "Light", "North light, no glare at noon.");
  card(garden.itemId, "note", 260, 40, "Table", "Oak, 2.4 m. Room for two.");
  card(garden.itemId, "todo", 40, 240, "", "Measure the window");
  const palette = card(root, "note", 280, 0, "Dusk palette", "Indigo, warm gray, a little rust.\nTry it on the poster first.", { color: "#5b4b8a" });
  const poster = card(root, "page", 560, -40, "Poster draft", "A city at dusk, seen from a bridge.\n\n## Layers\n\n1. Sky gradient\n2. Skyline\n3. River lights\n\n> Keep the river the brightest part.");
  card(root, "comment", 600, 120, "", "Try a darker river?", { on: poster.itemId });
  const quote = card(root, "quote", 0, 230, "", "Simplicity is the ultimate sophistication.");
  card(root, "flashcard", 900, -20, "Golden ratio", "About 1.618");
  card(root, "todo", 900, 190, "", "Print a test at A3");
  card(root, "weblink", 360, 250, "Color theory notes", "", { url: "https://example.com/color" });
  run(createRelation(context, { from: palette.itemId, to: poster.itemId, label: "used in" }).command);
  run(createRelation(context, { from: quote.itemId, to: palette.itemId }).command);
  run(createRelation(context, { from: garden.itemId, to: palette.itemId, label: "inspired" }).command);

  // A radial: a core with cards around it.
  const radial = createRadial(context, root, 300, 620, "Moodboard");
  run(radial.command);
  const colors = ["#3a6ea5", "#c0392b", "#16a085", "#8e7d5b", "#27ae60", "#b8860b", "#2c3e50"];
  const mood = ["Fog", "Neon", "Rain", "Paper", "Moss", "Brass", "Ink"].map((name, index) => card(root, "note", 0, 600, name, "", { color: colors[index], size: { w: 110, h: 56 } }).placeId);
  run(joinRadial(context, radial.radialId, mood));

  // A reading list: an outline.
  const reading = ["Interaction of Color", "The Elements of Typography", "Ways of Seeing", "Steal Like an Artist"].map((name, index) => card(root, "page", 760, 460 + index * 10, name, "Notes go here.").placeId);
  run(createOutline(context, root, reading).command);

  // A board with a calendar for the month.
  const october = card(root, "note", 560, 280, "October plan", "", { board: true });
  const calendar = createCalendar(context, october.itemId, 0, 0, "2026-10");
  run(calendar.command);
  for (const [day, name] of [["2026-10-05", "Sketch day"], ["2026-10-12", "Print test"], ["2026-10-16", "Frame shop"], ["2026-10-21", "Show at the gallery"], ["2026-10-28", "Send thank-you notes"]] as const) {
    const made = createOnDay(context, calendar.calendarId, day, "note")!;
    run(made.command);
    run({ label: "name", ops: [{ table: "items", id: made.itemId, before: store.get("items", made.itemId)!, after: { ...store.get("items", made.itemId)!, name } }] });
  }
  return encodeVault(store, meta!);
}

/**
 * One card of each kind, far apart, for the item table of the README (shoot.mjs takes a picture of each card).
 * `picture`: the file of a picture in `images/` (the harness gives it).
 */
export function itemsVault(picture: string): VaultFiles {
  const { store, meta } = decodeVault(new Map(newVaultFiles().map((file) => [file.path, file.content])));
  const graph = new GraphIndex(store);
  let next = 0;
  const context: ActionContext = { store, graph, newId: () => `items${String((next += 1)).padStart(7, "0")}`, now: () => "2026-10-18T09:00:00.000Z" };
  const history = new History(store);
  const run = (command: Command) => history.run(command);
  const root = meta!.root;
  // A grid: four cards in each row.
  let index = -1;
  const at = () => ((index += 1), { boardId: root, x: (index % 4) * 330, y: Math.floor(index / 4) * 400 });
  const card = (view: ViewStyle, name: string, body = "", extra: { board?: boolean; url?: string; on?: Id } = {}) => {
    const made = createItemOnBoard(context, { ...at(), view, name, body, ...extra });
    run(made.command);
    return made;
  };
  const note = card("note", "Note", "A thought, a list,\nor a sketch.");
  card("comment", "", "Love this one!", { on: note.itemId });
  card("quote", "Proverb", "Every dog has its day.");
  card("flashcard", "Front", "Back");
  card("todo", "", "Walk the dog");
  card("weblink", "Web link", "", { url: "https://example.com" });
  const page = card("page", "Page", "A text with headings, lists, and links.");
  run(setPlacementExpanded(context, page.placeId, true));
  const saved = card("weblink", "Saved web page or PDF", "", { url: "https://example.com/article" });
  run(createInside(context, { homeId: saved.itemId, view: "comment", at: null, body: "A note in the saved copy." }).command);
  const board = card("note", "Board", "", { board: true });
  for (const [index, name] of ["Inside", "a", "board"].entries()) {
    run(createItemOnBoard(context, { boardId: board.itemId, view: "note", x: index * 220, y: 0, name }).command);
  }
  for (const [kind, name, file] of [["image", "Picture", picture], ["audio", "Song", undefined], ["video", "Video", undefined]] as const) {
    run(createMediaItem(context, { ...at(), kind, name, file: file === undefined ? undefined : `images/${file}`, url: file === undefined ? "https://example.com/media" : undefined }).command);
  }
  return encodeVault(store, meta!);
}
