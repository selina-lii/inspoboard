// Images of the vault for views (board backgrounds, images in texts). Each image loads one time per session.
// The image bytes come from the backend. The view gets a blob URL.

import { useEffect, useState } from "react";
import type { Session } from "../../io/session";
import { isColor } from "../../core/validate";

const cache = new WeakMap<Session, Map<string, Promise<string>>>();

/** A blob URL for an image of the vault. It loads one time per session. */
export function urlOf(session: Session, path: string): Promise<string> {
  let images = cache.get(session);
  if (images === undefined) {
    images = new Map();
    cache.set(session, images);
  }
  let url = images.get(path);
  if (url === undefined) {
    url = session.readImage(path).then((bytes) => URL.createObjectURL(new Blob([bytes])));
    // A failed load can be tried again later (for example, after the file comes back).
    url.catch(() => images!.delete(path));
    images.set(path, url);
  }
  return url;
}

/**
 * A board background: a color, or an image with its URL and its shape (height / width). Null: no background, or the
 * image is not loaded yet. An image lies on the board (board coordinates: see backgroundBox in core/actions.ts).
 */
export type BoardBackground = { kind: "color"; color: string } | { kind: "image"; url: string; aspect: number };

export function useBoardBackground(session: Session, value: string | null): BoardBackground | null {
  const [image, setImage] = useState<{ url: string; aspect: number } | null>(null);
  const path = value !== null && !isColor(value) ? value : null;
  useEffect(() => {
    setImage(null);
    if (path === null) return;
    let active = true;
    urlOf(session, path).then(
      (url) => {
        const element = new Image();
        element.onload = () => active && setImage({ url, aspect: element.naturalHeight / Math.max(1, element.naturalWidth) });
        element.src = url;
      },
      () => active && setImage(null),
    );
    return () => {
      active = false;
    };
  }, [session, path]);
  if (value === null) return null;
  if (isColor(value)) return { kind: "color", color: value };
  return image === null ? null : { kind: "image", ...image };
}

/** Dark or light text for a background color, so that the text stays readable. */
export function textColorOn(color: string): string {
  const value = Number.parseInt(color.slice(1), 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  return luminance > 0.35 ? "#1c1c1e" : "#ffffff";
}

/** The blob URL of a vault image, or null (no path, or not loaded yet, or it failed). */
export function useVaultImageUrl(session: Session, path: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (path === null) return;
    let active = true;
    urlOf(session, path).then(
      (value) => active && setUrl(value),
      () => active && setUrl(null),
    );
    return () => {
      active = false;
    };
  }, [session, path]);
  return url;
}
