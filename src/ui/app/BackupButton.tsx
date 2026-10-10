// "Back up": a full copy of the vault data in <vault>/.backup/<time>/ (see src-tauri/src/backup.rs).
// After the copy, a message shows where it is and its size. A backup over the size limit (Settings) gets a warning.

import { Archive, LoaderCircle, X } from "lucide-react";
import { useState } from "react";
import { useSession, useSessionState } from "./sessionContext";

type Status = { kind: "busy" } | { kind: "done"; path: string; bytes: number; over: boolean } | { kind: "error"; message: string } | null;

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function BackupButton() {
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
  return (
    <>
      <button className="icon-button" data-tip="Back up: copy the vault into its .backup folder" disabled={readOnly || status?.kind === "busy"} onClick={() => void run()}>
        {status?.kind === "busy" ? <LoaderCircle size={16} className="spin" /> : <Archive size={16} />}
      </button>
      {status !== null && status.kind !== "busy" && (
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
      )}
    </>
  );
}
