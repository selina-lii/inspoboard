// The top bar of the workspace: navigation, the folded buttons (More ⋯), undo and redo, save state, the path, and
// settings. See docs/SPEC.md section 7 (top bar). Workspace.tsx shows it.

import { ArrowLeft, ArrowRight, ArrowUp, Link2, Check, Ellipsis, Columns2, Dot, History, ListChecks, LoaderCircle, Lock, Redo2, Settings, Trash2, TriangleAlert, Undo2 } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { renameItem } from "../../core/actions";
import type { Id } from "../../core/types";
import { titleOf } from "../board/boardModel";
import { type SettingsSection } from "../dialogs/SettingsDialog";
import { useWebPages } from "../web/WebPages";
import { toggleBench } from "./LinkBench";
import { toggleCompareBench } from "../plugins/compare/CompareBench";
import { usePlugins } from "../plugins/pluginsContext";
import { Archive, RefreshCw, VenetianMask } from "lucide-react";
import { toggleBuzzies } from "../plugins/buzzies/buzzies";
import { BackupButton, useBackup } from "./BackupButton";
import { ContextMenu, type MenuRequest } from "./ContextMenu";
import { FOLDED_BUTTONS } from "./zen";
import { ZenIcon } from "./ZenIcon";
import { CommitField } from "./fields";
import { useHistoryState, useRunCommand, useSession, useSessionState } from "./sessionContext";
import { type Navigation } from "./navigation";
import { ThemeButton } from "./theme";

export type TopBarProps = { shown(id: string): boolean; pinned(id: string): boolean; zen: boolean; navigation: Navigation; path: Id[]; onNavigate(index: number): void; onSearch(): void; onActionItems(): void; onRecent(): void; onTrash(): void; onZen(): void; onSettings(section?: SettingsSection): void };

