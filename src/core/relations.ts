// Command builders for relation links (SPEC 2.2, kind "link"): make, change (label, group, caps, color, dashes, ends),
// and delete.

import { makeOp, type Command } from "./commands";
import {
  DEFAULT_END_CAP,
  DEFAULT_START_CAP,
  type Id,
  type LinkCap,
  type RelationLink,
} from "./types";
import type { ActionContext } from "./actions";
import { requireRecord, requireRelation } from "./records";

export function createRelation(
  context: ActionContext,
  input: { from: Id; to: Id; label?: string; group?: string; quote?: string },
): { command: Command; linkId: Id } {
  const linkId = context.newId();
  // A new link is 0-way: no arrow at either end. (A link with no "end" field shows an arrow: older links keep theirs.)
  const link: RelationLink = { id: linkId, kind: "link", from: input.from, to: input.to, end: "none" };
  if (input.quote !== undefined && input.quote !== "") link.quote = input.quote;
  if (input.label !== undefined && input.label !== "") link.label = input.label;
  if (input.group !== undefined && input.group !== "") link.group = input.group;
  return { command: { label: "Create link", ops: [makeOp("links", linkId, null, link)] }, linkId };
}

/**
 * Changes the label, the group, the caps, the color, the dashes, or one end of a relation.
 * Empty strings remove label and group. A default cap removes the cap field.
 */
export function updateRelation(
  context: ActionContext,
  linkId: Id,
  changes: { from?: Id; to?: Id; label?: string; group?: string; start?: LinkCap; end?: LinkCap; onBoard?: boolean; color?: string | null; dashed?: boolean },
): Command {
  const before = requireRelation(context, linkId);
  const after: RelationLink = { ...before };
  if (changes.onBoard === true) after.onBoard = true;
  if (changes.onBoard === false) delete after.onBoard;
  if (changes.color === null) delete after.color;
  else if (changes.color !== undefined) after.color = changes.color;
  if (changes.dashed === true) after.dashed = true;
  if (changes.dashed === false) delete after.dashed;
  if (changes.from !== undefined) after.from = changes.from;
  if (changes.to !== undefined) after.to = changes.to;
  applyOptionalText(after, "label", changes.label);
  applyOptionalText(after, "group", changes.group);
  applyCap(after, "start", changes.start, DEFAULT_START_CAP);
  applyCap(after, "end", changes.end, DEFAULT_END_CAP);
  const rerouted = after.from !== before.from || after.to !== before.to;
  return { label: rerouted ? "Reroute link" : "Edit link", ops: [makeOp("links", linkId, before, after)] };
}

export function deleteLinks(context: ActionContext, linkIds: readonly Id[]): Command {
  const ops = linkIds.map((linkId) =>
    makeOp("links", linkId, requireRecord(context.store.get("links", linkId), "links", linkId), null),
  );
  return { label: ops.length > 1 ? `Delete ${ops.length} links` : "Delete link", ops };
}

function applyOptionalText(link: RelationLink, field: "label" | "group", value: string | undefined): void {
  if (value === undefined) return;
  if (value === "") delete link[field];
  else link[field] = value;
}

function applyCap(link: RelationLink, field: "start" | "end", value: LinkCap | undefined, fallback: LinkCap): void {
  if (value === undefined) return;
  if (value === fallback) delete link[field];
  else link[field] = value;
}
