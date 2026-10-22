// The right-click menus of a board (docs/SPEC.md section 7.1): the menu of the cards (one card, or the selected
// cards) and the menu of the empty canvas. BoardView.tsx gives them the board state they need (BoardMenuEnv).

import type { Session } from "../../io/session";
import type { Settings } from "../../io/settings";
import type { WorkspaceActions } from "../app/workspaceActions";
import type { Edge, ReactFlowInstance } from "@xyflow/react";
import {
  AudioLines,
  CalendarDays,
  CalendarRange,
  Check,
  FileDown,
  Globe,
  MessageSquarePlus,
  Pencil,
  Unlink,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Columns2,
  Columns3,
  Download,
  FolderUp,
  FolderInput,
  Home,
  ImageMinus,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  ListTree,
  LogOut,
  ArrowRight,
  ArrowLeft,
  Link2,
  Maximize2,
  Minimize2,
  PenLine,
  Rows3,
  ScrollText,
  StickyNote,
  Ungroup,
  Music,
  Image as ImageIcon,
  Shuffle,
} from "lucide-react";
import { createMediaItem } from "../../core/media";
import { type MouseEvent, type MutableRefObject } from "react";
import { attachItem, completeItems, setCardColor, TODO_COLORS, NOTE_GRAY, createOutlineWithPage, moveIntoBoard, releaseFromNote, setPlacementExpanded, setGroupFilled, setQuoteMarks, setPlacementRects } from "../../core/actions";
import type { Command } from "../../core/commands";
import { createOutline, indentRow, moveRow, moveRowToEnd, outdentRow, removeFromOutline, setOutlineDirection, setOutlineList } from "../../core/outline";
import { linksOf } from "../app/textLinks";
import { QUOTE_MARKS, type Id, type PlaceLink, type QuoteMarks, type ViewStyle } from "../../core/types";
import { addMonths, createCalendar, groupDocument, groupTitle, isCalendar, monthOf, setCalendarRange } from "../../core/groups";
import { fileNameOf } from "../plugins/exportOverlay";
import { isLocalPath, isPdfPath } from "../web/savedPages";
import { applyBackground, CARD_SWATCHES, chooseBackgroundImage } from "../app/ColorManager";
import { type MenuEntry, type MenuRequest } from "../app/ContextMenu";
import { OUTLINE_BAR, OUTLINE_PADDING } from "./boardModel";
import { QUOTE_GLYPHS } from "../app/smallFace";
import { isCollapsed, isNote, isQuote, type FlowNode, type InlineEdit } from "./nodes";
import { roundBoard } from "../../core/stamps";
import { t } from "../i18n/i18n";
import { SCRIBBLE_COLORS } from "./PenColors";
import { sendToBench } from "../app/LinkBench";
import { sendToCompareBench } from "../plugins/compare/CompareBench";
import { mapCardEntries, sourceEntries } from "../plugins/tray/trayMenus";
import { isRadial, RADIAL, setRadialRadius, spreadAgain } from "../../core/radial";
import { onePerPlace, mergeCommands, calendarExitPositions, isGroupFrame, isGroupShape } from "./flowAdapter";

/** The sizes of a radial (the radius of its ball, board units). */
const RADIAL_SIZES = [
  { radius: 180, text: "S", tip: "Small" },
  { radius: 260, text: "M", tip: "Medium" },
  { radius: 400, text: "L", tip: "Large" },
  { radius: 600, text: "XL", tip: "Very large" },
];

