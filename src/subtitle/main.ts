// The floating subtitle window (see src-tauri/src/subtitle.rs). It shows one sentence in large text, and can show
// its translation under it (after the separator U+001E).
// A drag moves the window. The window height follows the text. The user can change the width at the edges.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";

const frame = document.getElementById("subtitle")!;
const text = document.getElementById("subtitle-text")!;
const close = document.getElementById("subtitle-close")!;
const appWindow = getCurrentWindow();
/** Space around the box (the shadow), in CSS pixels. */
const MARGIN = 16;

/** Between the sentence and its translation (the second line, smaller). */
const SECOND = "\u001e";

function show(value: string): void {
  const [first = "", second] = value.split(SECOND);
  text.textContent = first;
  if (second !== undefined && second !== "") {
    const line = document.createElement("span");
    line.className = "subtitle-second";
    line.textContent = second;
    text.appendChild(line);
  }
  fit();
}

/** Makes the window as high as the text. */
function fit(): void {
  const height = Math.ceil(frame.getBoundingClientRect().height) + MARGIN;
  if (Math.abs(height - window.innerHeight) > 2) void appWindow.setSize(new LogicalSize(window.innerWidth, height));
}

frame.addEventListener("mousedown", (event) => {
  if (event.button === 0 && event.target !== close) void appWindow.startDragging();
});
close.addEventListener("click", () => void invoke("subtitle_dismiss"));
window.addEventListener("resize", fit);

void invoke<string>("subtitle_text").then(show);
void listen<string>("subtitle-text", (event) => show(event.payload));
