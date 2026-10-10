// Small DOM helpers shared by views.

/** True if keys typed at the target go into a text field or the editor. */
export function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.closest(".cm-editor") !== null;
}
