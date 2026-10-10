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
