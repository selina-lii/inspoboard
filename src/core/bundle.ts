// Board bundles: export a board to a folder, and import it again. See docs/SPEC.md section 8.1.
//
// A bundle folder has two versions of one board:
// - "<board name>.md": all of the board as one linear Markdown document (linearize.ts). Easy to read anywhere.
// - The board data in the vault format (vault.json, table/*.jsonl, items/*.md, images/). The root of this
//   small vault is the board item. The import reads this part. The folder also opens as a vault.
//
// Data safety:
// - Export writes a new folder. It never changes the vault.
// - Import only adds records. Each record gets a new ID, so no record of the vault is ever replaced or changed.
//   One command: undo removes the whole import.

import { makeOp, type Command, type Op } from "./commands";
import type { ActionContext } from "./actions";
import { decodeVault, encodeVault, FORMAT_VERSION, type VaultFiles } from "./format";
import type { GraphIndex } from "./graph";
import { linearize } from "./linearize";
import type { Words } from "./words";
import { Store } from "./store";
import type { Id, InsideLink, ItemRecord, LinkRecord, OutlineRecord, PlaceLink, StampRecord, TableName, TableRecords, TextRecord } from "./types";

/** Text links in a body: [label](item:<id>) and [label](link:<id>). */
const TEXT_LINK = /\[([^\]\n]*)\]\((item|link):([0-9a-z]{12})\)/g;
/** Vault images in a body: ![alt](images/<name>). */
const TEXT_IMAGE = /!\[[^\]\n]*\]\(<?(images\/[A-Za-z0-9_.-]+)>?\)/g;

export type BundleContent = {
  /** The vault files of the board data (vault.json, tables, texts). */
  files: VaultFiles;
  /** The Markdown document: the whole board, linear. */
  markdown: string;
  /** The vault images that the board uses ("images/<name>"). The backend copies them into the bundle. */
  images: string[];
};

/** All records of a board and of everything in it (cards, inner boards, groups, objects, replies, links between them). */
export function collectBoard(store: Store, graph: GraphIndex, boardId: Id): Store {
  const out = new Store();
  const items = new Set<Id>();
  const stamps = new Set<Id>();
  const places: PlaceLink[] = [];
  const inside: InsideLink[] = [];
  const outlines: OutlineRecord[] = [];
  const queue: Id[] = [boardId];
  const addItem = (id: Id) => {
    if (items.has(id) || !store.has("items", id)) return;
    items.add(id);
    queue.push(id);
  };
  items.add(boardId);
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const place of graph.childrenOf(id)) {
      places.push(place);
      if (store.has("stamps", place.to)) stamps.add(place.to);
      else addItem(place.to);
    }
    outlines.push(...graph.outlinesOn(id));
    // Comments, notes, and links of an item, and the replies of a comment (they have no placement).
    for (const object of graph.attachedTo(id)) addItem(object.id);
    // The small items inside a page or a link object.
    for (const link of graph.insideOf(id)) {
      if (!store.has("items", link.to)) continue;
      inside.push(link);
      addItem(link.to);
    }
  }
  const write = <T extends TableName>(table: T, records: Iterable<TableRecords[T]>) => out.write([...records].map((record) => ({ table, id: record.id, after: record })));
  write("items", [...items].map((id) => store.get("items", id)!));
  write("texts", [...items].flatMap((id) => store.get("texts", id) ?? []));
  write("stamps", [...stamps].map((id) => store.get("stamps", id)!));
  write("outlines", outlines);
  // An item that is only a reference here: in the bundle, its first placement is its home.
  const homes = new Set<Id>(places.filter((place) => place.ref !== true).map((place) => place.to));
  write(
    "links",
    places.map((place) => {
      if (place.ref !== true || homes.has(place.to)) return place;
      homes.add(place.to);
      const home: PlaceLink = { ...place };
      delete home.ref;
      return home;
    }),
  );
  write("links", inside);
  // Relation links between two records of the bundle.
  write(
    "links",
    [...store.all("links")].filter((link) => link.kind === "link" && out.has("items", link.from) && out.has("items", link.to)),
  );
  // References to records outside the bundle: an attachment ends, and a text link becomes its label.
  for (const item of [...out.all("items")]) {
    if (item.on !== undefined && !out.has("items", item.on)) {
      const free: ItemRecord = { ...item };
      delete free.on;
      delete free.quote;
      out.write([{ table: "items", id: item.id, after: free }]);
    }
  }
  for (const text of [...out.all("texts")]) {
    const body = text.body.replace(TEXT_LINK, (whole, label: string, kind: string, id: string) => (out.has(kind === "item" ? "items" : "links", id) ? whole : label));
    if (body !== text.body) out.write([{ table: "texts", id: text.id, after: { id: text.id, body } }]);
  }
  return out;
}

/** The two versions of a board, for a bundle folder. */
export function exportBundle(store: Store, graph: GraphIndex, boardId: Id, words?: Words): BundleContent {
  const board = collectBoard(store, graph, boardId);
  return {
    files: encodeVault(board, { format: FORMAT_VERSION, root: boardId }),
    markdown: linearize(store, graph, boardId, { words }),
    images: imagesOf(board),
  };
}

/** The vault images that the records use: the images of items (see mapItemImages) and images in texts. */
export function imagesOf(store: Store): string[] {
  const paths = new Set<string>();
  for (const item of store.all("items")) mapItemImages(item, (path) => (paths.add(path), path));
  for (const text of store.all("texts")) for (const match of text.body.matchAll(TEXT_IMAGE)) paths.add(match[1]!);
  return [...paths].sort();
}