export function TopBar({ shown, pinned, zen, navigation, path, onNavigate, onSearch, onActionItems, onRecent, onTrash, onZen, onSettings }: TopBarProps) {
  const web = useWebPages();
  const backup = useBackup();
  // The backup menu, opened from "More" (when the backup button is not in the top bar).
  const [backupsOpen, setBackupsOpen] = useState(false);
  const [more, setMore] = useState<MenuRequest | null>(null);
  // A press on ⋯ while the menu is open closes it (the menu closes on the press): the click must not open it again.
  const moreClosed = useRef(0);
  // The folded buttons: in the top bar if pinned (Settings › Top bar; in zen mode: the zen buttons), else in "More".
  const { buzzies, buzzStyle } = useSessionState().settings;
  // The compare bench: only with a compare plugin (lab).
  const comparePlugin = usePlugins().plugins.some((plugin) => plugin.details !== null && plugin.capabilities.includes("compare-text"));
  const folded = FOLDED_BUTTONS.filter((button) => !pinned(button.id) && (button.id !== "buzzies" || buzzies) && (button.id !== "compareBench" || comparePlugin));
  const openMore = (element: HTMLElement) => {
    const box = element.getBoundingClientRect();
    const run: Record<string, () => void> = { actionItems: onActionItems, bench: toggleBench, compareBench: toggleCompareBench, recent: onRecent, trash: onTrash, backup: () => setBackupsOpen(true), zenOn: onZen, buzzies: () => toggleBuzzies(buzzStyle) };
    const icons: Record<string, ReactNode> = {
      actionItems: <ListChecks size={14} />,
      bench: <Link2 size={14} />,
      compareBench: <Columns2 size={14} />,
      recent: <History size={14} />,
      trash: <Trash2 size={14} />,
      backup: <Archive size={14} />,
      zenOn: <ZenIcon size={14} />,
      buzzies: <VenetianMask size={14} />,
    };
    const labels: Record<string, string> = {
      actionItems: "Items by type…",
      bench: "Link bench: show or hide",
      compareBench: "Compare bench (lab): show or hide",
      recent: "Recently added",
      trash: "Trash",
      backup: "Backups…",
      zenOn: "Zen mode (⌃⌘Z)",
      buzzies: "Buzzies mode: hide your text (Esc ends it)",
    };
    setMore({
      x: box.left,
      y: box.bottom + 4,
      entries: [
        ...folded.map((button) => ({ label: labels[button.id]!, icon: icons[button.id], onSelect: run[button.id]! })),
        // The open web page: save it again from the web.
        ...(web?.saveAgain != null ? [{ kind: "separator" as const }, { label: "Save the page again from the web", icon: <RefreshCw size={14} />, onSelect: web.saveAgain }] : []),
        { kind: "separator" as const },
        { label: "Choose the top bar buttons…", icon: <Settings size={14} />, onSelect: () => onSettings("topBar") },
      ],
    });
  };
  const session = useSession();
  const state = useSessionState();
  const runCommand = useRunCommand();
  const historyState = useHistoryState();
  const [renaming, setRenaming] = useState(false);
  const currentId = path.at(-1)!;
  const status = state.readOnly
    ? { icon: Lock, tip: `Read-only. ${state.readOnlyReason ?? ""}`, className: "error" }
    : {
        saved: { icon: Check, tip: "Saved", className: "" },
        pending: { icon: Dot, tip: "Unsaved changes. They save in a moment.", className: "" },
        saving: { icon: LoaderCircle, tip: "Saving…", className: "spin" },
        error: { icon: TriangleAlert, tip: `Save failed: ${state.saveError ?? ""}`, className: "error" },
      }[state.saveStatus];
  return (
    <header className="topbar">
      {shown("back") && (
      <button className="icon-button" data-tip="Back: to where you were, as it was (⌘[)" data-tip-start disabled={!navigation.canBack} onClick={navigation.back}>
        <ArrowLeft size={16} />
      </button>)}
      {shown("forward") && (
      <button className="icon-button" data-tip="Forward (⌘])" disabled={!navigation.canForward} onClick={navigation.forward}>
        <ArrowRight size={16} />
      </button>)}
      {shown("up") && (
      <button className="icon-button" data-tip="Up: out one level" disabled={path.length < 2} onClick={() => onNavigate(path.length - 2)}>
        <ArrowUp size={16} />
      </button>)}
      {pinned("actionItems") && (
      <button className="icon-button" data-tip="Items by type: all items of one type (action items, quotes, …)" onClick={onActionItems}>
        <ListChecks size={16} />
      </button>)}
      {pinned("bench") && (
      <button className="icon-button" data-tip="Link bench: show or hide it" onClick={toggleBench}>
        <Link2 size={16} />
      </button>)}
      {comparePlugin && pinned("compareBench") && (
      <button className="icon-button" data-tip="Compare bench (lab): show or hide it" onClick={toggleCompareBench}>
        <Columns2 size={16} />
      </button>)}
      {pinned("recent") && (
      <button className="icon-button" data-tip="Recently added: items made in the last 30 days" onClick={onRecent}>
        <History size={16} />
      </button>)}
      {pinned("trash") && (
      <button className="icon-button" data-tip="Trash: items deleted from all boards" onClick={onTrash}>
        <Trash2 size={16} />
      </button>)}
      {shown("undo") && (
      <button
        className="icon-button"
        data-tip={historyState.undoLabel ? `Undo ${historyState.undoLabel} (⌘Z)` : "Undo (⌘Z)"}
        disabled={!historyState.canUndo}
        onClick={() => session.history.undo()}
      >
        <Undo2 size={16} />
      </button>)}
      {shown("redo") && (
      <button
        className="icon-button"
        data-tip={historyState.redoLabel ? `Redo ${historyState.redoLabel} (⇧⌘Z)` : "Redo (⇧⌘Z)"}
        disabled={!historyState.canRedo}
        onClick={() => session.history.redo()}
      >
        <Redo2 size={16} />
      </button>)}
      {shown("save") && (
      <span className={`save-status icon-button ${status.className}`} data-tip={status.tip}>
        <status.icon size={15} />
      </span>)}
      {pinned("backup") ? <BackupButton backup={backup} /> : <BackupButton backup={backup} button={false} open={backupsOpen} setOpen={setBackupsOpen} />}
      {backup.status}
      {shown("theme") && <ThemeButton />}
      {/* Zen mode: only the buttons chosen in Settings show. Esc (or the button in the small bar) ends it. */}
      {!zen && pinned("zenOn") && (
      <button className="icon-button" data-tip="Zen mode: hide the bars (⌃⌘Z · Esc ends it)" onClick={onZen}>
        <ZenIcon size={16} />
      </button>)}
      {buzzies && pinned("buzzies") && (
      <button className="icon-button" data-tip="Buzzies mode: hide your text (Esc ends it)" onClick={() => toggleBuzzies(buzzStyle)}>
        <VenetianMask size={16} />
      </button>)}
      {!zen && folded.length > 0 && (
      <button className={`icon-button${more !== null ? " active" : ""}`} data-tip="More: action items, link bench, recently added, trash, back up, zen mode" onClick={(event) => performance.now() - moreClosed.current > 300 && openMore(event.currentTarget)}>
        <Ellipsis size={16} />
      </button>)}
      {more !== null && <ContextMenu request={more} onClose={() => ((moreClosed.current = performance.now()), setMore(null))} />}
      {shown("settings") && (
      <button className="icon-button" data-tip="Settings" onClick={() => onSettings()}>
        <Settings size={16} />
      </button>)}
      <span className="divider" />
      {shown("path") && <div className="breadcrumb">
        {path.map((id, index) => {
          const current = index === path.length - 1;
          return (
            <span key={`${id}-${index}`} style={{ display: "contents" }}>
              {index > 0 && <span className="separator">/</span>}
              {current && renaming ? (
                <CommitField
                  className="breadcrumb-input"
                  value={session.store.get("items", id)?.name ?? ""}
                  placeholder="Untitled"
                  autoFocus
                  onCommit={(name) => runCommand(renameItem(session.context, id, name.trim()))}
                  onDone={() => setRenaming(false)}
                />
              ) : (
                <button
                  className={`${current ? "current" : ""}${session.store.get("items", id)?.codeName === true ? " code-name" : ""}`}
                  data-tip={current ? "Double-click to rename" : "Go to this board"}
                  onClick={() => {
                    // An open web page or PDF closes: the board shows again (also its own board name).
                    web?.close();
                    onNavigate(index);
                  }}
                  onDoubleClick={() => current && !state.readOnly && session.store.has("items", currentId) && setRenaming(true)}
                >
                  {titleOf(session.store, id)}
                </button>
              )}
            </span>
          );
        })}
      </div>}
    </header>
  );
}
