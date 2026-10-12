// A session is one open vault: store, index, history, persister, and status.
// See docs/SPEC.md sections 4.3 and 4.4.

import { History, type Command } from "../core/commands";
import type { Words } from "../core/words";
import {
  decodeVault,
  encodeMeta,
  encodeRecordLine,
  FORMAT_VERSION,
  idFromTextPath,
  APP_STATE_FILES,
  OPENED_FILE,
  SETTINGS_FILE,
  TABLE_FILES,
  textPath,
  VAULT_FILE,
  type LineTable,
  type VaultMeta,
} from "../core/format";
import { GraphIndex } from "../core/graph";
import { exportBundle, importBundle, readBundle } from "../core/bundle";
import { newId } from "../core/ids";
import { hasErrors, type Problem } from "../core/problems";
import { Store } from "../core/store";
import type { ActionContext } from "../core/actions";
import type { Id, TableName, TableRecords } from "../core/types";
import { referenceProblems } from "../core/validate";
import { vaultAccess, type Backend, type BackupEntry, type BackupInfo, type FileChange, type OpenedVault, type VaultAccess } from "./backend";
import { Persister, tableOfPath, type PersistStatus } from "./persist";
import { encodeSettings, readSettings, type Settings } from "./settings";

/** An outside change to a file that also has unsaved changes in the app. */
export type Conflict = { path: string; theirs: string | null };

export class NotAVaultError extends Error {
  constructor(readonly folder: string) {
    super(`The folder "${folder}" is not a vault.`);
  }
}

export type SessionState = {
  root: string;
  meta: VaultMeta;
  readOnly: boolean;
  readOnlyReason: string | null;
  problems: Problem[];
  conflicts: Conflict[];
  saveStatus: PersistStatus;
  saveError: string | null;
  settings: Settings;
};

export class Session {
  readonly graph: GraphIndex;
  readonly history: History;
  readonly context: ActionContext;
  private persister: Persister | null = null;
  private listeners = new Set<() => void>();
  private stopWatching: (() => void) | null = null;
  private state: SessionState;
  /** Item ID -> ISO time it was last opened. App state, not core data. */
  private opened = new Map<Id, string>();
  private openedTimer: ReturnType<typeof setTimeout> | undefined;
  /** File access for this vault. Every call names the vault folder. */
  private readonly vault: VaultAccess;

  private constructor(
    readonly store: Store,
    private readonly backend: Backend,
    initial: SessionState,
  ) {
    this.graph = new GraphIndex(store);
    this.history = new History(store);
    this.context = { store, graph: this.graph, newId, now: () => new Date().toISOString() };
    this.state = initial;
    this.vault = vaultAccess(backend, initial.root);
  }

  /**
   * Opens a folder as a vault.
   * If the folder has no vault files, it throws NotAVaultError, unless `create` is true.
   * Then the app must ask the user before it creates a vault there.
   */
  static async open(backend: Backend, folder: string, options: { create?: boolean } = {}): Promise<Session> {
    let opened = await backend.openVault(folder);
    if (isEmptyFolder(opened)) {
      if (options.create !== true || opened.lockedByOther) {
        await backend.closeVault();
        throw new NotAVaultError(opened.root);
      }
      await backend.writeFiles(opened.root, newVaultFiles());
      opened = await backend.openVault(folder);
    }
    const files = new Map(opened.files.map((file) => [file.path, file.content]));
    const decoded = decodeVault(files);
    const problems: Problem[] = [...decoded.problems];
    for (const path of opened.unreadable) {
      problems.push({ severity: "error", code: "not-utf8", message: "The file is not UTF-8 text.", path });
    }
    const meta = decoded.meta ?? { format: FORMAT_VERSION, root: "" };
    const session = new Session(decoded.store, backend, {
      root: opened.root,
      meta,
      readOnly: false,
      readOnlyReason: null,
      problems,
      conflicts: [],
      saveStatus: "saved",
      saveError: null,
      settings: readSettings(files.get(SETTINGS_FILE)),
    });
    if (decoded.meta !== null) problems.push(...referenceProblems(decoded.store, session.graph, meta.root));
    session.opened = readOpened(files.get(OPENED_FILE));

    const reason = opened.lockedByOther
      ? "A different Inspoboard window has this vault open."
      : hasErrors(problems)
        ? "The vault has errors. Fix them, then open the vault again."
        : null;
    session.state = { ...session.state, readOnly: reason !== null, readOnlyReason: reason, problems };
    if (reason === null) {
      session.persister = new Persister(decoded.store, session.vault, {
        onStatus: (saveStatus, error) => session.update({ saveStatus, saveError: error ?? null }),
      });
    }
    session.stopWatching = await backend.onFileChange((change) => session.applyOutsideChange(change));
    return session;
  }

