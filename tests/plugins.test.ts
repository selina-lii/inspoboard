import { describe, expect, it } from "vitest";
import type { PluginHost } from "../src/io/backend";
import { defaultOptions, isValidOption, readDetails, readProgress, readTexts } from "../src/io/plugins";
import { Session } from "../src/io/session";
import { collectTexts, isFresh, ITEMS_PER_CALL, runTransform, withResults, without, withShown, type OverlayMap } from "../src/ui/plugins/overlay";
import { FakeBackend } from "./fakeBackend";
import { DATA_INTEGRITY, IDEAS, readTestVault, TOOL_RESEARCH } from "./helpers";

/** A plugin that writes each text in upper case. */
function upperHost(calls: unknown[] = []): PluginHost {
  return {
    folder: async () => null,
    setFolder: async () => undefined,
    list: async () => [],
    onProgress: async () => () => undefined,
    chooseSaveFile: async () => null,
    call: async (_name, method, params) => {
      calls.push(params);
      if (method !== "transform") return {};
      const { texts } = params as { texts: string[] };
      return { texts: texts.map((text) => text.toUpperCase()) };
    },
  };
}

describe("plugin protocol", () => {
  it("reads details and drops bad parts", () => {
    const details = readDetails(
      {
        title: "Translate",
        icon: "languages",
        options: [
          { key: "target", label: "To", choices: [{ value: "zh", label: "Chinese" }, { value: "en" }], default: "en" },
          { key: "bad", choices: [] },
          "junk",
        ],
        actions: [{ id: "get", label: "Download", enabled: false }, { label: "no id" }],
      },
      "fallback",
    );
    expect(details.options).toHaveLength(1);
    const first = details.options[0]!;
    expect(first.kind === "choice" && first.choices[1]).toEqual({ value: "en", label: "en" });
    expect(defaultOptions(details)).toEqual({ target: "en" });
    expect(details.actions).toEqual([{ id: "get", label: "Download", detail: "", enabled: false }]);
    expect(readDetails(null, "Echo").title).toBe("Echo");
  });

  it("reads text options with a pattern; a bad pattern checks nothing", () => {
    const details = readDetails(
      {
        options: [
          { key: "pitch", kind: "text", label: "Pitch", default: "0 Hz", placeholder: "+2 Hz", pattern: "^\\s*[+\\-−]?\\s*\\d+(\\.\\d+)?\\s*(hz)?\\s*$" },
          { key: "free", kind: "text", pattern: "(" },
        ],
      },
      "Voice",
    );
    const [pitch, free] = details.options;
    expect(pitch).toMatchObject({ kind: "text", default: "0 Hz", placeholder: "+2 Hz" });
    expect(isValidOption(pitch!, "+2 Hz")).toBe(true);
    expect(isValidOption(pitch!, "-1.5hz")).toBe(true);
    expect(isValidOption(pitch!, "loud")).toBe(false);
    expect(free).toMatchObject({ kind: "text", pattern: null });
    expect(isValidOption(free!, "anything")).toBe(true);
    expect(defaultOptions(details)).toEqual({ pitch: "0 Hz", free: "" });
  });

  it("refuses a reply with the wrong number of texts", () => {
    expect(readTexts({ texts: ["a", "b"] }, 2)).toEqual(["a", "b"]);
    expect(() => readTexts({ texts: ["a"] }, 2)).toThrow();
    expect(() => readTexts({ texts: ["a", 1] }, 2)).toThrow();
    expect(readProgress({ done: 1, total: 3 })).toEqual({ done: 1, total: 3, label: "", partial: null });
    expect(readProgress({ done: 1, total: 3, partial: { index: 0, text: "x" } })?.partial).toEqual({ index: 0, text: "x" });
    expect(readProgress({ done: "1" })).toBeNull();
  });
});

describe("view overlay", () => {
  it("collects names and bodies, but not empty texts", async () => {
    const session = await Session.open(new FakeBackend(readTestVault()), "/vault");
    const { slots, texts } = collectTexts(session.store, [IDEAS, IDEAS, "missing00000"]);
    expect(slots[0]).toEqual({ id: IDEAS, field: "title" });
    expect(texts[0]).toBe(session.store.get("items", IDEAS)!.name);
    expect(new Set(slots.map((slot) => slot.id))).toEqual(new Set([IDEAS]));
  });

  it("transforms in parts and never changes the store or the files", async () => {
    const backend = new FakeBackend(readTestVault());
    const session = await Session.open(backend, "/vault");
    const revision = session.store.getRevision();
    const calls: unknown[] = [];
    let overlay: OverlayMap = new Map();
    const ids = [TOOL_RESEARCH, IDEAS, DATA_INTEGRITY];
    const progress: [number, number][] = [];
    const count = await runTransform(upperHost(calls), "upper", session.store, ids, { target: "x" }, {
      onResults: (slots, results, sources) => (overlay = withResults(overlay, "upper", "k", slots, results, sources)),
      onProgress: (done, total) => progress.push([done, total]),
      isCancelled: () => false,
    });
    expect(count).toBe(3);
    expect(calls).toHaveLength(Math.ceil(ids.length / ITEMS_PER_CALL));
    expect(overlay.get(IDEAS)!.title).toBe(session.store.get("items", IDEAS)!.name.toUpperCase());
    expect(progress.at(-1)![0]).toBe(progress.at(-1)![1]);

    await session.close();
    expect(session.store.getRevision()).toBe(revision);
    expect(backend.calls.filter((call) => call.startsWith("write"))).toEqual([]);
    expect(without(overlay, [IDEAS]).has(IDEAS)).toBe(false);
    expect(without(overlay, "all").size).toBe(0);
    // The cache: hidden results stay, and they are fresh while the text is the same.
    const hidden = withShown(overlay, { plugin: "upper" }, false);
    expect([...hidden.values()].every((entry) => !entry.shown)).toBe(true);
    expect(isFresh(session.store, hidden.get(IDEAS), "upper", "k", IDEAS)).toBe(true);
    expect(isFresh(session.store, hidden.get(IDEAS), "upper", "other options", IDEAS)).toBe(false);
    expect(withShown(hidden, [IDEAS], true).get(IDEAS)!.shown).toBe(true);
  });

  it("stops between parts after a cancel", async () => {
    const session = await Session.open(new FakeBackend(readTestVault()), "/vault");
    const ids = [...session.store.all("items")].map((item) => item.id);
    const calls: unknown[] = [];
    let cancelled = false;
    await runTransform(upperHost(calls), "upper", session.store, [...ids, ...ids], {}, {
      onResults: () => (cancelled = true),
      onProgress: () => undefined,
      isCancelled: () => cancelled,
    });
    expect(calls).toHaveLength(1);
  });
});
