// Bridge to the Tauri backend. This is the only module that imports @tauri-apps packages.
// Other modules use the Backend type. Tests can give a fake backend.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";

/**
 * The words of the file dialogs (titles, file kinds) in the UI language. The UI sets it (t of src/ui/i18n);
 * this module does not import UI code.
 */
let words: (text: string) => string = (text) => text;
export function setBackendWords(translate: (text: string) => string): void {
  words = translate;
}

export type OpenedVault = {
  root: string;
  lockedByOther: boolean;
  files: { path: string; content: string }[];
  unreadable: string[];
};

/** `content: null` moves the file to the trash. */
export type FileWrite = { path: string; content: string | null };

export type FileChange = { path: string; content: string | null; unreadable: boolean };

export type SnapshotInfo = { id: string; message: string; time: number };
/** A backup folder: its full path, its size in bytes, and its number of files. */
export type BackupInfo = { path: string; bytes: number; files: number };

export type Backend = {
  openVault(path: string): Promise<OpenedVault>;
  closeVault(): Promise<void>;
  /** Each call names its vault. If the backend lost the open vault, it opens it again. */
  writeFiles(root: string, writes: FileWrite[]): Promise<void>;
  /** Returns the snapshot ID, or null if nothing changed. */
  snapshot(root: string, message: string): Promise<string | null>;
  listSnapshots(root: string, limit: number): Promise<SnapshotInfo[]>;
  /** Copies the vault data into `<vault>/.backup/<time>/`. */
  backupVault(root: string): Promise<BackupInfo>;
  /** The vault to open at startup. Release builds: none. Development builds: the test vault. */
  startupVault(): Promise<string | null>;
  chooseFolder(title?: string): Promise<string | null>;
  /** A file dialog for one image (PNG, JPEG, GIF, WebP). */
  chooseImage(): Promise<string | null>;
  /** Copies an image into `images/` of the vault. Returns its vault path. */
  importImage(root: string, source: string): Promise<string>;
  /** Saves image bytes (a pasted or dropped image) into `images/` of the vault. `name` gives the type: "pasted.png". Returns its vault path. */
  saveImageBytes(root: string, name: string, bytes: Uint8Array): Promise<string>;
  /** The bytes of an image of the vault (`images/<name>`). */
  readImage(root: string, path: string): Promise<ArrayBuffer>;
  /** A saved web page or its notes (`web/<key>.html`, `web/<key>.notes.json`), or null if there is none. */
  readWebFile(root: string, path: string): Promise<string | null>;
  writeWebFile(root: string, path: string, content: string): Promise<void>;
  /** A saved PDF (`web/<key>.pdf`). Rejects if it is not there. */
  readWebBytes(root: string, path: string): Promise<ArrayBuffer>;
  writeWebBytes(root: string, path: string, bytes: Uint8Array): Promise<void>;
  /** A file dialog for one PDF. */
  choosePdf(): Promise<string | null>;
  /** Copies a PDF into the vault (web/<key>.pdf). Returns its key. */
  importPdf(root: string, source: string): Promise<string>;
  /** Shows a local file in Finder (Explorer on Windows). Rejects if there is no file there. */
  revealFile(path: string): Promise<void>;
  /** Opens a web address (http or https) in the default web browser. */
  openInBrowser(url: string): Promise<void>;
  /** The English text of each item of the app menu (menu bar). */
  menuTexts(): Promise<{ id: string; text: string }[]>;
  /** Writes texts on items of the app menu (the UI language). */
  setMenuTexts(texts: { id: string; text: string }[]): Promise<void>;
  /** A save dialog, then writes the text there (Markdown). Returns the path, or null if the user cancelled. */
  exportText(defaultName: string, content: string): Promise<string | null>;
  /** Writes a board bundle into a new folder in `parent`. Returns the new folder. */
  exportBundle(root: string, parent: string, name: string, files: Record<string, string>, images: string[]): Promise<string>;
  /** Reads the board data of a bundle folder (vault.json, tables, texts) and the names of its images. */
  readBundle(folder: string): Promise<{ files: Record<string, string>; images: string[] }>;
  /** Copies images of a bundle into the vault. Returns bundle path -> vault path. */
  importBundleImages(root: string, folder: string, images: string[]): Promise<Record<string, string>>;
  onFileChange(listener: (change: FileChange) => void): Promise<() => void>;
  /** The handler runs before the window closes. The window waits for it. */
  onCloseRequested(handler: () => Promise<void>): Promise<() => void>;
  /** Menu commands from the native menu, for example "vault-open". */
  onMenu(listener: (id: string) => void): Promise<() => void>;
};