/** The board state that the menus use. */
export type BoardMenuEnv = {
  session: Session;
  settings: Settings;
  readOnly: boolean;
  runCommand(command: Command): boolean;
  actions: WorkspaceActions;
  flow: ReactFlowInstance<FlowNode, Edge>;
  boardId: Id;
  ownBackground: string | null;
  comparePlugin: boolean;
  pendingSelection: MutableRefObject<Set<string> | null>;
  heightOf(place: PlaceLink): number;
  createAt(view: ViewStyle, x: number, y: number, options?: { board?: boolean; on?: Id }): void;
  exportEntry(itemId: Id, label: string): MenuEntry;
  searchOnRightClick(event: MouseEvent | globalThis.MouseEvent): boolean;
  onOpenRecord(recordId: Id): void;
  onOpenDocument?: (outlineId: Id) => void;
  setMenu(menu: MenuRequest | null): void;
  setEditing(editing: { nodeId: string; edit: InlineEdit } | null): void;
  setScheduleFor(placeId: Id | null): void;
};

/** The right-click menu of a card, or of the selected cards (`clicked`: the card under the pointer, if any). */
export function openNodeMenuOf(env: BoardMenuEnv, event: MouseEvent, clicked: FlowNode | null): void {
  const { actions, boardId, comparePlugin, createAt, exportEntry, flow, heightOf, onOpenDocument, onOpenRecord, readOnly, runCommand, searchOnRightClick, session, setEditing, setMenu, setScheduleFor } = env;
    event.preventDefault();
    if (searchOnRightClick(event)) return;
    const selected = flow.getNodes().filter((node) => node.selected);
    const targets = clicked !== null && !selected.some((node) => node.id === clicked.id) ? [clicked] : selected;
    const cards = onePerPlace(targets.filter((node) => node.data.node.kind === "item" || node.data.node.kind === "stamp"));
    const placeIds = cards.flatMap((node) => (node.data.node.placeId === null ? [] : [node.data.node.placeId]));
    const single = cards.length === 1 ? cards[0]!.data.node : null;
    const entries: MenuEntry[] = [];
    // The menu of an outline frame.
    const groupFrame = clicked !== null && isGroupFrame(clicked.data.node) ? clicked : null;
    if (groupFrame !== null && groupFrame.data.node.outlineId !== null) {
      const groupId = groupFrame.data.node.outlineId;
      const group = session.store.get("outlines", groupId);
      if (group !== undefined) {
        entries.push({
          label: "Export as one document…",
          icon: <FileDown size={14} />,
          onSelect: () => void session.exportText(fileNameOf(groupTitle(group, t), ""), groupDocument(session.store, session.graph, groupId, t)).catch(() => undefined),
        });
        entries.push(exportEntry(boardId, "Export this whole board as a bundle…"));
        if (!readOnly) entries.push({ label: "Rename group", icon: <Pencil size={14} />, onSelect: () => setEditing({ nodeId: groupFrame.id, edit: "title" }) });
      }
      if (isRadial(group)) {
        if (!readOnly) {
          const radius = group!.radius ?? RADIAL.radius;
          entries.push(
            { kind: "separator" },
            { label: "Spread again", icon: <Shuffle size={14} />, onSelect: () => runCommand(spreadAgain(session.context, groupId)) },
            {
              kind: "choices",
              label: "Size",
              choices: RADIAL_SIZES.map((size) => ({ id: String(size.radius), text: size.text, tip: size.tip })),
              current: String(radius),
              onSelect: (id: string) => runCommand(setRadialRadius(session.context, groupId, Number(id))),
            },
            {
              label: "Take all cards out",
              icon: <Ungroup size={14} />,
              onSelect: () => {
                const shown = new Map<Id, { x: number; y: number }>();
                for (const node of flow.getNodes()) {
                  if (node.data.node.frameId !== groupFrame.id || node.data.node.placeId === null) continue;
                  shown.set(node.data.node.placeId, { x: Math.round(node.data.node.x), y: Math.round(node.data.node.y) });
                }
                runCommand(removeFromOutline(session.context, [...shown.keys()], heightOf, shown));
              },
            },
          );
          entries.push(...sourceEntries(env, groupId, { x: groupFrame.data.node.x + groupFrame.data.node.w + (group!.radius ?? RADIAL.radius) + 60, y: groupFrame.data.node.y }));
        }
        setMenu({ x: event.clientX, y: event.clientY, entries });
        return;
      }
      if (isCalendar(group)) {
        if (!readOnly) {
          entries.push(
            {
              label: "Months…",
              icon: <CalendarRange size={14} />,
              onSelect: async () => {
                const month = /^\d{4}-(0[1-9]|1[0-2])$/;
                const values = await actions.askFields({
                  title: "Months of the calendar",
                  submit: "Save",
                  fields: [
                    { key: "start", label: "First month", value: group!.start ?? monthOf(new Date().toISOString()), placeholder: "2026-01", pattern: month },
                    { key: "end", label: "Last month", value: group!.end ?? group!.start ?? "", placeholder: "2026-03", pattern: month, help: "Months as YYYY-MM, for example 2026-01 to 2026-03." },
                  ],
                });
                if (values !== null) runCommand(setCalendarRange(session.context, groupId, values.start!, values.end!));
              },
            },
            { kind: "separator" },
            {
              label: "New calendar next to this one",
              icon: <CalendarDays size={14} />,
              onSelect: () => {
                const month = monthOf(new Date().toISOString());
                runCommand(createCalendar(session.context, boardId, roundBoard(groupFrame.data.node.x + groupFrame.data.node.w + 60), roundBoard(groupFrame.data.node.y), month, addMonths(month, 2)).command);
              },
            },
            {
              label: "Take all cards out of the calendar",
              icon: <Ungroup size={14} />,
              onSelect: () => {
                const members = session.graph.membersOf(groupId).map((place) => place.id);
                runCommand(removeFromOutline(session.context, members, heightOf, calendarExitPositions(groupFrame.data.node, members)));
              },
            },
          );
        }
        entries.push(...sourceEntries(env, groupId, { x: groupFrame.data.node.x + groupFrame.data.node.w + 60, y: groupFrame.data.node.y }));
        setMenu({ x: event.clientX, y: event.clientY, entries });
        return;
      }
    }
    const frame = clicked?.data.node.kind === "outline" ? clicked.data.node : null;
    if (frame !== null && frame.outlineId !== null) {
      const outlineId = frame.outlineId;
      const outline = session.store.get("outlines", outlineId);
      const horizontal = outline?.direction === "horizontal";
      entries.push({ kind: "separator" }, { label: "Read as one document", icon: <ScrollText size={14} />, onSelect: () => onOpenDocument?.(outlineId) });
      if (!readOnly) {
        entries.push(
          horizontal
            ? { label: "Make vertical", icon: <Rows3 size={14} />, onSelect: () => runCommand(setOutlineDirection(session.context, outlineId, "vertical")) }
            : { label: "Make horizontal", icon: <Columns3 size={14} />, onSelect: () => runCommand(setOutlineDirection(session.context, outlineId, "horizontal")) },
          { kind: "separator" },
          { label: "No list marks", onSelect: () => runCommand(setOutlineList(session.context, outlineId, null)) },
          { label: "Bullets", onSelect: () => runCommand(setOutlineList(session.context, outlineId, "bullets")) },
          { label: "Numbers", onSelect: () => runCommand(setOutlineList(session.context, outlineId, "numbers")) },
          { kind: "separator" },
          {
            label: "New outline next to this one",
            icon: <ListTree size={14} />,
            onSelect: () => runCommand(createOutlineWithPage(session.context, boardId, roundBoard(frame.x + frame.w + 60), roundBoard(frame.y + OUTLINE_PADDING + OUTLINE_BAR)).command),
          },
          {
            label: "Take all cards out of the outline",
            icon: <Ungroup size={14} />,
            onSelect: () => runCommand(removeFromOutline(session.context, session.graph.membersOf(outlineId).map((place) => place.id), heightOf)),
          },
        );
      }
      if (!readOnly) entries.push(...sourceEntries(env, outlineId, { x: frame.x + frame.w + 60, y: frame.y }));
      setMenu({ x: event.clientX, y: event.clientY, entries });
      return;
    }
    // A row of an outline: reorder and indent.
    if (!readOnly && single?.outlineId != null && single.placeId !== null) {
      const placeId = single.placeId;
      const run = (command: Command) => () => runCommand(command);
      entries.push(
        { label: "Move to front", icon: <ArrowUpToLine size={14} />, onSelect: run(moveRowToEnd(session.context, placeId, "front")) },
        { label: "Move up", icon: <ArrowUp size={14} />, onSelect: run(moveRow(session.context, placeId, -1)) },
        { label: "Move down", icon: <ArrowDown size={14} />, onSelect: run(moveRow(session.context, placeId, 1)) },
        { label: "Move to back", icon: <ArrowDownToLine size={14} />, onSelect: run(moveRowToEnd(session.context, placeId, "back")) },
        { label: "One level deeper (Tab)", icon: <IndentIncrease size={14} />, onSelect: run(indentRow(session.context, placeId)) },
        { label: "One level up (Shift+Tab)", icon: <IndentDecrease size={14} />, onSelect: run(outdentRow(session.context, placeId)) },
        { kind: "separator" },
      );
    }
    if (!readOnly && single?.kind === "item" && single.attachedTo === null && !single.pinned && single.view !== "comment" && single.view !== "weblink") {
      const target = single;
      entries.push(
        { label: "Add comment", icon: <MessageSquarePlus size={14} />, onSelect: () => createAt("comment", target.x + target.w + 18, target.y, { on: target.recordId }) },
        { label: "Attach a URL", icon: <Globe size={14} />, onSelect: () => createAt("weblink", target.x + target.w + 18, target.y, { on: target.recordId }) },
      );
    }
    if (!readOnly && single?.kind === "item" && single.attachedTo !== null && single.placeId !== null) {
      const object = single;
      entries.push({
        label: "Detach",
        icon: <Unlink size={14} />,
        onSelect: () => runCommand(mergeCommands(attachItem(session.context, object.recordId, null), setPlacementRects(session.context, new Map([[object.placeId!, { x: roundBoard(object.x), y: roundBoard(object.y) }]])))),
      });
    }
    if (!readOnly && single?.kind === "item" && single.view === "weblink" && single.placeId !== null) {
      const link = single;
      // A local file: a PDF opens in the reader; another file shows in Finder (it cannot be read aloud).
      const local = isLocalPath(link.url);
      const pdf = isPdfPath(link.url);
      if (link.url !== "") {
        entries.push({ label: !local ? "Open in web browser" : pdf ? "Open PDF" : "Show in Finder", icon: <Globe size={14} />, onSelect: () => (local ? actions.jumpTo(link.url, link.recordId) : actions.openInBrowser(link.url)) });
        if (!local) entries.push({ label: "Download and open website locally", icon: <Download size={14} />, onSelect: () => actions.openUrl(link.url, false, undefined, link.recordId) });
        if (!local || pdf) entries.push({ label: "Read aloud", icon: <AudioLines size={14} />, onSelect: () => actions.openUrl(link.url, true, undefined, link.recordId) });
      }
      entries.push({ label: "Edit name and link", icon: <Pencil size={14} />, onSelect: () => setEditing({ nodeId: link.id, edit: "title" }) });
    }
    // Plugin "Sorting tray": cards on a sorting map go back to the tray, or are thrown away.
    if (!readOnly) entries.push(...mapCardEntries(env, cards.filter((node) => node.data.node.kind === "item" && node.data.node.sorted).map((node) => node.data.node.placeId!)));
    // A card in a calendar: more than one day (no time), or a time (one day).
    if (!readOnly && single?.kind === "item" && single.inCalendar && single.placeId !== null) {
      const place = session.store.get("links", single.placeId);
      if (place?.kind === "place" && place.day !== undefined) {
        const placeId = single.placeId;
        entries.push({
          label: place.until !== undefined ? `Days: ${place.day} – ${place.until}…` : place.time !== undefined ? `Time: ${place.time}…` : "Days and time…",
          icon: <CalendarRange size={14} />,
          onSelect: () => setScheduleFor(placeId),
        });
        entries.push({ kind: "separator" });
      }
    }
    // Notes: yellow (the default) or gray ("Gray out").
    const notes = cards.filter((node) => node.data.node.kind === "item" && isNote(node.data.node) && node.data.node.placeId !== null);
    if (!readOnly && notes.length > 0) {
      const notePlaces = notes.map((node) => node.data.node.placeId!);
      const gray = notes.every((node) => node.data.node.color === NOTE_GRAY);
      entries.push(
        gray
          ? { label: notes.length > 1 ? `Yellow notes (${notes.length})` : "Yellow note", icon: <StickyNote size={14} color="#ffd60a" />, onSelect: () => runCommand(setCardColor(session.context, notePlaces, null)) }
          : { label: notes.length > 1 ? `Gray out (${notes.length})` : "Gray out", icon: <StickyNote size={14} color={NOTE_GRAY} />, onSelect: () => runCommand(setCardColor(session.context, notePlaces, NOTE_GRAY)) },
      );
    }
    // Scribbles: the ink color (the theme ink, or a pen color).
    const scribbles = cards.filter((node) => node.data.node.kind === "stamp" && node.data.node.placeId !== null);
    if (!readOnly && scribbles.length > 0) {
      const scribblePlaces = scribbles.map((node) => node.data.node.placeId!);
      entries.push({
        kind: "choices",
        label: "Scribble color",
        choices: [{ id: "ink", text: "Ink", tip: "Black or white, as the theme" }, ...SCRIBBLE_COLORS.map((entry) => ({ id: entry.color, text: "●", tip: entry.label, color: entry.color }))],
        current: scribbles.every((node) => node.data.node.color === scribbles[0]!.data.node.color) ? (scribbles[0]!.data.node.color ?? "ink") : "",
        onSelect: (id: string) => runCommand(setCardColor(session.context, scribblePlaces, id === "ink" ? null : id)),
      });
      entries.push({ kind: "separator" });
    }
    const todos = cards.filter((node) => node.data.node.kind === "item" && node.data.node.view === "todo");
    if (!readOnly && todos.length > 0) {
      entries.push({ label: todos.length > 1 ? `Done (${todos.length})` : "Done", icon: <Check size={14} />, onSelect: () => runCommand(completeItems(session.context, todos.map((node) => node.data.node.recordId))) });
      entries.push({
        kind: "colors",
        colors: [...TODO_COLORS],
        onSelect: (color: string) => runCommand(setCardColor(session.context, todos.flatMap((node) => (node.data.node.placeId === null ? [] : [node.data.node.placeId])), color)),
      });
      entries.push({ kind: "separator" });
    }
    // Any other card: its color (the color of the card kind, or one of the card colors).
    const colored = cards.filter((node) => node.data.node.kind === "item" && node.data.node.view !== "todo" && (!node.data.node.isReference || node.data.node.sorted) && node.data.node.placeId !== null);
    if (!readOnly && colored.length > 0) {
      const colorPlaces = colored.map((node) => node.data.node.placeId!);
      const first = colored[0]!.data.node.color;
      entries.push({
        kind: "choices",
        label: "Card color",
        choices: [{ id: "kind", text: "Default", tip: "Color of the card kind" }, ...CARD_SWATCHES.map((color) => ({ id: color, text: "●", tip: color, color }))],
        current: colored.every((node) => node.data.node.color === first) ? (first ?? "kind") : "",
        onSelect: (id: string) => runCommand(setCardColor(session.context, colorPlaces, id === "kind" ? null : id)),
      });
      entries.push({ kind: "separator" });
    }
    if (single?.kind === "item" && single.isBoard && !single.isReference) {
      entries.push({ label: "Open board", icon: <Maximize2 size={14} />, onSelect: () => onOpenRecord(single.recordId) });
    }
    if (single?.kind === "item") entries.push(exportEntry(single.recordId, single.isBoard ? "Export this board as a bundle…" : "Export as a bundle…"));
    // A flashcard edits in place, from this menu only: its front (name) or its back (text).
    if (single?.kind === "item" && single.view === "flashcard" && !single.isBoard) {
      if (!readOnly) {
        const nodeId = cards[0]!.id;
        entries.push(
          { label: "Edit front", icon: <PenLine size={14} />, onSelect: () => setEditing({ nodeId, edit: "title" }) },
          { label: "Edit back", icon: <PenLine size={14} />, onSelect: () => setEditing({ nodeId, edit: "body" }) },
        );
      }
    } else if (single?.kind === "item" && isQuote(single)) {
      // A quote card: its text and its source edit in place. Its marks are one line of choices.
      if (!readOnly) {
        const nodeId = cards[0]!.id;
        const placeId = single.placeId;
        entries.push(
          { label: "Edit text", icon: <PenLine size={14} />, onSelect: () => setEditing({ nodeId, edit: "body" }) },
          { label: "Edit source", icon: <PenLine size={14} />, onSelect: () => setEditing({ nodeId, edit: "title" }) },
        );
        if (placeId !== null) {
          entries.push({
            kind: "choices",
            label: "Marks",
            choices: QUOTE_MARKS.map((id) => ({ id, text: id === "none" ? "none" : QUOTE_GLYPHS[id].open + QUOTE_GLYPHS[id].close, tip: QUOTE_GLYPHS[id].tip })),
            current: single.marks,
            onSelect: (id) => runCommand(setQuoteMarks(session.context, placeId, id as QuoteMarks)),
          });
          entries.push(
            isCollapsed(single)
              ? { label: "Unfold the quote", icon: <Maximize2 size={14} />, onSelect: () => runCommand(setPlacementExpanded(session.context, placeId, true)) }
              : { label: "Fold into a bubble", icon: <Minimize2 size={14} />, onSelect: () => runCommand(setPlacementExpanded(session.context, placeId, false)) },
          );
        }
      }
    } else if (single?.kind === "item" && isGroupShape(single)) {
      // A group card: its name, and its look (only the outline, or filled with its color).
      if (!readOnly) {
        const nodeId = cards[0]!.id;
        const placeId = single.placeId;
        entries.push({ label: "Rename", icon: <PenLine size={14} />, onSelect: () => setEditing({ nodeId, edit: "title" }) });
        if (placeId !== null) {
          entries.push({
            kind: "choices",
            label: "Look",
            choices: [
              { id: "outline", text: "Outline only", tip: "Only the outline of the group shows" },
              { id: "filled", text: "Filled", tip: "The color of the group fills its area" },
            ],
            current: single.filled ? "filled" : "outline",
            onSelect: (id) => runCommand(setGroupFilled(session.context, placeId, id === "filled")),
          });
        }
      }
    } else if (single?.kind === "item" && !isNote(single) && !single.isBoard) {
      entries.push({ label: "Edit text", icon: <PenLine size={14} />, onSelect: () => actions.openText(single.recordId) });
    }
    // The links of the card: "→ name" goes to a linked item (at its passage), "← name" to an item that links here.
    // Also for items on other boards (no line on this board).
    if (single?.kind === "item") {
      const { outgoing, incoming } = linksOf(session.store, session.graph, session.rootId, single.recordId);
      const LIMIT = 6;
      if (outgoing.length + incoming.length > 0) entries.push({ kind: "separator" });
      for (const end of outgoing.slice(0, LIMIT)) {
        entries.push({ label: `→ ${end.title}`, icon: <ArrowRight size={14} />, onSelect: () => (end.linkId !== null ? actions.followLink(end.linkId) : actions.openAt(end.itemId)) });
      }
      for (const end of incoming.slice(0, LIMIT)) {
        entries.push({ label: `← ${end.title}`, icon: <ArrowLeft size={14} />, onSelect: () => actions.openAt(end.itemId, end.excerpt !== "" ? { quote: end.excerpt } : {}) });
      }
      if (outgoing.length > LIMIT || incoming.length > LIMIT) {
        entries.push({ label: "All links: open the page", icon: <Link2 size={14} />, onSelect: () => actions.openText(single.recordId) });
      }
    }
    if (single?.isReference === true) {
      const home = session.graph.homeOf(single.recordId);
      entries.push({ label: "Open home board", icon: <Home size={14} />, disabled: home === undefined, onSelect: () => home !== undefined && actions.openBoard(home.from, single.recordId) });
    }
    // Two cards: side by side with their differences (the compare lab plugin).
    const pair = cards.filter((node) => node.data.node.kind === "item" && session.store.has("items", node.data.node.recordId));
    if (cards.length === 2 && pair.length === 2 && comparePlugin) {
      entries.push({ label: "Compare side by side", icon: <Columns2 size={14} />, onSelect: () => actions.compare({ itemId: pair[0]!.data.node.recordId }, { itemId: pair[1]!.data.node.recordId }) });
    }
    if (single !== null && single.kind === "item" && session.store.has("items", single.recordId)) {
      entries.push({ label: "Send to link bench", icon: <Link2 size={14} />, onSelect: () => sendToBench({ itemId: single.recordId }) });
      if (comparePlugin) entries.push({ label: "Send to compare bench", icon: <Columns2 size={14} />, onSelect: () => sendToCompareBench({ itemId: single.recordId }) });
    }
    if (!readOnly && placeIds.length > 0) {
      entries.push({
        label: placeIds.length > 1 ? `Move ${placeIds.length} to board…` : "Move to board…",
        icon: <FolderInput size={14} />,
        onSelect: async () => {
          const target = await actions.pickItem({ title: "Move to board…", allowCreate: true });
          if (target !== null) runCommand(moveIntoBoard(session.context, placeIds, target));
        },
      });
      const items = cards.filter((node) => node.data.node.kind === "item" && node.data.node.outlineId === null);
      if (items.length > 0 && cards.every((node) => node.data.node.kind === "item")) {
        entries.push({ label: items.length === cards.length ? "Make outline" : "Add to outline", icon: <ListTree size={14} />, onSelect: () => runCommand(createOutline(session.context, boardId, placeIds).command) });
      }
      const members = placeIds.filter((placeId) => cards.some((node) => node.data.node.placeId === placeId && node.data.node.outlineId !== null));
      if (members.length > 0) {
        // A radial card leaves at the place where it shows (its place in the ball is not saved).
        const radialIds = new Set(members.filter((placeId) => isRadial(session.store.get("outlines", (session.store.get("links", placeId) as PlaceLink | undefined)?.outline ?? ""))));
        const shown = new Map(cards.flatMap((node) => (node.data.node.placeId !== null && radialIds.has(node.data.node.placeId) ? [[node.data.node.placeId, { x: Math.round(node.data.node.x), y: Math.round(node.data.node.y) }] as const] : [])));
        entries.push({ label: radialIds.size === members.length ? "Take out of radial" : "Take out of outline", icon: <Ungroup size={14} />, onSelect: () => runCommand(removeFromOutline(session.context, members, heightOf, shown)) });
      }
      if (single?.placeId != null && single.innerStamps.length > 0) {
        const notePlaceId = single.placeId;
        entries.push({ label: "Take scribbles out", icon: <LogOut size={14} />, onSelect: () => runCommand(releaseFromNote(session.context, notePlaceId)) });
      }
      // Plugin "Sorting tray": a collection card can feed a sorting map.
      if (single?.kind === "item" && single.isBoard && !single.isReference) entries.push(...sourceEntries(env, single.recordId, { x: single.x + single.w + 60, y: single.y }));
    }
    if (entries.length > 0) setMenu({ x: event.clientX, y: event.clientY, entries });
}

