// Reads a record for a command builder. A missing record (or a link of a different kind) is an error: the builder
// cannot make a correct command.

import type { Store } from "./store";
import type { Id, PlaceLink, RelationLink } from "./types";

type Readable = { store: Store };

export function requireRecord<R>(record: R | undefined, table: string, id: Id): R {
  if (record === undefined) throw new Error(`No record "${id}" in table "${table}".`);
  return record;
}

export function requirePlace(context: Readable, placeId: Id): PlaceLink {
  const link = requireRecord(context.store.get("links", placeId), "links", placeId);
  if (link.kind !== "place") throw new Error(`Link "${placeId}" is not a place link.`);
  return link;
}

export function requireRelation(context: Readable, linkId: Id): RelationLink {
  const link = requireRecord(context.store.get("links", linkId), "links", linkId);
  if (link.kind !== "link") throw new Error(`Link "${linkId}" is not a relation link.`);
  return link;
}
