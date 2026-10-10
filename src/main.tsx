import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { tauriBackend, tauriPlugins } from "./io/backend";
import { App } from "./ui/app/App";
import "./ui/theme/theme.css";
import "./ui/app/layout.css";

// Release builds: no browser menu (with "Inspect Element") on a right-click. Text fields keep it (copy, paste).
// The app shows its own menus where it has them. Development builds keep the browser menu.
if (!import.meta.env.DEV) {
  window.addEventListener("contextmenu", (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, [contenteditable='true']") == null) event.preventDefault();
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App backend={tauriBackend} plugins={tauriPlugins} />
  </StrictMode>,
);
