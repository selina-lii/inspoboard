// Multimedia items (SPEC 7.14): pictures, songs, and videos. An album or a playlist is a group of media items.
// - The core keeps only what the user gives and what a plugin returned: the link, the name, the artist, the cover.
//   The core makes no network request. A "media-info" plugin can read the title, the artist, and the cover of a link.
// - Media sources: the sites whose links become media items. The list is a setting (the user can change it).

import { createItemOnBoard, emptyCommand, type ActionContext } from "./actions";
import { makeOp, type Command } from "./commands";
import type { Id, ItemRecord, MediaInfo, MediaKind } from "./types";

/** Names of the media kinds, for the card and the settings. */
export const MEDIA_KIND_LABELS: Record<MediaKind, string> = { image: "Picture", audio: "Music", video: "Video" };

/** A site whose links are media: its host (and its subdomains), and the kind of its items. */
export type MediaSource = { host: string; kind: MediaKind; on: boolean };

export const DEFAULT_MEDIA_SOURCES: readonly MediaSource[] = [
  { host: "open.spotify.com", kind: "audio", on: true },
  { host: "music.apple.com", kind: "audio", on: true },
  { host: "soundcloud.com", kind: "audio", on: true },
  { host: "bandcamp.com", kind: "audio", on: true },
  { host: "youtube.com", kind: "video", on: true },
  { host: "youtu.be", kind: "video", on: true },
  { host: "vimeo.com", kind: "video", on: true },
];

/** The card size of a media item: room for the cover, the name, and the artist. */
const MEDIA_SIZE = { w: 200, h: 250 } as const;

/** A host as the user typed it: "https://www.YouTube.com/x" → "youtube.com". Null if it is not a host. */
export function normalizeHost(text: string): string | null {
  let value = text.trim().toLowerCase();
  if (value === "") return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(value)) value = `https://${value}`;
  try {
    const host = new URL(value).hostname.replace(/^www\./, "");
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
  } catch {
    return null;
  }
}

/** The kind of a media link, or null if the link is not from a source that is on (or not an http(s) address). */
export function mediaKindOf(url: string, sources: readonly MediaSource[]): MediaKind | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const source = sources.find((entry) => entry.on && (host === entry.host || host.endsWith(`.${entry.host}`)));
  return source?.kind ?? null;
}

/** A new media item on a board (a note card with media). One command. */
export function createMediaItem(
  context: ActionContext,
  input: { boardId: Id; x: number; y: number; kind: MediaKind; url?: string; file?: string; name?: string },
): { command: Command; itemId: Id; placeId: Id } {
  const media = cleanMedia({ kind: input.kind, url: input.url, file: input.file });
  const created = createItemOnBoard(context, { boardId: input.boardId, view: "note", x: input.x, y: input.y, name: input.name, media, size: MEDIA_SIZE });
  return { ...created, command: { ...created.command, label: input.kind === "image" ? "Create picture" : "Create media item" } };
}

/**
 * Changes the media of an item (`null`: the item is not a media item any more; its card is a note again).
 * Empty texts are removed. One command.
 */
export function setMedia(context: ActionContext, itemId: Id, media: MediaInfo | null, label = "Change media"): Command {
  const before = context.store.get("items", itemId);
  if (before === undefined) return emptyCommand(label);
  const after: ItemRecord = { ...before, modified: context.now() };
  if (media === null) delete after.media;
  else after.media = cleanMedia(media);
  if (JSON.stringify(before.media ?? null) === JSON.stringify(after.media ?? null)) return emptyCommand(label);
  return { label, ops: [makeOp("items", itemId, before, after)] };
}

function cleanMedia(media: MediaInfo): MediaInfo {
  const out: MediaInfo = { kind: media.kind };
  for (const key of ["url", "file", "artist", "cover"] as const) {
    const value = media[key]?.trim();
    if (value !== undefined && value !== "") out[key] = value;
  }
  if (media.duration !== undefined && Number.isFinite(media.duration) && media.duration >= 0) out.duration = Math.round(media.duration);
  return out;
}

/** A picture item with no picture yet: the chosen image becomes its picture (`file`), not its cover. */
export function needsPicture(media: MediaInfo): boolean {
  return media.kind === "image" && media.file === undefined;
}

/** "3:05", "1:02:03" (a duration in seconds). */
export function durationLabel(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** What a "media-info" plugin found for a link. `cover`: the vault path where the app saved the cover. */
type FoundMedia = { title?: string; artist?: string; kind?: MediaKind; duration?: number; cover?: string };

/**
 * Puts what a plugin found into a media item. One command ("Get title and cover"). The name and the artist change
 * only if they are empty (or the name is the link): the user's own words stay. The cover and the length change.
 */
export function applyFoundMedia(context: ActionContext, itemId: Id, found: FoundMedia): Command {
  const label = "Get title and cover";
  const before = context.store.get("items", itemId);
  if (before?.media === undefined) return emptyCommand(label);
  const media: MediaInfo = { ...before.media };
  if (found.kind !== undefined && media.kind !== "image") media.kind = found.kind;
  if ((media.artist ?? "") === "" && (found.artist ?? "").trim() !== "") media.artist = found.artist!.trim();
  if (found.cover !== undefined) media.cover = found.cover;
  if (found.duration !== undefined) media.duration = found.duration;
  let after: ItemRecord = { ...before, media: cleanMedia(media), modified: context.now() };
  const title = (found.title ?? "").trim();
  if (title !== "" && (before.name.trim() === "" || before.name.trim() === media.url)) after = { ...after, name: title };
  if (after.name !== before.name) delete after.codeName;
  if (JSON.stringify({ ...before, modified: undefined }) === JSON.stringify({ ...after, modified: undefined })) return emptyCommand(label);
  return { label, ops: [makeOp("items", itemId, before, after)] };
}
