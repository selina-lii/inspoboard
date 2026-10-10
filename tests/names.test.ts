import { describe, expect, it } from "vitest";
import { randomCode, uniqueCode } from "../src/core/names";

describe("item codes", () => {
  it("makes codes in the four formats only", () => {
    const formats = new Set<string>();
    for (let index = 0; index < 2000; index += 1) {
      const code = randomCode();
      expect(code).toMatch(/^(\d{3}|\d{4}|[A-Z]{2}\d{2}|[A-Z]{3})$/);
      formats.add(/^\d{3}$/.test(code) ? "3d" : /^\d{4}$/.test(code) ? "4d" : /^[A-Z]{2}\d{2}$/.test(code) ? "2l2d" : "3l");
    }
    expect(formats.size).toBe(4);
  });

  it("avoids a code that is taken", () => {
    const values = [0.99, 0, 0, 0, 0.99, 0.5, 0.5, 0.5];
    let index = 0;
    const random = () => values[index++ % values.length]!;
    // The first code is "AAA". It is taken, so the next code comes.
    expect(uniqueCode(new Set(["AAA"]), random)).toBe("NNN");
  });
});