  getState(): SessionState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get rootId(): Id {
    return this.state.meta.root;
  }

  /**
   * Cmd+S / Ctrl+S: writes all unsaved changes now and makes a history snapshot.
   * The app saves by itself too. This only makes it happen at once.
   */
  async saveNow(): Promise<void> {
    if (this.persister === null) return;
    try {
      await this.persister.snapshot("Save");
    } catch (error) {
      this.update({ saveStatus: "error", saveError: String(error) });
    }
  }

  listBackups(): Promise<BackupEntry[]> {
    return this.backend.listBackups(this.state.root);
  }

  /** Deletes one backup for good. The caller asks the user first. */
  async deleteBackup(name: string): Promise<void> {
    if (this.state.readOnly) throw new Error("The vault is read-only.");
    await this.backend.deleteBackup(this.state.root, name);
  }

  /** Saves all changes, then copies the vault data into `<vault>/.backup/<time>/`. */
  async backup(): Promise<BackupInfo> {
    await this.saveNow();
    return this.backend.backupVault(this.state.root);
  }

  /** Changes settings. They apply at once and are saved in the vault (not in a read-only vault). */
  async updateSettings(changes: Partial<Settings>): Promise<void> {
    const settings = { ...this.state.settings, ...changes };
    this.update({ settings });
    if (this.state.readOnly) return;
    try {
      await this.vault.writeFiles([{ path: SETTINGS_FILE, content: encodeSettings(settings) }]);
    } catch (error) {
      this.update({ saveStatus: "error", saveError: String(error) });
    }
  }

  /** Asks for an image file and copies it into the vault. Returns its vault path, or null. */
  async importImage(): Promise<string | null> {
    if (this.state.readOnly) return null;
    const source = await this.backend.chooseImage();
    return source === null ? null : this.backend.importImage(this.state.root, source);
  }

  /** Saves a pasted or dropped image into the vault. Returns its vault path ("images/<name>"). */
  saveImageBytes(name: string, bytes: Uint8Array): Promise<string> {
    if (this.state.readOnly) throw new Error("The vault is read-only.");
    return this.backend.saveImageBytes(this.state.root, name, bytes);
  }

  readImage(path: string): Promise<ArrayBuffer> {
    return this.backend.readImage(this.state.root, path);
  }

  readWebFile(path: string): Promise<string | null> {
    return this.backend.readWebFile(this.state.root, path);
  }

  async writeWebFile(path: string, content: string): Promise<void> {
    if (this.state.readOnly) throw new Error("The vault is read-only.");
    await this.backend.writeWebFile(this.state.root, path, content);
  }

  readWebBytes(path: string): Promise<ArrayBuffer> {
    return this.backend.readWebBytes(this.state.root, path);
  }

  async writeWebBytes(path: string, bytes: Uint8Array): Promise<void> {
    if (this.state.readOnly) throw new Error("The vault is read-only.");
    await this.backend.writeWebBytes(this.state.root, path, bytes);
  }

  /** A file dialog for a PDF. Returns its path, or null if the user cancelled. */
  choosePdf(): Promise<string | null> {
    return this.backend.choosePdf();
  }

  /**
   * Copies a local PDF (a path from a link) into the vault: as the copy of a link object (`itemId`), or by its hash.
   * Returns its key.
   */
  importPdfFrom(path: string, itemId?: string): Promise<string> {
    if (this.state.readOnly) throw new Error("The vault is read-only.");
    return this.backend.importPdf(this.state.root, path, itemId);
  }

  revealFile(path: string): Promise<void> {
    return this.backend.revealFile(path);
  }

