import { describe, expect, it } from "vitest";
import { writeText } from "../src/core/actions";
import { makeOp } from "../src/core/commands";
import { replaceHits } from "../src/core/replace";
import { makeMatcher, searchBoard, type SearchOptions } from "../src/core/search";
import { IDEAS, loadTestContext, ROOT } from "./helpers";

const bodyOf = (context: ReturnType<typeof loadTestContext>) => context.store.get("texts", IDEAS)!.body;
const hitsIn = (context: ReturnType<typeof loadTestContext>, query: string, options: SearchOptions = {}) =>
  searchBoard(context.store, context.graph, ROOT, query, options).filter((hit) => hit.recordId === IDEAS && hit.field === "body");

describe("search options", () => {
  it("matches case, whole words, and regular expressions", () => {
    const words = (query: string, options: SearchOptions) => {
      const matcher = makeMatcher(query, options);
      if (typeof matcher !== "function") throw new Error(String(matcher));
      return matcher("Cat cat category cat_x 貓 cat.").map((range) => range.start);
    };
    expect(words("cat", {})).toEqual([0, 4, 8, 17, 25]);
    expect(words("cat", { caseSensitive: true })).toEqual([4, 8, 17, 25]);
    expect(words("cat", { wholeWord: true })).toEqual([0, 4, 25]);
    expect(words("c\\w+", { regex: true, caseSensitive: true })).toEqual([4, 8, 17, 25]);
    expect(words("cat", { regex: true, wholeWord: true })).toEqual([0, 4, 25]);
    expect(typeof makeMatcher("(", { regex: true })).toBe("string");
  });
});

describe("replace", () => {
  it("replaces all hits as one command, and undo gives the text back", () => {
    const context = loadTestContext();
    writeText(context.store, IDEAS, "one fish, two fish, Fish");
    const result = replaceHits(context, hitsIn(context, "fish"), "fish", "cat");
    expect(result).toMatchObject({ replaced: 3, skipped: 0 });
    context.history.run(result.command);
    expect(bodyOf(context)).toBe("one cat, two cat, cat");
    context.history.undo();
    expect(bodyOf(context)).toBe("one fish, two fish, Fish");
  });

  it("puts in the groups of a regular expression", () => {
    const context = loadTestContext();
    writeText(context.store, IDEAS, "2026-10-12 and 1998-05-01");
    const options = { regex: true };
    const result = replaceHits(context, hitsIn(context, "(\\d{4})-(\\d\\d)-(?<day>\\d\\d)", options), "(\\d{4})-(\\d\\d)-(?<day>\\d\\d)", "$<day>/$2/$1 ($$)", options);
    context.history.run(result.command);
    expect(bodyOf(context)).toBe("12/10/2026 ($) and 01/05/1998 ($)");
  });

  it("never changes link targets or linked passages", () => {
    const context = loadTestContext();
    writeText(context.store, IDEAS, "see [the cat](link:cat000000001) and the cat here, cat");
    const linkId = context.newId();
    context.store.write([makeOp("links", linkId, null, { id: linkId, kind: "link", from: ROOT, to: IDEAS, end: "none", quote: "the cat here" })].map(({ table, id, after }) => ({ table, id, after })));
    const result = replaceHits(context, hitsIn(context, "cat"), "cat", "dog");
    context.history.run(result.command);
    expect(bodyOf(context)).toBe("see [the dog](link:cat000000001) and the cat here, dog");
    expect(result).toMatchObject({ replaced: 2, skipped: 2 });
  });

  it("skips a hit whose text changed after the search", () => {
    const context = loadTestContext();
    writeText(context.store, IDEAS, "alpha beta");
    const hits = hitsIn(context, "beta");
    writeText(context.store, IDEAS, "alpha gamma");
    expect(replaceHits(context, hits, "beta", "x")).toMatchObject({ replaced: 0, skipped: 1 });
  });

  it("knows the Word codes of a plain search: ^p, ^t, ^&, ^#", () => {
    const context = loadTestContext();
    writeText(context.store, IDEAS, "one\n\ntwo\tthree 4^");
    context.history.run(replaceHits(context, hitsIn(context, "^p^p"), "^p^p", "^p").command);
    expect(bodyOf(context)).toBe("one\ntwo\tthree 4^");
    context.history.run(replaceHits(context, hitsIn(context, "^t"), "^t", "[^&]^^").command);
    expect(bodyOf(context)).toBe("one\ntwo[\t]^three 4^");
    context.history.run(replaceHits(context, hitsIn(context, "^#^^"), "^#^^", "#").command);
    expect(bodyOf(context)).toBe("one\ntwo[\t]^three #");
  });

  it("knows \\n and \\t in the replacement of a regular expression, and ^ $ per line", () => {
    const context = loadTestContext();
    writeText(context.store, IDEAS, "a, b\nc");
    const options = { regex: true };
    context.history.run(replaceHits(context, hitsIn(context, ",\\s*", options), ",\\s*", "\\n\\t", options).command);
    expect(bodyOf(context)).toBe("a\n\tb\nc");
    context.history.run(replaceHits(context, hitsIn(context, "^(\\w)$", options), "^(\\w)$", "- $1", options).command);
    expect(bodyOf(context)).toBe("- a\n\tb\n- c");
  });
});
