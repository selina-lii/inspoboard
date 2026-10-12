// Finds the English UI text in the source code, for the language packs (src/ui/i18n/<language>.json).
// See docs/SPEC.md section 7.9.
// - Text: JSX text, UI attributes (tooltips, placeholders, labels), UI fields of objects (label, title, tip, …),
//   and the first argument of t(), translate(), confirm(), alert().
// - A template literal gives a key with places: `Open ${name}` → "Open {0}".
// - "split": a JSX element with text and values side by side (<b>Link “{name}”: click…</b>). React makes separate
//   text nodes, so the screen text has no full sentence to translate. Write it as one template literal.
// Use: node scripts/i18n/extract.mjs [pack]   (lists the texts that the pack does not have; default: all packs)

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSync } from "rolldown/experimental";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Strings in the code that look like text but never show in the UI (scripts/i18n/not-ui.json). */
const NOT_UI = new Set(JSON.parse(readFileSync(join(ROOT, "scripts/i18n/not-ui.json"), "utf8")).strings);

/** Folders with UI code. src/core and src/io have command names (undo), messages, and problems that the UI shows. */
const SOURCES = ["src/ui", "src/core", "src/io"];
/** Files that are not UI text. */
const SKIP_FILES = [/\/i18n\//, /\.test\./];

/** JSX attributes with UI text. */
const UI_ATTRIBUTES = new Set(["data-tip", "placeholder", "aria-label", "title", "label", "tip", "emptyText", "alt", "hint", "description"]);
/** Object fields with UI text. */
const UI_FIELDS = new Set(["label", "title", "tip", "help", "message", "emptyText", "placeholder", "description", "hint", "unit", "example", "short", "name"]);
/** Calls whose first argument is UI text. */
const UI_CALLS = new Set(["t", "words", "translate", "confirm", "alert", "notify", "warn", "showMessage", "setMessage", "setStatus", "setError", "setNotice", "toast"]);
/** Object fields that hold no UI text, also in a UI object (ids, keys, CSS). */
const NAME_FIELD_OWNERS_SKIP = /^(id|key|className|kind|type|view|icon)$/;

/** Calls and members whose string arguments are never UI text (DOM queries, events, storage keys, IPC). */
const CODE_CALLS = new Set(["querySelector", "querySelectorAll", "closest", "matches", "addEventListener", "removeEventListener", "getItem", "setItem", "removeItem", "invoke", "listen", "emit", "log", "debug", "info", "error", "warn", "getPropertyValue", "setProperty", "createElement", "getAttribute", "setAttribute", "removeAttribute", "hasAttribute", "toggle", "add", "remove", "contains", "getChild", "getChildren", "require", "Error", "TypeError", "RangeError", "plugin_call", "call", "startsWith", "endsWith", "includes", "indexOf", "split", "replace", "replaceAll", "join", "padStart", "test", "match", "matchMedia", "keymap", "of", "has", "get", "set", "delete", "dispatchEvent", "Event", "CustomEvent", "KeyboardEvent", "RegExp", "fetch", "URL", "Blob", "File", "Intl", "toLocaleString", "toLocaleDateString", "toLocaleTimeString", "localeCompare", "execCommand", "postMessage"]);
/** JSX attributes that never hold UI text. */
const CODE_ATTRIBUTES = new Set(["className", "dir", "role", "type", "key", "translate", "d", "viewBox", "fill", "stroke", "transform", "style", "target", "sandbox", "inputMode", "side", "color", "value", "titleClassName", "lineClassName", "handleClassName", "id", "name", "href", "src", "rel", "lang", "accept", "autoComplete", "spellCheck", "preserveAspectRatio", "vectorEffect", "strokeLinecap", "strokeLinejoin", "fillRule", "clipRule", "position", "layoutKey", "resetKey", "data-theme", "method", "htmlFor", "pattern"]);
/** Object fields that never hold UI text. */
const CODE_FIELDS = /^(id|key|className|class|kind|type|view|icon|table|field|method|event|mode|lang|language|font|fontFamily|cursor|display|position|background|backgroundImage|color|border|transform|transition|gridTemplateColumns|gridAutoRows|flexBasis|padding|paddingLeft|left|top|width|height|path|url|file|exec|shortcut|key|code|tool|menu|plugin|role|selector|prefix|suffix|format|variant|voice|model|engine|pack|status|state|side|start|end|align|direction|marks|cap|tag|root|to|from|keys|preventDefault|run|scope|data-tip-start|\$schema)$/;

/** True for prose: English text that a person reads (a sentence, a capitalized word), not code. */
export function isProse(text) {
  const core = text.replace(/\{\d\}/g, "").trim();
  if (!/[A-Za-z]{2}/.test(core)) return false;
  if (/[{};]\s|=>|var\(--|rgba?\(|^\.?[a-z][\w-]*(\s+\.?[a-z][\w-]*)*$|^[\w-]+:[\w-]+$|^(Mod|Ctrl|Alt|Shift|Meta|Cmd)-|^[A-Z][a-z]+[A-Z]\w*$|^\(\?|\\[dswbp]|\[\^|^[A-Z_]+$|^@|^\w+\/\w+/.test(core)) return false;
  return /^[A-Z][a-z]/.test(core) || /[a-z]{2,}[ ,:]+[a-z]{2,}/.test(core) || /^\p{L}/u.test(core) && /\s/.test(core);
}

/** True for text that a person reads: it has a letter, and it is not a CSS class list, a path, or a code. */
export function isUiText(text) {
  const core = text.replace(/\{\d\}/g, "").trim();
  if (!/\p{L}/u.test(core)) return false;
  if (/^[a-z0-9_-]+(\s+[a-z0-9_-]+)*$/.test(core) && !/\s/.test(core) && core === core.toLowerCase() && core.length < 3) return false;
  if (/^(https?:|\.{0,2}\/|#[0-9a-f]{3,8}$|[a-z]+:\/\/)/i.test(core)) return false;
  return true;
}

function templateKey(node) {
  let index = 0;
  let key = "";
  node.quasis.forEach((quasi, at) => {
    key += quasi.value.cooked ?? quasi.value.raw;
    if (at < node.expressions.length) key += `{${index++}}`;
  });
  return key;
}

/** The UI texts of an expression: strings and template literals, also in both branches of a condition. */
function textsOf(node, out) {
  if (node === null || node === undefined) return;
  switch (node.type) {
    case "Literal":
      if (typeof node.value === "string") out.push({ text: node.value, node });
      return;
    case "TemplateLiteral":
      if (node.quasis.some((quasi) => (quasi.value.cooked ?? "").trim() !== "")) out.push({ text: templateKey(node), node });
      return;
    case "ConditionalExpression":
      textsOf(node.consequent, out);
      textsOf(node.alternate, out);
      return;
    case "LogicalExpression":
      textsOf(node.right, out);
      if (node.operator === "??" || node.operator === "||") textsOf(node.left, out);
      return;
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "ParenthesizedExpression":
      textsOf(node.expression, out);
      return;
    case "CallExpression":
      if (calleeName(node) === "t") textsOf(node.arguments[0], out);
      return;
    default:
  }
}

function calleeName(call) {
  const callee = call.callee;
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression" && callee.property.type === "Identifier") return callee.property.name;
  return null;
}

function attributeName(attribute) {
  const name = attribute.name;
  return name.type === "JSXNamespacedName" ? `${name.namespace.name}:${name.name.name}` : name.name;
}

function lineOf(source, offset) {
  let line = 1;
  for (let at = 0; at < offset && at < source.length; at += 1) if (source.charCodeAt(at) === 10) line += 1;
  return line;
}

/** True if a JSX element is marked translate="no" (its text is user text or a fixed name). */
function isNoTranslate(element) {
  return element.openingElement?.attributes?.some(
    (attribute) => attribute.type === "JSXAttribute" && attributeName(attribute) === "translate" && attribute.value?.type === "Literal" && attribute.value.value === "no",
  );
}

/** The UI texts of one source file. */
export function extractFile(path, source) {
  /** In src/core and src/io, only prose counts (command names, messages). */
  const core = !path.startsWith("src/ui/");
  const found = [];
  const split = [];
  const { program } = parseSync(path, source, { lang: path.endsWith(".tsx") ? "tsx" : "ts" });
  const add = (text, node, kind) => {
    const key = kind === "jsx" ? text.replace(/\s+/g, " ").trim() : text;
    if (isUiText(key) && !NOT_UI.has(key)) found.push({ key, file: path, line: lineOf(source, node.start), kind });
  };
  const walk = (node, noTranslate) => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, noTranslate);
      return;
    }
    switch (node.type) {
      case "JSXElement":
      case "JSXFragment": {
        const off = noTranslate || (node.type === "JSXElement" && isNoTranslate(node));
        // Text and values side by side: React makes separate text nodes.
        const texts = node.children.filter((child) => child.type === "JSXText" && child.value.trim() !== "" && /\p{L}/u.test(child.value));
        const values = node.children.filter((child) => child.type === "JSXExpressionContainer" && child.expression.type !== "JSXEmptyExpression" && !isElementish(child.expression));
        // Text on both sides of an element (<b>The folder <code>…</code> is not…</b>) is split too.
        if (!off && (texts.length > 0 && values.length > 0 || texts.length > 1))
          split.push({ key: node.children.map((child) => (child.type === "JSXText" ? child.value : child.type === "JSXExpressionContainer" ? "{…}" : "<…>")).join("").replace(/\s+/g, " ").trim(), file: path, line: lineOf(source, node.start) });
        if (node.type === "JSXElement") walk(node.openingElement, off);
        for (const child of node.children) {
          if (child.type === "JSXText") {
            if (!off) add(child.value, child, "jsx");
          } else if (child.type === "JSXExpressionContainer") {
            if (!off) {
              const out = [];
              textsOf(child.expression, out);
              for (const { text, node: at } of out) add(text, at, "jsx");
            }
            walk(child.expression, off);
          } else walk(child, off);
        }
        return;
      }
      case "JSXAttribute": {
        const name = attributeName(node);
        if (CODE_ATTRIBUTES.has(name)) {
          if (node.value?.type === "JSXExpressionContainer" && node.value.expression.type !== "Literal" && node.value.expression.type !== "TemplateLiteral") walk(node.value.expression, noTranslate);
          return;
        }
        if (!noTranslate && UI_ATTRIBUTES.has(name) && node.value !== null) {
          const value = node.value.type === "JSXExpressionContainer" ? node.value.expression : node.value;
          const out = [];
          textsOf(value, out);
          for (const { text, node: at } of out) add(text, at, "attribute");
        }
        walk(node.value, noTranslate);
        return;
      }
      case "Property": {
        const key = node.key?.type === "Identifier" ? node.key.name : typeof node.key?.value === "string" ? node.key.value : null;
        if (key !== null && CODE_FIELDS.test(key)) {
          // A code field: only its value can hold code (not UI text).
          if (node.value.type !== "Literal" && node.value.type !== "TemplateLiteral") walk(node.value, noTranslate);
          return;
        }
        if (key !== null && UI_FIELDS.has(key) && !NAME_FIELD_OWNERS_SKIP.test(key) && !core) {
          const out = [];
          textsOf(node.value, out);
          for (const { text, node: at } of out) add(text, at, "field");
        }
        // The key of a field is a name in code, not text.
        walk(node.value, noTranslate);
        return;
      }
      case "Literal":
        if (typeof node.value === "string" && isProse(node.value)) add(node.value, node, "prose");
        return;
      case "TemplateLiteral": {
        const key = templateKey(node);
        if (isProse(key)) add(key, node, "prose");
        break;
      }
      case "ImportDeclaration":
      case "ExportAllDeclaration":
      case "TSLiteralType":
      case "TSEnumDeclaration":
      case "ThrowStatement":
        return;
      case "ExportNamedDeclaration":
        if (node.source !== null && node.source !== undefined) return;
        break;
      case "BinaryExpression":
        // A comparison with a string: the string is a code value ("weblink"), not text.
        if (/^[=!]==?$/.test(node.operator)) return;
        break;
      case "SwitchCase":
        walk(node.consequent, noTranslate);
        return;
      case "NewExpression":
        if (node.callee.type === "Identifier" && CODE_CALLS.has(node.callee.name)) return;
        break;
      case "CallExpression": {
        const name = calleeName(node);
        if (name !== null && UI_CALLS.has(name) && node.arguments.length > 0) {
          const out = [];
          textsOf(node.arguments[0], out);
          for (const { text, node: at } of out) add(text, at, "call");
        }
        if (name !== null && CODE_CALLS.has(name)) {
          // Only the callee and non-string arguments can hold text (for example a callback).
          walk(node.callee, noTranslate);
          for (const argument of node.arguments) if (argument.type !== "Literal" && argument.type !== "TemplateLiteral") walk(argument, noTranslate);
          return;
        }
        break;
      }
      case "JSXAttribute_code":
        return;
      default:
    }
    for (const key in node) {
      if (key === "start" || key === "end" || key === "type") continue;
      const value = node[key];
      if (value !== null && typeof value === "object") walk(value, noTranslate);
    }
  };
  walk(program, false);
  return { found, split };
}

function isElementish(expression) {
  if (expression.type === "JSXElement" || expression.type === "JSXFragment") return true;
  if (expression.type === "LogicalExpression") return isElementish(expression.right);
  if (expression.type === "ConditionalExpression") return isElementish(expression.consequent) && isElementish(expression.alternate);
  return false;
}

function sourceFiles() {
  const files = [];
  const visit = (folder) => {
    for (const name of readdirSync(join(ROOT, folder))) {
      const path = `${folder}/${name}`;
      if (statSync(join(ROOT, path)).isDirectory()) visit(path);
      else if (/\.tsx?$/.test(name) && !SKIP_FILES.some((skip) => skip.test(path))) files.push(path);
    }
  };
  for (const folder of SOURCES) visit(folder);
  return files.sort();
}

/**
 * Rust folders whose text shows in the UI: the backend (messages, the menu bar) and the plugins (names, options,
 * progress, errors). Tests (after #[cfg(test)]) do not count.
 */
const RUST_SOURCES = ["src-tauri/src", "plugins/chinese/src", "plugins/translate/src", "plugins/voice/src", "plugins/web/src"];
/** JavaScript plugins (names, options, errors). */
const PLUGIN_JS_SOURCES = ["plugins/math/src"];

/** The UI texts of a Rust file: prose string literals. Format places ("{}", "{name}", "{:?}") become "{0}", "{1}", …. */
export function extractRust(path, source) {
  const end = source.indexOf("#[cfg(test)]");
  const code = end === -1 ? source : source.slice(0, end);
  const found = [];
  const literal = /(?<![A-Za-z0-9_#])"((?:[^"\\]|\\.)*)"/g;
  for (const line of code.split("\n").entries()) {
    const [index, text] = line;
    const trimmed = text.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("#[") || /^\s*(use|mod|extern)\b/.test(text)) continue;
    // Log lines and panics are not UI text.
    if (/\b(eprintln|println|log::\w+|debug_assert\w*|assert\w*|unreachable|panic|expect|env::var|var_os)!?\(/.test(text) && !/format!/.test(text)) continue;
    for (const match of text.matchAll(literal)) {
      let value;
      try {
        value = JSON.parse(`"${match[1].replace(/\\'/g, "'")}"`);
      } catch {
        continue;
      }
      let place = 0;
      const key = value.replace(/\{\{/g, "\u0001").replace(/\}\}/g, "\u0002").replace(/\{[^{}]*\}/g, () => `{${place++}}`).replace(/\u0001/g, "{").replace(/\u0002/g, "}");
      if (isProse(key) && isUiText(key) && !NOT_UI.has(key)) found.push({ key, file: path, line: index + 1, kind: "rust" });
    }
  }
  return found;
}

function rustFiles() {
  const files = [];
  const visit = (folder) => {
    for (const name of readdirSync(join(ROOT, folder))) {
      const path = `${folder}/${name}`;
      if (statSync(join(ROOT, path)).isDirectory()) visit(path);
      else if (name.endsWith(".rs") && !/tests?\.rs$/.test(name)) files.push(path);
    }
  };
  for (const folder of RUST_SOURCES) visit(folder);
  return files.sort();
}

/** All UI texts of the app: one entry for each key (the first place it is used), and the split texts. */
export function extractAll() {
  const keys = new Map();
  const split = [];
  for (const file of sourceFiles()) {
    const result = extractFile(file, readFileSync(join(ROOT, file), "utf8"));
    for (const entry of result.found) if (!keys.has(entry.key)) keys.set(entry.key, entry);
    split.push(...result.split);
  }
  for (const folder of PLUGIN_JS_SOURCES) {
    for (const name of readdirSync(join(ROOT, folder)).filter((entry) => entry.endsWith(".mjs")).sort()) {
      const file = `${folder}/${name}`;
      for (const entry of extractFile(file, readFileSync(join(ROOT, file), "utf8")).found) if (!keys.has(entry.key)) keys.set(entry.key, entry);
    }
  }
  for (const file of rustFiles()) {
    for (const entry of extractRust(file, readFileSync(join(ROOT, file), "utf8"))) if (!keys.has(entry.key)) keys.set(entry.key, entry);
  }
  // The menu bar items that the app does not write itself (macOS default menu, from Tauri).
  for (const key of SYSTEM_MENU) if (!keys.has(key)) keys.set(key, { key, file: "src-tauri/src/lib.rs", line: 1, kind: "menu" });
  return { keys: [...keys.values()], split };
}

/** The texts of the default menu bar (Tauri, macOS). The app name is a value. */
const SYSTEM_MENU = ["About {0}", "Hide {0}", "Quit {0}", "Hide Others", "Show All", "Services", "File", "Edit", "View", "Window", "Help", "Undo", "Redo", "Cut", "Copy", "Paste", "Select All", "Minimize", "Zoom", "Close Window", "Toggle Full Screen", "Bring All to Front"];

/** The language packs: file name (without .json) → texts. */
export function readPacks() {
  const folder = join(ROOT, "src/ui/i18n");
  return Object.fromEntries(
    readdirSync(folder)
      .filter((name) => name.endsWith(".json"))
      .map((name) => [name.slice(0, -5), JSON.parse(readFileSync(join(folder, name), "utf8"))]),
  );
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { keys, split } = extractAll();
  const packs = readPacks();
  const wanted = process.argv[2];
  for (const [name, pack] of Object.entries(packs)) {
    if (wanted !== undefined && wanted !== name) continue;
    const missing = keys.filter((entry) => pack[entry.key] === undefined);
    console.log(`# ${name}: ${missing.length} of ${keys.length} texts missing`);
    for (const entry of missing) console.log(`${relative(ROOT, join(ROOT, entry.file))}:${entry.line}\t${JSON.stringify(entry.key)}`);
  }
  console.log(`# split texts: ${split.length}`);
  for (const entry of split) console.log(`${entry.file}:${entry.line}\t${entry.key}`);
}
