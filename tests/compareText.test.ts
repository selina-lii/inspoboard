import { describe, expect, it } from "vitest";
import { copyChange, readChanges, rowsOf, shortened } from "../src/ui/plugins/compare/compareText";

// "one two three four" vs "one 2 three": "two" changed to "2", "four" only on the left.
const left = "one two three four";
const right = "one 2 three";
const reply = {
  changes: [
    { left: { from: 3, start: 4, end: 7 }, right: { from: 3, start: 4, end: 5 } },
    { left: { from: 13, start: 14, end: 18 }, right: { from: 11, start: 11, end: 11 } },
  ],
};

describe("compare rows", () => {
  it("puts the same parts and the changes in order", () => {
    const changes = readChanges(reply, left.length, right.length);
    expect(rowsOf(left, right, changes)).toEqual([
      { kind: "same", left: "one ", right: "one " },
      { kind: "change", left: "two", right: "2", change: 0 },
      { kind: "same", left: " three ", right: " three" },
      { kind: "change", left: "four", right: "", change: 1 },
    ]);
  });

  it("copies a change with the space before it", () => {
    const changes = readChanges(reply, left.length, right.length);
    expect(copyChange(changes[0]!, left, right, "left")).toBe("one two three");
    expect(copyChange(changes[1]!, left, right, "left")).toBe("one 2 three four");
    expect(copyChange(changes[1]!, right, left, "right")).toBe("one two three");
  });

  it("refuses a bad reply", () => {
    expect(() => readChanges({}, 1, 1)).toThrow();
    expect(() => readChanges({ changes: [{ left: { from: 0, start: 0, end: 9 }, right: { from: 0, start: 0, end: 0 } }] }, 3, 3)).toThrow();
  });

  it("shows only the ends of a long same part", () => {
    const text = Array.from({ length: 300 }, (_, index) => `w${index}`).join(" ");
    const short = shortened(text, true, true)!;
    expect(text.startsWith(short.head) && text.endsWith(short.tail)).toBe(true);
    expect(short.hidden).toBeGreaterThan(100);
    expect(shortened(text, false, true)!.head).toBe("");
    expect(shortened("short", true, true)).toBeNull();
  });
});

describe("compare marks on PDF pages", () => {
  it("places a change on its words, and a place for words only on the other side", async () => {
    const { marksOf, pageBoxes } = await import("../src/ui/plugins/compare/compareText");
    const changes = readChanges(reply, left.length, right.length);
    expect(marksOf(changes, "left").map((mark) => mark.kind)).toEqual(["changed", "removed"]);
    expect(marksOf(changes, "right").map((mark) => [mark.kind, mark.start, mark.end])).toEqual([["changed", 4, 5], ["removed", 11, 11]]);
    // "one two three four": one run of 18 characters, 180 units wide, at (10, 20) on a 200 × 100 page.
    const runs = [{ start: 0, end: 18, page: 1, left: 10, top: 20, width: 180, height: 10 }];
    const boxes = pageBoxes(runs, [{ width: 200, height: 100 }], marksOf(changes, "left"));
    expect(boxes.map((box) => [box.change, box.left, box.width])).toEqual([[0, 0.25, 0.15], [1, 0.75, 0.2]]);
    // "one 2 three" (11 characters): the words "four" only on the left go at its end (width 0).
    const place = pageBoxes([{ start: 0, end: 11, page: 1, left: 0, top: 0, width: 110, height: 10 }], [{ width: 200, height: 100 }], marksOf(changes, "right"));
    expect(place[1]).toMatchObject({ change: 1, left: 0.55, width: 0 });
  });
});
