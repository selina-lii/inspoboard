// ID generation. This is the only module that imports nanoid.

import { customAlphabet } from "nanoid";
import type { Id } from "./types";

export const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
export const ID_LENGTH = 12;
export const ID_PATTERN = /^[0-9a-z]{12}$/;

export type IdSource = () => Id;

export const newId: IdSource = customAlphabet(ID_ALPHABET, ID_LENGTH);

export function isId(value: unknown): value is Id {
  return typeof value === "string" && ID_PATTERN.test(value);
}
