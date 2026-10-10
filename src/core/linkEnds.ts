// A link between two ends, from anywhere: an item, or a passage in an item (its text, or its saved web page or PDF).
// The link bench (src/ui/app/LinkBench.tsx) makes these links. See docs/SPEC.md section 7.10.
// - The first end is the source, the second end is the target (`quote`: the target passage).
// - A source passage in a note or page text becomes "[passage](link:<id>)" in that text, in the same command.
//   If the text changed and the passage is not there one time exactly, the passage has more than one line or a
//   bracket, or the passage is in a web page or PDF, the link keeps it in `fromQuote` (the text does not change).

import { makeOp, type Command, type Op } from "./commands";
import type { ActionContext } from "./actions";
import { withTextLink } from "./refs";
import type { Id, RelationLink } from "./types";

/** One end of a link: an item, or a passage in it. `range`: where the passage is in the item text, if it is there. */
export type PassageEnd = { itemId: Id; quote?: string; range?: { from: number; to: number } };

/** The place of a passage in a text: the given range if it still holds the passage, else its only place. */
export function passageRange(body: string, end: PassageEnd): { from: number; to: number } | null {
  const quote = end.quote;
  if (quote === undefined || quote === "") return null;
  if (end.range !== undefined && body.slice(end.range.from, end.range.to) === quote) return end.range;
  const first = body.indexOf(quote);
  if (first === -1 || body.indexOf(quote, first + 1) !== -1) return null;
  return { from: first, to: first + quote.length };
}

/** True if the two ends are the same item and passage (a link to itself). */
export function sameEnd(a: PassageEnd, b: PassageEnd): boolean {
  return a.itemId === b.itemId && (a.quote ?? "") === (b.quote ?? "");
}

/** Links the ends: one command (the link, and the source text). Throws if an item is gone. */
export function linkEnds(context: ActionContext, source: PassageEnd, target: PassageEnd): { command: Command; linkId: Id } {
  for (const end of [source, target]) {
    if (!context.store.has("items", end.itemId)) throw new Error(`Item "${end.itemId}" is gone.`);
  }
  const linkId = context.newId();
  const link: RelationLink = { id: linkId, kind: "link", from: source.itemId, to: target.itemId, end: "none" };
  if (target.quote !== undefined && target.quote !== "") link.quote = target.quote;
  const ops: Op[] = [];
  if (source.quote !== undefined && source.quote !== "") {
    const text = context.store.get("texts", source.itemId);
    const range = text === undefined ? null : passageRange(text.body, source);
    // A Markdown link holds one line with no brackets. Else the link keeps the passage in fromQuote.
    const wrappable = !/[\n[\]]/.test(source.quote);
    const wrapped = text === undefined || range === null || !wrappable ? null : withTextLink(text.body, range.from, range.to, source.quote, linkId);
    if (text !== undefined && wrapped !== null) {
      const item = context.store.get("items", source.itemId)!;
      ops.push(makeOp("texts", source.itemId, text, { id: source.itemId, body: wrapped }));
      ops.push(makeOp("items", source.itemId, item, { ...item, modified: context.now() }));
    } else {
      link.fromQuote = source.quote;
    }
  }
  ops.unshift(makeOp("links", linkId, null, link));
  return { command: { label: "Form link", ops }, linkId };
}
