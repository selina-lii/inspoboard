// Light and dark mode. See docs/SPEC.md section 7.10.
// - The setting "theme": "system" (as macOS), "dark", or "light". Default: dark.
// - The app sets data-theme="light" or "dark" on the root element. The color tokens are in src/ui/theme/theme.css.
// - The sun/moon button in the top bar changes between light and dark.

import { Moon, Sun } from "lucide-react";
import { useEffect, useLayoutEffect, useState } from "react";
import type { ThemeSetting } from "../../io/settings";
import { useSession, useSessionState } from "./sessionContext";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function systemTheme(): "light" | "dark" {
  return window.matchMedia?.(DARK_QUERY).matches === false ? "light" : "dark";
}

/** The theme that shows: light or dark. "system" follows macOS and changes with it. */
export function useShownTheme(setting: ThemeSetting): "light" | "dark" {
  const [system, setSystem] = useState(systemTheme);
  useEffect(() => {
    const query = window.matchMedia?.(DARK_QUERY);
    if (query === undefined) return;
    const onChange = () => setSystem(systemTheme());
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return setting === "system" ? system : setting;
}

/** Puts the theme on the root element. */
export function useApplyTheme(): "light" | "dark" {
  const { settings } = useSessionState();
  const shown = useShownTheme(settings.theme);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = shown;
  }, [shown]);
  // The weight of the UI font (Settings → UI font weight).
  const weight = settings.uiFontWeight;
  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--ui-weight", String(weight));
  }, [weight]);
  return shown;
}

/** The top bar button: light ↔ dark. */
export function ThemeButton() {
  const session = useSession();
  const { settings } = useSessionState();
  const shown = useShownTheme(settings.theme);
  const next = shown === "dark" ? "light" : "dark";
  return (
    <button className="icon-button" data-tip={next === "light" ? "Light mode" : "Dark mode"} onClick={() => void session.updateSettings({ theme: next })}>
      {shown === "dark" ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