export const tauriBackend: Backend = {
  openVault: (path) => invoke<OpenedVault>("open_vault", { path }),
  closeVault: () => invoke<void>("close_vault"),
  writeFiles: (root, writes) => invoke<void>("write_files", { root, writes }),
  snapshot: (root, message) => invoke<string | null>("snapshot", { root, message }),
  listSnapshots: (root, limit) => invoke<SnapshotInfo[]>("list_snapshots", { root, limit }),
  backupVault: (root) => invoke<BackupInfo>("backup_vault", { root }),
  revealFile: (path) => invoke<void>("reveal_file", { path }),
  openInBrowser: (url) => invoke<void>("open_in_browser", { url }),
  menuTexts: () => invoke<{ id: string; text: string }[]>("menu_texts"),
  setMenuTexts: (texts) => invoke<void>("set_menu_texts", { texts }),
  exportBundle: (root, parent, name, files, images) => invoke<string>("export_bundle", { root, parent, name, files, images }),
  readBundle: (folder) => invoke<{ files: Record<string, string>; images: string[] }>("read_bundle", { folder }),
  importBundleImages: (root, folder, images) => invoke<Record<string, string>>("import_bundle_images", { root, folder, images }),
  startupVault: () => invoke<string | null>("startup_vault"),
  chooseFolder: async (title = "Select a vault folder") => {
    const result = await open({ directory: true, multiple: false, title: words(title) });
    return typeof result === "string" ? result : null;
  },
  chooseImage: async () => {
    const result = await open({ multiple: false, title: words("Select an image"), filters: [{ name: words("Images"), extensions: ["png", "jpg", "jpeg", "gif", "webp"] }] });
    return typeof result === "string" ? result : null;
  },
  importImage: (root, source) => invoke<string>("import_image", { root, source }),
  readImage: (root, path) => invoke<ArrayBuffer>("read_image", { root, path }),
  saveImageBytes: (root, name, bytes) => invoke<string>("save_image_bytes", bytes, { headers: { "x-root": encodeURIComponent(root), "x-name": encodeURIComponent(name) } }),
  readWebFile: (root, path) => invoke<string | null>("read_web_file", { root, path }),
  writeWebFile: (root, path, content) => invoke<void>("write_web_file", { root, path, content }),
  readWebBytes: (root, path) => invoke<ArrayBuffer>("read_web_bytes", { root, path }),
  writeWebBytes: (root, path, bytes) => invoke<void>("write_web_bytes", bytes, { headers: { "x-root": encodeURIComponent(root), "x-path": encodeURIComponent(path) } }),
  choosePdf: async () => {
    const result = await open({ multiple: false, title: words("Open a PDF"), filters: [{ name: "PDF", extensions: ["pdf"] }] });
    return typeof result === "string" ? result : null;
  },
  importPdf: (root, source) => invoke<string>("import_pdf", { root, source }),
  exportText: async (defaultName, content) => {
    const path = await save({ title: words("Save as"), defaultPath: defaultName, filters: [{ name: "Markdown", extensions: ["md"] }] });
    if (path === null) return null;
    await invoke<void>("export_text", { path, content });
    return path;
  },
  onFileChange: (listener) => listen<FileChange>("vault-file-changed", (event) => listener(event.payload)),
  onCloseRequested: (handler) => getCurrentWindow().onCloseRequested(handler),
  onMenu: (listener) => listen<string>("menu", (event) => listener(event.payload)),
};

/** A plugin in the plugins folder. See docs/PLUGINS.md. */
export type PluginInfo = {
  /** The folder name. It identifies the plugin. */
  name: string;
  title: string;
  version: string;
  capabilities: string[];
  /** Why the plugin cannot start, or null. */
  problem: string | null;
};

/**
 * Bridge to plugin programs. The core app knows only this protocol, not what a plugin does.
 * Calls send only the data in `params`. A plugin has no other access to the vault.
 */
export type PluginHost = {
  /** The plugins folder. Development builds: data/plugins in the repository. */
  folder(): Promise<string | null>;
  /** Release builds only. */
  setFolder(path: string): Promise<void>;
  list(): Promise<PluginInfo[]>;
  call(name: string, method: string, params: unknown): Promise<unknown>;
  onProgress(listener: (plugin: string, params: unknown) => void): Promise<() => void>;
  /** A save dialog for a plugin output file (for example, audio). The plugin writes the file. */
  chooseSaveFile(defaultName: string, extensions: string[]): Promise<string | null>;
  /** The floating subtitle window (above all apps): shows the text, or hides (null). */
  showSubtitle?(text: string | null): Promise<void>;
};

export const tauriPlugins: PluginHost = {
  folder: () => invoke<string | null>("plugins_folder_path"),
  setFolder: (path) => invoke<void>("set_plugins_folder", { path }),
  list: () => invoke<PluginInfo[]>("list_plugins"),
  call: (name, method, params) => invoke<unknown>("plugin_call", { name, method, params }),
  onProgress: (listener) =>
    listen<{ plugin: string; params: unknown }>("plugin-progress", (event) => listener(event.payload.plugin, event.payload.params)),
  chooseSaveFile: async (defaultName, extensions) =>
    (await save({ title: words("Save as"), defaultPath: defaultName, filters: [{ name: words("Audio"), extensions }] })) ?? null,
  showSubtitle: (text) => invoke<void>("subtitle_set", { text }),
};

/**
 * File access for one vault. The persister and the session use it.
 * After close(), it refuses all calls: a late timer of a closed vault must not open it again.
 */
export type VaultAccess = {
  writeFiles(writes: FileWrite[]): Promise<void>;
  snapshot(message: string): Promise<string | null>;
  close(): void;
};

export function vaultAccess(backend: Backend, root: string): VaultAccess {
  let closed = false;
  const check = () => {
    if (closed) throw new Error("This vault is closed.");
  };
  return {
    writeFiles: async (writes) => {
      check();
      await backend.writeFiles(root, writes);
    },
    snapshot: async (message) => {
      check();
      return backend.snapshot(root, message);
    },
    close: () => {
      closed = true;
    },
  };
}
