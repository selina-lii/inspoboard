// Keyboard helpers that work with all keyboard layouts and input methods.

type KeyEventLike = { key: string; code: string; keyCode?: number; isComposing?: boolean; nativeEvent?: { isComposing?: boolean } };

/**
 * True while an input method (IME) composes text, for example Chinese, Japanese, or Korean.
 * Then Enter and Escape belong to the input method, not to the app.
 * WebKit sends keyCode 229 for the key that ends a composition.
 */
export function isComposing(event: KeyEventLike): boolean {
  return event.isComposing === true || event.nativeEvent?.isComposing === true || event.keyCode === 229;
}

const CODE_NAMES: Record<string, string> = { Equal: "=", Minus: "-", Slash: "/", Period: ".", Comma: "," };

/**
 * The key for a shortcut, in lower case. Shortcuts always use the English (US) key positions,
 * on every keyboard layout and with every input method. Thus Cmd+Z is the key at the US "Z"
 * position, also with a Russian, Greek, or Chinese input. Named keys (Escape, Enter) stay as they are.
 */
export function shortcutKey(event: KeyEventLike): string {
  if (event.code.startsWith("Key")) return event.code.slice(3).toLowerCase();
  if (event.code.startsWith("Digit")) return event.code.slice(5);
  const named = CODE_NAMES[event.code];
  if (named !== undefined) return named;
  return event.key.toLowerCase();
}

/**
 * macOS: Ctrl+click is a right-click (a `contextmenu` event, and no `click`). A `contextmenu` listener calls this: a
 * Ctrl+click on a link becomes a ⌘-click at the same place (a new `click` event), and the menu does not open. Returns
 * true if it did.
 */
export function ctrlClickAsCommandClick(event: MouseEvent): boolean {
  if (!event.ctrlKey || event.metaKey || !(event.target instanceof Node)) return false;
  // Only on a link: elsewhere Ctrl+click stays the right-click of macOS (its menu).
  const element = event.target.nodeType === Node.ELEMENT_NODE ? (event.target as Element) : event.target.parentElement;
  if (element?.closest("a[href]") == null) return false;
  event.preventDefault();
  event.stopPropagation();
  const view = event.target.ownerDocument?.defaultView ?? window;
  event.target.dispatchEvent(new view.MouseEvent("click", { bubbles: true, cancelable: true, clientX: event.clientX, clientY: event.clientY, screenX: event.screenX, screenY: event.screenY, metaKey: true, view }));
  return true;
}