/** The right-click menu of the empty canvas: the board background. */
export function openPaneMenuOf(env: BoardMenuEnv, event: MouseEvent | globalThis.MouseEvent): void {
  const { actions, boardId, exportEntry, flow, ownBackground, pendingSelection, readOnly, runCommand, searchOnRightClick, session, setEditing, setMenu, settings } = env;
    event.preventDefault();
    if (searchOnRightClick(event)) return;
    if (readOnly) return;
    const image = (scope: "board" | "all") => () => void chooseBackgroundImage(session, runCommand, scope, boardId);
    const point = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const entries: MenuEntry[] = [
      { label: "New outline here", icon: <ListTree size={14} />, onSelect: () => runCommand(createOutlineWithPage(session.context, boardId, roundBoard(point.x), roundBoard(point.y)).command) },
      {
        label: "New calendar here",
        icon: <CalendarDays size={14} />,
        onSelect: () => {
          const month = monthOf(new Date().toISOString());
          runCommand(createCalendar(session.context, boardId, roundBoard(point.x), roundBoard(point.y), month, addMonths(month, 2)).command);
        },
      },
      {
        label: "New media item here",
        icon: <Music size={14} />,
        onSelect: () => {
          const { command, placeId } = createMediaItem(session.context, { boardId, x: roundBoard(point.x), y: roundBoard(point.y), kind: "audio" });
          pendingSelection.current = new Set([placeId]);
          runCommand(command);
          setEditing({ nodeId: placeId, edit: "title" });
        },
      },
      {
        label: "New picture here…",
        icon: <ImageIcon size={14} />,
        onSelect: () =>
          void session.importImage().then((path) => {
            if (path === null) return;
            const created = createMediaItem(session.context, { boardId, x: roundBoard(point.x), y: roundBoard(point.y), kind: "image", file: path });
            pendingSelection.current = new Set([created.placeId]);
            runCommand(created.command);
          }),
      },
      { kind: "separator" },
      exportEntry(boardId, "Export this board as a bundle…"),
      {
        label: "Import a board bundle here…",
        icon: <FolderUp size={14} />,
        onSelect: () =>
          void session.importBoardBundle(boardId, roundBoard(point.x), roundBoard(point.y)).then(
            (result) => {
              if (result === null) return;
              if ("problem" in result) void actions.askFields({ title: "The bundle could not be imported", submit: "OK", fields: [{ key: "why", label: "Reason", value: result.problem }] });
              else runCommand(result.command);
            },
            (problem: unknown) => void actions.askFields({ title: "The bundle could not be imported", submit: "OK", fields: [{ key: "why", label: "Reason", value: String(problem).replace(/^Error: /, "") }] }),
          ),
      },
      { kind: "separator" },
      { label: "Background image for this board…", icon: <ImagePlus size={14} />, onSelect: image("board") },
      { label: "Background image for all boards…", icon: <ImagePlus size={14} />, onSelect: image("all") },
    ];
    if (ownBackground !== null) entries.push({ label: "Remove the background of this board", icon: <ImageMinus size={14} />, onSelect: () => void applyBackground(session, runCommand, "board", boardId, null) });
    if (settings.defaultBackground !== null) entries.push({ label: "Remove the default background", icon: <ImageMinus size={14} />, onSelect: () => void applyBackground(session, runCommand, "all", boardId, null) });
    setMenu({ x: event.clientX, y: event.clientY, entries });
}
