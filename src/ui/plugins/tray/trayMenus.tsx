// Built-in plugin "Sorting tray" (docs/SPEC.md section 7.16): its entries in the right-click menus of the board.
// - A collection card, an outline frame, or a calendar frame: "Make a sorting map" (a new map next to it), and
//   "Add to a sorting map…".
// - Cards on a sorting map: "Back to the tray" and "Throw away". On a processing map also "Make a copy".

import { Copy, Inbox, Network, Trash, Undo2 } from "lucide-react";
import type { Command } from "../../../core/commands";
import type { Id } from "../../../core/types";
import type { Session } from "../../../io/session";
import type { Settings } from "../../../io/settings";
import type { MenuEntry } from "../../app/ContextMenu";
import type { WorkspaceActions } from "../../app/workspaceActions";
import { addSource, backToTray, canBeSource, createSortingMap, isSortingMap, throwAway } from "./tray";
import { canCopy } from "../../../core/lineage";
import { copyBeside, isProcessingMap } from "./processing";
import { copyFilesOf } from "./autoCopies";

type Env = { session: Session; settings: Settings; runCommand(command: Command): boolean; actions: WorkspaceActions; boardId: Id };

/** The entries for a collection or a group (`sourceId`). `at`: the board point for a new map. */
export function sourceEntries(env: Env, sourceId: Id, at: { x: number; y: number }): MenuEntry[] {
  const { session, settings, runCommand, actions, boardId } = env;
  if (!settings.tray || !canBeSource(session, sourceId)) return [];
  return [
    { kind: "separator" },
    {
      label: "Make a sorting map",
      icon: <Network size={14} />,
      onSelect: () => {
        const { command, mapId } = createSortingMap(session.context, { boardId, x: Math.round(at.x), y: Math.round(at.y), sourceId });
        if (runCommand(command)) actions.openBoard(mapId);
      },
    },
    {
      label: "Add to a sorting map…",
      icon: <Inbox size={14} />,
      onSelect: async () => {
        const mapId = await actions.pickItem({ title: "Add to a sorting map…" });
        if (mapId === null) return;
        if (!isSortingMap(session, mapId)) {
          window.alert("This item is not a sorting map. Make one first: “Make a sorting map”.");
          return;
        }
        runCommand(addSource(session.context, mapId, sourceId));
      },
    },
  ];
}

/** The entries for cards on a sorting map: back to the tray, or throw away. Empty on other boards. */
export function mapCardEntries(env: Env, placeIds: readonly Id[]): MenuEntry[] {
  const { session, settings, runCommand, boardId } = env;
  if (!settings.tray || !isSortingMap(session, boardId) || placeIds.length === 0) return [];
  const many = placeIds.length > 1 ? ` (${placeIds.length})` : "";
  // A processing map: a copy of each card next to it, to change the copy and the original separately.
  const copyable = isProcessingMap(session, boardId) ? placeIds.filter((placeId) => { const place = session.store.get("links", placeId); return place?.kind === "place" && canCopy(session.store, place.to); }) : [];
  const copyEntry: MenuEntry[] =
    copyable.length === 0
      ? []
      : [
          {
            label: copyable.length > 1 ? `Make a copy (${copyable.length})` : "Make a copy",
            icon: <Copy size={14} />,
            onSelect: () => {
              const made = copyable.map((placeId) => copyBeside(session.context, placeId));
              if (runCommand({ label: "Make a copy", ops: made.flatMap((one) => one.command.ops) })) copyFilesOf(session, made.flatMap((one) => one.copied));
            },
          },
        ];
  return [
    ...copyEntry,
    { label: `Back to the tray${many}`, icon: <Undo2 size={14} />, onSelect: () => runCommand(backToTray(session.context, placeIds)) },
    { label: `Throw away${many}`, icon: <Trash size={14} />, onSelect: () => runCommand(throwAway(session.context, boardId, placeIds)) },
    { kind: "separator" },
  ];
}
