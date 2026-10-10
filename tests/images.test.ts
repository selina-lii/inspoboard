import { describe, expect, it } from "vitest";
import { imageAlt, imageMarkdown, pastedImageName, vaultImagePath } from "../src/ui/editor/images";
import { previewOf } from "../src/ui/board/boardModel";

describe("images in a text", () => {
  it("accepts only vault images; a web image is not loaded", () => {
    expect(vaultImagePath("images/pasted-0123abcd.png")).toBe("images/pasted-0123abcd.png");
    expect(vaultImagePath(" <images/a.JPG> ")).toBe("images/a.JPG");
    expect(vaultImagePath("https://a.example/a.png")).toBeNull();
    expect(vaultImagePath("images/../vault.json")).toBeNull();
    expect(vaultImagePath("images/.hidden.png")).toBeNull();
    expect(vaultImagePath("images/a/b.png")).toBeNull();
  });

  it("names pasted images by type and writes plain Markdown", () => {
    expect(pastedImageName({ name: "image.png", type: "image/png" })).toBe("pasted.png");
    expect(pastedImageName({ name: "My photo!.jpeg", type: "image/jpeg" })).toBe("My-photo.jpg");
    expect(pastedImageName({ name: "", type: "image/webp" })).toBe("pasted.webp");
    expect(pastedImageName({ name: "a.svg", type: "image/svg+xml" })).toBeNull();
    expect(imageMarkdown("images/a.png", "a [b]\nc")).toBe("![a  b  c](images/a.png)");
    expect(previewOf("Look:\n![sky](images/sky.png)")).toBe("Look:\n[sky]");
  });

  it("keeps the width of an image in its alt text, as in Obsidian", () => {
    expect(imageAlt("sky|320")).toEqual({ alt: "sky", width: 320 });
    expect(imageAlt("|320x200")).toEqual({ alt: "", width: 320 });
    expect(imageAlt("a | b")).toEqual({ alt: "a | b", width: null });
    expect(imageAlt("sky")).toEqual({ alt: "sky", width: null });
    expect(imageMarkdown("images/sky.png", "sky", 319.6)).toBe("![sky|320](images/sky.png)");
    expect(imageMarkdown("images/sky.png", "a|b")).toBe("![a b](images/sky.png)");
    expect(previewOf("![sky|320](images/sky.png)")).toBe("[sky]");
  });
});