/** Reads the board data of a bundle. Null with a reason if it is not a bundle that the app can read. */
export function readBundle(files: ReadonlyMap<string, string>): { store: Store; root: Id } | { problem: string } {
  const decoded = decodeVault(files);
  const errors = decoded.problems.filter((problem) => problem.severity === "error");
  if (decoded.meta === null || errors.length > 0) return { problem: errors[0]?.message ?? "The folder has no board data (vault.json)." };
  if (!decoded.store.has("items", decoded.meta.root)) return { problem: "The board of the bundle is missing." };
  return { store: decoded.store, root: decoded.meta.root };
}

/**
 * Adds a bundle board to a board of the vault, as a card at (x, y). All records get new IDs. Images use their
 * new vault paths (`imagePaths`: bundle path -> vault path). Returns one command and the new board item ID.
 */
export function importBundle(
  context: ActionContext,
  bundle: { store: Store; root: Id },
  target: { boardId: Id; x: number; y: number },
  imagePaths: ReadonlyMap<string, string> = new Map(),
): { command: Command; rootId: Id } {
  const source = bundle.store;
  const ids = new Map<Id, Id>();
  const newId = (id: Id): Id => {
    let next = ids.get(id);
    if (next === undefined) {
      do next = context.newId();
      while (context.store.has("items", next) || context.store.has("links", next) || context.store.has("stamps", next) || context.store.has("outlines", next) || [...ids.values()].includes(next));
      ids.set(id, next);
    }
    return next;
  };
  const known = (table: TableName, id: Id | undefined) => id !== undefined && source.has(table, id);
  const image = (path: string) => imagePaths.get(path) ?? path;
  const ops: Op[] = [];

  for (const item of source.all("items")) {
    const after: ItemRecord = { ...item, id: newId(item.id) };
    if (known("items", item.on)) after.on = newId(item.on!);
    else {
      delete after.on;
      delete after.quote;
    }
    ops.push(makeOp("items", after.id, null, mapItemImages(after, image)));
  }
  for (const text of source.all("texts")) {
    if (!source.has("items", text.id)) continue;
    const body = text.body
      .replace(TEXT_LINK, (whole, label: string, kind: string, id: string) => (known(kind === "item" ? "items" : "links", id) ? `[${label}](${kind}:${newId(id)})` : label))
      .replace(TEXT_IMAGE, (whole, path: string) => whole.replace(path, image(path)));
    const after: TextRecord = { id: newId(text.id), body };
    ops.push(makeOp("texts", after.id, null, after));
  }
  for (const stamp of source.all("stamps")) {
    const after: StampRecord = { ...stamp, id: newId(stamp.id) };
    ops.push(makeOp("stamps", after.id, null, after));
  }
  for (const outline of source.all("outlines")) {
    if (!known("items", outline.board)) continue;
    const after: OutlineRecord = { ...outline, id: newId(outline.id), board: newId(outline.board) };
    ops.push(makeOp("outlines", after.id, null, after));
  }
  for (const link of source.all("links")) {
    const after = remapLink(link, source, newId);
    if (after !== null) ops.push(makeOp("links", after.id, null, after));
  }
  // The bundle board goes onto the target board as a card.
  const rootId = newId(bundle.root);
  const placeId = context.newId();
  const home: PlaceLink = { id: placeId, kind: "place", from: target.boardId, to: rootId, view: "page", x: target.x, y: target.y, w: 240, h: 320 };
  ops.push(makeOp("links", placeId, null, home));
  const name = source.get("items", bundle.root)?.name ?? "";
  return { command: { label: `Import board${name !== "" ? ` "${name}"` : ""}`, ops }, rootId };
}

/**
 * The one list of item fields that hold a vault image: the background, and the cover and picture of a media item.
 * A copy of the item with each image path changed (`change` sees every path). A new image field goes here.
 */
function mapItemImages(item: ItemRecord, change: (path: string) => string): ItemRecord {
  const map = (path: string | undefined) => (path?.startsWith("images/") === true ? change(path) : path);
  const after: ItemRecord = { ...item };
  if (after.background !== undefined) after.background = map(after.background);
  if (after.media !== undefined) {
    after.media = { ...after.media };
    if (after.media.cover !== undefined) after.media.cover = map(after.media.cover);
    if (after.media.file !== undefined) after.media.file = map(after.media.file);
  }
  return after;
}

function remapLink(link: LinkRecord, source: Store, newId: (id: Id) => Id): LinkRecord | null {
  const fromKnown = source.has("items", link.from);
  const toKnown = source.has("items", link.to) || (link.kind === "place" && source.has("stamps", link.to));
  if (!fromKnown || !toKnown) return null;
  if (link.kind === "link" || link.kind === "inside") return { ...link, id: newId(link.id), from: newId(link.from), to: newId(link.to) };
  const after: PlaceLink = { ...link, id: newId(link.id), from: newId(link.from), to: newId(link.to) };
  if (link.outline !== undefined) {
    if (source.has("outlines", link.outline)) after.outline = newId(link.outline);
    else delete after.outline;
  }
  if (link.parent !== undefined) {
    if (source.has("links", link.parent)) after.parent = newId(link.parent);
    else delete after.parent;
  }
  return after;
}
