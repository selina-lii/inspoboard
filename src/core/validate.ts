// Schema checks and reference checks. See docs/SPEC.md section 4.3.
// These functions only report. They never change data.

import { isId } from "./ids";
import type { GraphIndex } from "./graph";
import type { Problem } from "./problems";
import type { Store } from "./store";
import { GROUP_SHAPES, LINK_CAPS, LIST_STYLES, SMALL_VIEWS, VIEW_STYLES, type Id, type TableName, QUOTE_MARKS } from "./types";

/** Returns a list of schema errors. An empty list means the record is valid. */
export function schemaErrors(table: TableName, value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return ["The record is not an object."];
  const record = value as Record<string, unknown>;
  const errors: string[] = [];
  const need = (field: string, test: (v: unknown) => boolean, description: string): void => {
    if (!test(record[field])) errors.push(`Field "${field}" must be ${description}.`);
  };
  const allow = (field: string, test: (v: unknown) => boolean, description: string): void => {
    if (record[field] !== undefined && !test(record[field])) errors.push(`Field "${field}" must be ${description}.`);
  };

  need("id", isId, "a 12-character ID");
  switch (table) {
    case "items":
      need("name", isString, "a string");
      need("created", isString, "an ISO 8601 string");
      allow("modified", isString, "an ISO 8601 string");
      allow("date", isString, "a string");
      allow("board", (v) => v === true, "true");
      allow("codeName", (v) => v === true, "true");
      allow("list", (v) => LIST_STYLES.includes(v as never), `one of ${LIST_STYLES.join(", ")}`);
      allow("background", isBackground, 'a color "#rrggbb" or an image path "images/<name>"');
      allow("backgroundWidth", (v) => isFiniteNumber(v) && (v as number) > 0, "a number above 0");
      allow("backgroundFixed", (v) => v === true, "true");
      allow("backgroundCenter", (v) => Array.isArray(v) && v.length === 2 && v.every(isFiniteNumber), "a list of two numbers");
      allow("url", isString, "a string");
      allow("author", isString, "a string");
      allow("on", isId, "an ID");
      allow("quote", isNonEmptyString, "a non-empty string");
      allow("resolved", (v) => v === true, "true");
      allow("pageAt", (v) => Array.isArray(v) && v.length === 2 && v.every(isFiniteNumber), "a list of two numbers");
      allow("trashed", isString, "an ISO 8601 string");
      allow("trashedFrom", isTrashedFrom, "an object {board, x, y, w, h, view}");
      break;
    case "texts":
      need("body", isString, "a string");
      break;
    case "outlines":
      need("board", isId, "an ID");
      need("x", isFiniteNumber, "a number");
      need("y", isFiniteNumber, "a number");
      allow("list", (v) => LIST_STYLES.includes(v as never), `one of ${LIST_STYLES.join(", ")}`);
      allow("direction", (v) => v === "horizontal", '"horizontal"');
      allow("type", (v) => v === "calendar", '"calendar"');
      allow("name", isString, "a string");
      allow("start", isMonth, 'a month "YYYY-MM"');
      allow("end", isMonth, 'a month "YYYY-MM"');
      break;
    case "stamps":
      need("alt", isNonEmptyString, "a non-empty string");
      need("w", isFiniteNumber, "a number");
      need("h", isFiniteNumber, "a number");
      need("path", isStampPath, "an SVG path (commands and numbers only)");
      break;
    case "links":
      need("from", isId, "an ID");
      need("to", isId, "an ID");
      if (record.kind === "place") {
        for (const field of ["x", "y", "w", "h"]) need(field, isFiniteNumber, "a number");
        need("view", (v) => VIEW_STYLES.includes(v as never), `one of ${VIEW_STYLES.join(", ")}`);
        allow("p3", isPoint3, "a list of three numbers");
        allow("expanded", (v) => typeof v === "boolean", "true or false");
        allow("rank", (v) => Number.isInteger(v) && (v as number) >= 0, "a whole number, 0 or more");
        allow("outline", isId, "an ID");
        allow("parent", isId, "an ID");
        allow("ref", (v) => v === true, "true");
        allow("color", isColor, 'a color "#rrggbb"');
        allow("day", isDay, 'a day "YYYY-MM-DD"');
        allow("until", isDay, 'a day "YYYY-MM-DD"');
        allow("time", isTime, 'a time "HH:MM" or "HH:MM–HH:MM"');
        allow("marks", (v) => QUOTE_MARKS.includes(v as never), `one of ${QUOTE_MARKS.join(", ")}`);
        allow("shape", (v) => GROUP_SHAPES.includes(v as never), `one of ${GROUP_SHAPES.join(", ")}`);
        allow("shapePath", isStampPath, "an SVG path (commands and numbers only)");
        allow("filled", (v) => v === true, "true");
        if (record.until !== undefined && (typeof record.day !== "string" || (record.until as string) <= record.day)) errors.push(`Field "until" must be a day after "day".`);
        if (record.until !== undefined && record.time !== undefined) errors.push(`A card with "until" (more than one day) cannot have "time".`);
      } else if (record.kind === "link") {
        allow("label", isString, "a string");
        allow("group", isString, "a string");
        allow("start", (v) => LINK_CAPS.includes(v as never), `one of ${LINK_CAPS.join(", ")}`);
        allow("end", (v) => LINK_CAPS.includes(v as never), `one of ${LINK_CAPS.join(", ")}`);
        allow("quote", isNonEmptyString, "a non-empty string");
        allow("fromQuote", isNonEmptyString, "a non-empty string");
      } else if (record.kind === "inside") {
        need("view", (v) => SMALL_VIEWS.includes(v as never), `one of ${SMALL_VIEWS.join(", ")}`);
        allow("x", isFiniteNumber, "a number");
        allow("y", isFiniteNumber, "a number");
        if ((record.x === undefined) !== (record.y === undefined)) errors.push(`Fields "x" and "y" must both be there, or both be missing.`);
        allow("w", (v) => isFiniteNumber(v) && (v as number) > 0, "a number above 0");
        allow("h", (v) => isFiniteNumber(v) && (v as number) > 0, "a number above 0");
        allow("color", isColor, 'a color "#rrggbb"');
        allow("expanded", (v) => typeof v === "boolean", "true or false");
        allow("quote", isNonEmptyString, "a non-empty string");
        allow("at", (v) => Number.isInteger(v) && (v as number) >= 0, "a whole number, 0 or more");
        if (record.at !== undefined && record.quote === undefined) errors.push(`Field "at" needs "quote".`);
      } else {
        errors.push(`Field "kind" must be "place", "link", or "inside".`);
      }
      break;
  }
  return errors;
}

