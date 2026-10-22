import { describe, expect, it } from "vitest";
import { applyFoundMedia, createMediaItem, DEFAULT_MEDIA_SOURCES, durationLabel, mediaKindOf, normalizeHost, setMedia } from "../src/core/media";
import { decodeVault, encodeVault } from "../src/core/format";
import { readSettings } from "../src/io/settings";
import { schemaErrors } from "../src/core/validate";
import { loadTestContext, ROOT } from "./helpers";

describe("multimedia items", () => {
  it("finds the kind of a link from the media sources (settings list)", () => {
    expect(mediaKindOf("https://open.spotify.com/track/abc", DEFAULT_MEDIA_SOURCES)).toBe("audio");
    expect(mediaKindOf("https://www.youtube.com/watch?v=x", DEFAULT_MEDIA_SOURCES)).toBe("video");
    expect(mediaKindOf("https://m.youtube.com/watch?v=x", DEFAULT_MEDIA_SOURCES)).toBe("video");
    expect(mediaKindOf("https://example.org/song", DEFAULT_MEDIA_SOURCES)).toBeNull();
    expect(mediaKindOf("not a link", DEFAULT_MEDIA_SOURCES)).toBeNull();
    const off = DEFAULT_MEDIA_SOURCES.map((source) => ({ ...source, on: source.host !== "youtube.com" }));
    expect(mediaKindOf("https://www.youtube.com/watch?v=x", off)).toBeNull();
    expect(normalizeHost("https://www.Tidal.com/x")).toBe("tidal.com");
    expect(normalizeHost("not a host")).toBeNull();
  });

  it("makes a media item, saves and reads it, and undo removes it", () => {
    const context = loadTestContext();
    const { command, itemId } = createMediaItem(context, { boardId: ROOT, x: 10, y: 20, kind: "audio", url: "https://open.spotify.com/track/abc" });
    context.history.run(command);
    expect(context.store.get("items", itemId)?.media).toEqual({ kind: "audio", url: "https://open.spotify.com/track/abc" });
    expect(schemaErrors("items", context.store.get("items", itemId))).toEqual([]);
    const files = encodeVault(context.store, { format: 2, root: ROOT });
    const back = decodeVault(files);
    expect(back.store.get("items", itemId)?.media?.url).toBe("https://open.spotify.com/track/abc");
    context.history.undo();
    expect(context.store.has("items", itemId)).toBe(false);
  });

  it("puts found data in, but keeps the user's own name and artist", () => {
    const context = loadTestContext();
    const { command, itemId } = createMediaItem(context, { boardId: ROOT, x: 0, y: 0, kind: "audio", url: "https://music.apple.com/x" });
    context.history.run(command);
    context.history.run(applyFoundMedia(context, itemId, { title: "Kind of Blue", artist: "Miles Davis", cover: "images/cover.jpg", duration: 337.4 }));
    expect(context.store.get("items", itemId)).toMatchObject({ name: "Kind of Blue", media: { artist: "Miles Davis", cover: "images/cover.jpg", duration: 337 } });
    context.history.run(setMedia(context, itemId, { ...context.store.get("items", itemId)!.media!, artist: "My artist" }));
    context.history.run(applyFoundMedia(context, itemId, { title: "Other", artist: "Other" }));
    expect(context.store.get("items", itemId)).toMatchObject({ name: "Kind of Blue", media: { artist: "My artist" } });
    expect(durationLabel(337)).toBe("5:37");
    expect(durationLabel(3723)).toBe("1:02:03");
  });

  it("reads media sources from settings and keeps the defaults without them", () => {
    expect(readSettings(undefined).mediaSources.length).toBe(DEFAULT_MEDIA_SOURCES.length);
    const settings = readSettings(JSON.stringify({ mediaSources: [{ host: "www.tidal.com", kind: "audio" }, { host: "tidal.com", kind: "video" }, { host: "x", kind: "audio" }, { host: "vimeo.com", kind: "sound" }] }));
    expect(settings.mediaSources).toEqual([{ host: "tidal.com", kind: "audio", on: true }]);
  });
});