  openInBrowser(url: string): Promise<void> {
    return this.backend.openInBrowser(url);
  }

  /** Shows the app menu (menu bar) in the UI language: `translate` gives the text of each English text. */
  async translateMenu(translate: (text: string) => string): Promise<void> {
    const texts = await this.backend.menuTexts();
    await this.backend.setMenuTexts(texts.map((entry) => ({ id: entry.id, text: translate(entry.text) })));
  }

  /**
   * Exports a board as a bundle: the user chooses a folder; a new folder in it gets the linear Markdown and the
   * board data. The vault does not change. Returns the new folder, or null if the user cancelled.
   */
  async exportBoardBundle(boardId: Id, words?: Words): Promise<string | null> {
    const parent = await this.backend.chooseFolder("Choose where to save the board bundle");
    if (parent === null) return null;
    const content = exportBundle(this.store, this.graph, boardId, words);
    const name = this.store.get("items", boardId)?.name.trim() || "Board";
    const markdownName = `${name.replace(/[\\/:*?"<>|\n\r\t]+/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+/, "").slice(0, 60) || "Board"}.md`;
    const files = Object.fromEntries([...content.files, [markdownName, content.markdown]]);
    return this.backend.exportBundle(this.state.root, parent, name, files, content.images);
  }

  /**
   * Imports a board bundle onto a board, as a card at (x, y): the user chooses the bundle folder. All records get new
   * IDs (nothing in the vault is replaced). Returns the command to run, null if the user cancelled, or a problem.
   */
  async importBoardBundle(boardId: Id, x: number, y: number): Promise<{ command: Command } | { problem: string } | null> {
    if (this.state.readOnly) return { problem: "The vault is read-only." };
    const folder = await this.backend.chooseFolder("Choose a board bundle folder to import");
    if (folder === null) return null;
    const { files, images } = await this.backend.readBundle(folder);
    const bundle = readBundle(new Map(Object.entries(files)));
    if ("problem" in bundle) return { problem: bundle.problem };
    const paths = images.length === 0 ? {} : await this.backend.importBundleImages(this.state.root, folder, images);
    return { command: importBundle(this.context, bundle, { boardId, x, y }, new Map(Object.entries(paths))).command };
  }

  exportText(defaultName: string, content: string): Promise<string | null> {
    return this.backend.exportText(defaultName, content);
  }

  /** The time an item was last opened, or undefined. */
  openedAt(id: Id): string | undefined {
    return this.opened.get(id);
  }

  /** Records that the user opened an item. Saved after a short delay. Not a command, not in history. */
  markOpened(id: Id): void {
    if (this.state.readOnly || !this.store.has("items", id)) return;
    this.opened.set(id, new Date().toISOString());
    clearTimeout(this.openedTimer);
    this.openedTimer = setTimeout(() => void this.saveOpened(), 1000);
  }

  private async saveOpened(): Promise<void> {
    const entries = [...this.opened].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const content = `${JSON.stringify(Object.fromEntries(entries), null, 1)}\n`;
    try {
      await this.vault.writeFiles([{ path: OPENED_FILE, content }]);
    } catch (error) {
      this.update({ saveStatus: "error", saveError: String(error) });
    }
  }

  async snapshot(message: string): Promise<void> {
    await this.persister?.snapshot(message);
  }

  async close(): Promise<void> {
    this.stopWatching?.();
    if (this.openedTimer !== undefined) {
      clearTimeout(this.openedTimer);
      await this.saveOpened();
    }
    await this.persister?.close();
    // No more file access for this vault, also from late timers.
    this.vault.close();
    await this.backend.closeVault();
  }

  /** Keeps the app version of a conflict file. The disk version goes into history first. */
  async keepMine(path: string): Promise<void> {
    await this.vault.snapshot(`Outside version of ${path}`);
    this.persister?.unblock(path, true);
    this.removeConflict(path);
  }

  /** Loads the disk version of a conflict file. The app version goes into history first. */
  async takeTheirs(path: string): Promise<void> {
    const conflict = this.state.conflicts.find((item) => item.path === path);
    if (conflict === undefined) return;
    this.persister?.unblock(path, true);
    await this.persister?.snapshot(`App version of ${path}`);
    this.applyFile(path, conflict.theirs);
    this.removeConflict(path);
  }

