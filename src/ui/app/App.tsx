// App root: select a vault, then show the workspace.
// The Vault menu (open, new, close) works from both screens.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Backend, PluginHost } from "../../io/backend";
import { NotAVaultError, Session } from "../../io/session";
import { PluginHostProvider } from "../plugins/pluginsContext";
import { useFileDrop } from "./fileDrop";
import { useSessionLog } from "./debugLog";
import { SessionProvider } from "./sessionContext";
import { Workspace } from "./Workspace";
import { t } from "../i18n/i18n";

/** `plugins`: optional. Without it, the app shows no plugin controls. */
type Props = { backend: Backend; plugins?: PluginHost };

type PickerState =
  | { kind: "starting" }
  | { kind: "choose"; error?: string }
  | { kind: "confirm-create"; folder: string };

export function App({ backend, plugins }: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [picker, setPicker] = useState<PickerState>({ kind: "starting" });
  /** Counts the "Zen Mode" menu clicks. The workspace turns zen mode on or off at each change. */
  const [zenRequest, setZenRequest] = useState(0);
  const sessionRef = useRef<Session | null>(null);
  const pluginHost = useMemo(
    () => (plugins === undefined ? null : { host: plugins, chooseFolder: () => backend.chooseFolder(t("Select the plugins folder")) }),
    [backend, plugins],
  );

  const closeCurrent = useCallback(async () => {
    const current = sessionRef.current;
    sessionRef.current = null;
    setSession(null);
    await current?.close();
  }, []);

  const open = useCallback(
    async (folder: string, create = false) => {
      try {
        // A vault that a different window shows: that window comes to the front, and this one stays as it is.
        if (await backend.focusVaultWindow(folder).catch(() => false)) {
          if (sessionRef.current === null) setPicker({ kind: "choose", error: t("This vault is open in a different window.") });
          return;
        }
        await closeCurrent();
        const opened = await Session.open(backend, folder, { create });
        sessionRef.current = opened;
        setSession(opened);
      } catch (error) {
        if (error instanceof NotAVaultError) setPicker({ kind: "confirm-create", folder: error.folder });
        else setPicker({ kind: "choose", error: String(error) });
      }
    },
    [backend, closeCurrent],
  );

  const chooseAndOpen = useCallback(async () => {
    const folder = await backend.chooseFolder(t("Open a vault folder"));
    if (folder !== null) await open(folder);
  }, [backend, open]);

  /** Vault › Open Vault in New Window: the vault opens in a new window; this window stays as it is. */
  const chooseForWindow = useCallback(async () => {
    const folder = await backend.chooseFolder(t("Open a vault folder"));
    if (folder !== null) await backend.openVaultWindow(folder).catch((error: unknown) => window.alert(String(error)));
  }, [backend]);

  const chooseAndCreate = useCallback(async () => {
    const folder = await backend.chooseFolder(t("Select a folder for the new vault"));
    // If the folder is a vault already, this opens it. It never overwrites a vault.
    if (folder !== null) await open(folder, true);
  }, [backend, open]);

  // Startup. The app has no memory of vault locations. A development build opens the test vault.
  // The ref stops a second run (React StrictMode runs effects two times).
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void backend.startupVault().then((folder) => {
      if (folder === null) setPicker({ kind: "choose" });
      else void open(folder);
    });
  }, [backend, open]);

  // Save everything before the window closes.
  useEffect(() => {
    // The window closes after the handler. If the save fails, the user decides: an error keeps the window open.
    const stop = backend.onCloseRequested(async () => {
      try {
        await sessionRef.current?.close();
      } catch (error) {
        if (!window.confirm(t("Inspoboard could not save: {0}\n\nClose anyway? Changes that are not saved are lost.", String(error)))) throw error;
      }
    });
    return () => void stop.then((unlisten) => unlisten());
  }, [backend]);

  // Vault menu, and View > Zen Mode.
  useEffect(() => {
    const stop = backend.onMenu((id) => {
      if (id === "vault-open") void chooseAndOpen();
      if (id === "vault-window") void chooseForWindow();
      if (id === "vault-new") void chooseAndCreate();
      if (id === "vault-close") void closeCurrent().then(() => setPicker({ kind: "choose" }));
      if (id === "view-zen") setZenRequest((count) => count + 1);
      if (id === "vault-log") void backend.logPath().then((path) => (path === null ? undefined : backend.revealFile(path)));
    });
    return () => void stop.then((unlisten) => unlisten());
  }, [backend, chooseAndOpen, chooseForWindow, chooseAndCreate, closeCurrent]);
  // Files dropped from the system: see fileDrop.ts.
  useFileDrop(backend);
  // The session log (Vault › Show Session Log in Finder): see debugLog.ts.
  useSessionLog(backend);

  if (session !== null) {
    return (
      <SessionProvider value={session}>
        <PluginHostProvider value={pluginHost}>
          <Workspace key={session.getState().root} zenRequest={zenRequest} />
        </PluginHostProvider>
      </SessionProvider>
    );
  }
  if (picker.kind === "starting") return null;
  return (
    <div className="picker">
      <div className="card">
        <h1>Inspoboard</h1>
        {picker.kind === "confirm-create" ? (
          <>
            <div>
              {`The folder "${picker.folder}" is not a vault. Make a new vault in this folder?`}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="primary" onClick={() => void open(picker.folder, true)}>Make a vault</button>
              <button onClick={() => setPicker({ kind: "choose" })}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <div className="muted">All data stays in the vault folder as plain text.</div>
            {picker.error !== undefined && <div className="error">{picker.error}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="primary" onClick={() => void chooseAndOpen()}>Open vault…</button>
              <button onClick={() => void chooseAndCreate()}>New vault…</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