/** Checks the references between records. */
export function referenceProblems(store: Store, graph: GraphIndex, rootId: Id): Problem[] {
  const problems: Problem[] = [];
  if (!store.has("items", rootId)) {
    problems.push({ severity: "error", code: "root-missing", message: `The root item "${rootId}" does not exist.` });
  }
  for (const link of store.all("links")) {
    if (store.has("stamps", link.from)) {
      problems.push({
        severity: "warning",
        code: "link-from-stamp",
        message: `Link "${link.id}" starts at a stamp. Only items can be boards or link sources.`,
        recordId: link.id,
      });
    }
    if (link.kind === "inside" && (store.has("stamps", link.to) || store.has("stamps", link.from))) {
      problems.push({
        severity: "warning",
        code: "inside-stamp",
        message: `Link "${link.id}" puts a stamp inside an item, or an item inside a stamp. Only items can be inside items.`,
        recordId: link.id,
      });
    }
    if (link.kind === "link" && store.has("stamps", link.to)) {
      problems.push({
        severity: "warning",
        code: "relation-to-stamp",
        message: `Link "${link.id}" points to a stamp. Relations connect items only.`,
        recordId: link.id,
      });
    }
  }
  for (const text of store.all("texts")) {
    if (!store.has("items", text.id)) {
      problems.push({
        severity: "warning",
        code: "text-without-item",
        message: `Text file for "${text.id}" has no item record. The app keeps the file.`,
        recordId: text.id,
      });
    }
  }
  for (const ghostId of graph.ghosts()) {
    problems.push({
      severity: "warning",
      code: "ghost",
      message: `ID "${ghostId}" has links but no record. It shows as a ghost node.`,
      recordId: ghostId,
    });
  }
  return problems;
}

/** A color "#rrggbb". */
export function isColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

/** A color, or an image in the images folder of the vault. */
export function isBackground(value: unknown): value is string {
  return isColor(value) || (typeof value === "string" && /^images\/[A-Za-z0-9_.-]+\.(png|jpe?g|gif|webp)$/i.test(value) && !value.includes(".."));
}

/** A month "YYYY-MM". */
export function isMonth(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** A time "HH:MM", or a start and an end "HH:MM–HH:MM" (an en dash or a hyphen). */
export function isTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d([–-]([01]\d|2[0-3]):[0-5]\d)?$/.test(value);
}

/** A day "YYYY-MM-DD". */
export function isDay(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPoint3(value: unknown): boolean {
  return Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber);
}

const STAMP_PATH = /^[MmLlHhVvCcSsQqTtZz0-9 .,-]*$/;

function isStampPath(value: unknown): boolean {
  return typeof value === "string" && STAMP_PATH.test(value);
}

function isTrashedFrom(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const from = value as Record<string, unknown>;
  return isId(from.board) && ["x", "y", "w", "h"].every((key) => isFiniteNumber(from[key])) && VIEW_STYLES.includes(from.view as never);
}