  private applyOutsideChange(change: FileChange): void {
    // App state is not core data. The app does not reload it.
    if (APP_STATE_FILES.includes(change.path)) return;
    if (change.unreadable) {
      this.persister?.block(change.path);
      this.addProblem({ severity: "error", code: "not-utf8", message: "An outside program wrote a file that is not UTF-8 text. The app does not save this file now.", path: change.path });
      return;
    }
    if (this.persister?.isDirty(change.path)) {
      this.persister.block(change.path);
      const conflicts = this.state.conflicts.filter((item) => item.path !== change.path);
      this.update({ conflicts: [...conflicts, { path: change.path, theirs: change.content }] });
      return;
    }
    this.applyFile(change.path, change.content);
  }

  /** Puts the content of one file into the store. This is not an undoable command. */
  private applyFile(path: string, content: string | null): void {
    if (path === VAULT_FILE) {
      this.addProblem({ severity: "warning", code: "meta-changed", message: "vault.json changed outside the app. Open the vault again to use the change.", path });
      return;
    }
    const table = tableOfPath(path);
    if (table !== null) {
      const decoded = decodeVault(new Map([[path, content ?? ""], [VAULT_FILE, encodeMeta(this.state.meta)]]));
      const tableProblems = decoded.problems.filter((problem) => problem.path === path);
      if (hasErrors(tableProblems)) {
        // Do not load a bad file. Do not overwrite it either.
        this.persister?.block(path);
        for (const problem of tableProblems) this.addProblem(problem);
        return;
      }
      this.replaceTable(table, [...decoded.store.all(table)]);
      return;
    }
    const id = idFromTextPath(path);
    if (id === null) return;
    const after = content === null ? null : { id, body: content };
    this.withoutSave(() => this.store.write([{ table: "texts", id, after }]));
  }

  private replaceTable<T extends LineTable>(table: T, records: TableRecords[T][]): void {
    const incoming = new Map<Id, TableRecords[T]>(records.map((record) => [record.id, record]));
    const writes: { table: TableName; id: Id; after: TableRecords[TableName] | null }[] = [];
    for (const current of this.store.all(table)) {
      if (!incoming.has(current.id)) writes.push({ table, id: current.id, after: null });
    }
    for (const record of incoming.values()) {
      const current = this.store.get(table, record.id);
      if (current === undefined || encodeRecordLine(table, current) !== encodeRecordLine(table, record)) {
        writes.push({ table, id: record.id, after: record });
      }
    }
    this.withoutSave(() => this.store.write(writes));
  }

  private withoutSave(apply: () => void): void {
    if (this.persister === null) apply();
    else this.persister.withoutSave(apply);
  }

  private addProblem(problem: Problem): void {
    this.update({ problems: [...this.state.problems, problem] });
  }

  private removeConflict(path: string): void {
    this.update({ conflicts: this.state.conflicts.filter((item) => item.path !== path) });
  }

  private update(changes: Partial<SessionState>): void {
    this.state = { ...this.state, ...changes };
    for (const listener of this.listeners) listener();
  }
}

function isEmptyFolder(opened: OpenedVault): boolean {
  return opened.files.every((file) => APP_STATE_FILES.includes(file.path)) && opened.unreadable.length === 0;
}

/** Reads the opened-times file. A bad file gives an empty map: it is app state, not core data. */
function readOpened(text: string | undefined): Map<Id, string> {
  if (text === undefined) return new Map();
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null) return new Map();
    return new Map(Object.entries(value).filter((entry): entry is [Id, string] => typeof entry[1] === "string"));
  } catch {
    return new Map();
  }
}

/** Files for a new vault: a root item with no text. */
export function newVaultFiles(): { path: string; content: string }[] {
  const rootId = newId();
  const root = { id: rootId, name: "Home", created: new Date().toISOString() };
  return [
    { path: TABLE_FILES.items, content: `${encodeRecordLine("items", root)}\n` },
    { path: textPath(rootId), content: "" },
    // vault.json is last. A folder without it is not yet a vault.
    { path: VAULT_FILE, content: encodeMeta({ format: FORMAT_VERSION, root: rootId }) },
  ];
}
