// "Back up": a full copy of the vault data in <vault>/.backup/<time>/ (see src-tauri/src/backup.rs).
// After the copy, a message shows where it is and its size. A backup over the size limit (Settings) gets a warning.
// The backup button opens a menu: "Back up now", and the list of backups (the newest first) with their sizes.
// Each backup: show it in Finder, or delete it for good (after a confirmation; the vault does not change).

import { Archive, FolderOpen, LoaderCircle, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { BackupEntry } from "../../io/backend";
import { t, uiLocale } from "../i18n/i18n";
import { MovablePanel } from "./movable";
import { useSession, useSessionState } from "./sessionContext";

type Status = { kind: "busy" } | { kind: "done"; path: string; bytes: number; over: boolean } | { kind: "error"; message: string } | null;

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Runs a backup. `status`: the message after it (where the copy is, its size), to show in the window. */
export function useBackup(): { run(): void; busy: boolean; disabled: boolean; status: ReactNode } {
  const session = useSession();
  const { readOnly, settings } = useSessionState();
  const [status, setStatus] = useState<Status>(null);
  const run = async () => {
    setStatus({ kind: "busy" });
    try {
      const info = await session.backup();
      setStatus({ kind: "done", path: info.path, bytes: info.bytes, over: info.bytes > settings.backupAlertMB * 1024 * 1024 });
    } catch (problem) {
      setStatus({ kind: "error", message: String(problem).replace(/^Error: /, "") });
    }
  };
  const busy = status?.kind === "busy";
  const message =
    status !== null && status.kind !== "busy" ? (
      <div className={`web-status${status.kind === "error" || (status.kind === "done" && status.over) ? " error" : ""}`} role="status">
        {status.kind === "error" ? (
          <span>{`The backup failed: ${status.message}`}</span>
        ) : (
          <span>
            {status.over ? (
              <strong>{`This backup is ${formatBytes(status.bytes)}: more than your limit of ${formatBytes(settings.backupAlertMB * 1024 * 1024)} (Settings). Old backups in .backup can go.`} </strong>
            ) : (
              <>{`Backed up (${formatBytes(status.bytes)}):`} </>
            )}
            <span translate="no">{status.path}</span>
          </span>
        )}
        <button className="icon-button small" data-tip="Close" data-tip-end onClick={() => setStatus(null)}>
          <X size={14} />
        </button>
      </div>
    ) : null;
  return { run: () => void run(), busy, disabled: readOnly || busy, status: message };
}

/**
 * The top bar button of a backup: it opens the backup menu (the message of a backup shows from `useBackup`).
 * `button: false`: no button (the backup button is in "More"); `open` and `setOpen` then show the menu there.
 */
export function BackupButton({ backup, button = true, open: shown, setOpen: setShown }: { backup: ReturnType<typeof useBackup>; button?: boolean; open?: boolean; setOpen?(open: boolean): void }) {
  const [own, setOwn] = useState(false);
  const open = shown ?? own;
  const setOpen = (value: boolean | ((current: boolean) => boolean)) => {
    const next = typeof value === "function" ? value(open) : value;
    if (setShown !== undefined) setShown(next);
    else setOwn(next);
  };
  const frame = useRef<HTMLSpanElement>(null);
  // A click outside closes the menu (not during a confirmation dialog: it takes no pointer events here).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => frame.current !== null && !frame.current.contains(event.target as Node) && setOpen(false);
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <span className="plugin-menu" ref={frame}>
      {button && (
        <button className={`icon-button${open ? " active" : ""}`} data-tip="Backups: back up now, or manage the backups" onClick={() => setOpen((value) => !value)}>
          {backup.busy ? <LoaderCircle size={16} className="spin" /> : <Archive size={16} />}
        </button>
      )}
      {open && <BackupPanel backup={backup} />}
    </span>
  );
}

/** "2026-10-11_12-00-00" (UTC) as a local date and time; a migration backup says so. Other names stay as they are. */
function backupLabel(name: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})[_T](\d{2})-(\d{2})-(\d{2})(.*)$/.exec(name);
  if (match === null) return name;
  const [, year, month, day, hour, minute, second, rest] = match;
  const time = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
  const text = time.toLocaleString(uiLocale(), { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return (rest ?? "").includes("before-migration") ? t("{0} (before a migration)", text) : text;
}

/** The backup menu: "Back up now", and the backups with their sizes (show in Finder, delete). */
export function BackupPanel({ backup, className = "plugin-popover backup-panel" }: { backup: ReturnType<typeof useBackup>; className?: string }) {
  const session = useSession();
  const { readOnly } = useSessionState();
  const [list, setList] = useState<BackupEntry[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const load = useCallback(() => {
    void session
      .listBackups()
      .then((entries) => setList(entries))
      .catch((error: unknown) => setProblem(String(error).replace(/^Error: /, "")));
  }, [session]);
  useEffect(load, [load]);
  // A new backup: the list reads again.
  useEffect(() => {
    if (!backup.busy) load();
  }, [backup.busy, load]);
  const remove = async (entry: BackupEntry) => {
    const sure = window.confirm(t("Delete the backup of {0} ({1})?\n\nThe backup folder is deleted for good: it does not go to the trash, and Undo cannot bring it back. Your vault does not change.", backupLabel(entry.name), formatBytes(entry.bytes)));
    if (!sure) return;
    try {
      await session.deleteBackup(entry.name);
      setProblem(null);
    } catch (error) {
      setProblem(String(error).replace(/^Error: /, ""));
    }
    load();
  };
  const total = (list ?? []).reduce((sum, entry) => sum + entry.bytes, 0);
  return (
    <MovablePanel className={className} titleClassName="plugin-popover-title" label="Backups" title="Backups">
      <div className="plugin-buttons">
        <button className="primary" disabled={backup.disabled} onClick={backup.run}>
          {backup.busy ? "Backing up…" : "Back up now"}
        </button>
      </div>
      <div className="plugin-note muted">A backup is a full copy of the vault data in its .backup folder. To restore one, copy its files back into the vault.</div>
      {list === null ? (
        <div className="muted">
          <LoaderCircle size={14} className="spin" />
        </div>
      ) : list.length === 0 ? (
        <div className="plugin-note muted">No backups yet.</div>
      ) : (
        <>
          <div className="plugin-skip-group">{list.length === 1 ? `1 backup · ${formatBytes(total)}` : `${list.length} backups · ${formatBytes(total)}`}</div>
          <div className="backup-list">
            {list.map((entry) => (
              <div key={entry.name} className="backup-row">
                <span className="backup-name" title={entry.path}>
                  {backupLabel(entry.name)}
                </span>
                <span className="backup-size muted">{formatBytes(entry.bytes)}</span>
                <button className="icon-button small" data-tip="Show in Finder" onClick={() => void session.revealFile(entry.path).catch((error: unknown) => setProblem(String(error)))}>
                  <FolderOpen size={13} />
                </button>
                <button className="icon-button small" data-tip="Delete this backup for good" data-tip-end disabled={readOnly} onClick={() => void remove(entry)}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {problem !== null && <div className="plugin-error">{problem}</div>}
    </MovablePanel>
  );
}
