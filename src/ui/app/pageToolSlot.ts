// The place in the main tool bar where an open text page shows its tools (highlight, pen, eraser, comments,
// notes, link). The page head then has room for the title. The board tools do not show while a page is open.

import { createContext, useContext } from "react";

export const PageToolSlotContext = createContext<HTMLElement | null>(null);

/** The tool bar element for the tools of the open page, or null (no page is open as the main view). */
export function usePageToolSlot(): HTMLElement | null {
  return useContext(PageToolSlotContext);
}
