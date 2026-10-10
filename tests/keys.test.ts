import { describe, expect, it } from "vitest";
import { isComposing, shortcutKey } from "../src/ui/app/keys";

describe("keys", () => {
  it("always uses the English (US) key position", () => {
    expect(shortcutKey({ key: "Z", code: "KeyZ" })).toBe("z");
    expect(shortcutKey({ key: "я", code: "KeyZ" })).toBe("z");
    expect(shortcutKey({ key: "φ", code: "KeyF" })).toBe("f");
    // A Chinese input method can send "Process" as the key.
    expect(shortcutKey({ key: "Process", code: "KeyN" })).toBe("n");
  });

  it("keeps named keys", () => {
    expect(shortcutKey({ key: "Escape", code: "Escape" })).toBe("escape");
    expect(shortcutKey({ key: "=", code: "Equal" })).toBe("=");
  });

  it("detects an IME composition", () => {
    expect(isComposing({ key: "Enter", code: "Enter", isComposing: true })).toBe(true);
    expect(isComposing({ key: "Enter", code: "Enter", keyCode: 229 })).toBe(true);
    expect(isComposing({ key: "Enter", code: "Enter", nativeEvent: { isComposing: true } })).toBe(true);
    expect(isComposing({ key: "Enter", code: "Enter", keyCode: 13 })).toBe(false);
  });
});
