// A backend that keeps files in memory. It records each call.

import type { Backend, FileChange, FileWrite, OpenedVault } from "../src/io/backend";
import type { VaultFiles } from "../src/core/format";

export class FakeBackend implements Backend {
  files: VaultFiles;
  calls: string[] = [];
  /** Each snapshot keeps a copy of the files. */
  snapshots: { message: string; files: VaultFiles }[] = [];
  trash: { path: string; content: string }[] = [];
  lockedByOther = false;
  private listeners = new Set<(change: FileChange) => void>();

  constructor(files: VaultFiles = new Map()) {
    this.files = new Map(files);
  }

  async openVault(path: string): Promise<OpenedVault> {
    this.calls.push("open");
    const files = [...this.files].map(([filePath, content]) => ({ path: filePath, content }));
    return { root: path, lockedByOther: this.lockedByOther, files, unreadable: [] };
  }

  async closeVault(): Promise<void> {
    this.calls.push("close");
  }

  async writeFiles(_root: string, writes: FileWrite[]): Promise<void> {
    this.calls.push(`write ${writes.map((write) => write.path).join(",")}`);
    for (const write of writes) {
      if (write.content === null) {
        const old = this.files.get(write.path);
        if (old !== undefined) this.trash.push({ path: write.path, content: old });
        this.files.delete(write.path);
      } else {
        this.files.set(write.path, write.content);
      }
    }
  }

  async snapshot(_root: string, message: string): Promise<string | null> {
    this.calls.push(`snapshot ${message}`);
    this.snapshots.push({ message, files: new Map(this.files) });
    return String(this.snapshots.length);
  }

  revealed: string[] = [];
  async revealFile(path: string): Promise<void> {
    this.revealed.push(path);
  }

  async exportBundle(): Promise<string> {
    throw new Error("No bundles in tests.");
  }

  async readBundle(): Promise<{ files: Record<string, string>; images: string[] }> {
    throw new Error("No bundles in tests.");
  }

  async importBundleImages(): Promise<Record<string, string>> {
    return {};
  }

  browsed: string[] = [];
  async menuTexts(): Promise<{ id: string; text: string }[]> {
    return [];
  }

  async setMenuTexts(): Promise<void> {}

  async openInBrowser(url: string): Promise<void> {
    this.browsed.push(url);
  }

  backups: string[] = [];
  async backupVault(root: string): Promise<{ path: string; bytes: number; files: number }> {
    const path = `${root}/.backup/${this.backups.length + 1}`;
    this.backups.push(path);
    return { path, bytes: 0, files: 0 };
  }

  async listSnapshots(): Promise<{ id: string; message: string; time: number }[]> {
    return [];
  }

  async startupVault(): Promise<string | null> {
    return null;
  }

  async chooseFolder(): Promise<string | null> {
    return null;
  }

  /** Images of the vault: path -> bytes. */
  images = new Map<string, ArrayBuffer>();

  async chooseImage(): Promise<string | null> {
    return null;
  }

  async importImage(_root: string, source: string): Promise<string> {
    const path = `images/${source.split("/").at(-1) ?? "image.png"}`;
    this.images.set(path, new ArrayBuffer(4));
    return path;
  }

  async saveImageBytes(_root: string, name: string, bytes: Uint8Array): Promise<string> {
    const path = `images/${name}`;
    this.images.set(path, bytes.slice().buffer);
    return path;
  }

  async readImage(_root: string, path: string): Promise<ArrayBuffer> {
    const bytes = this.images.get(path);
    if (bytes === undefined) throw new Error(`No image ${path}.`);
    return bytes;
  }

  /** Web files of the vault: path -> text. */
  web = new Map<string, string>();
  /** Export files: name -> text. */
  exports = new Map<string, string>();

  async readWebFile(_root: string, path: string): Promise<string | null> {
    return this.web.get(path) ?? null;
  }

  async writeWebFile(_root: string, path: string, content: string): Promise<void> {
    this.web.set(path, content);
  }

  /** Binary web files (PDFs): path -> bytes. */
  webBytes = new Map<string, Uint8Array>();

  async readWebBytes(_root: string, path: string): Promise<ArrayBuffer> {
    const bytes = this.webBytes.get(path);
    if (bytes === undefined) throw new Error(`No file ${path}.`);
    return bytes.slice().buffer;
  }

  async writeWebBytes(_root: string, path: string, bytes: Uint8Array): Promise<void> {
    this.webBytes.set(path, bytes);
  }

  async choosePdf(): Promise<string | null> {
    return null;
  }

  async importPdf(): Promise<string> {
    return "0".repeat(24);
  }

  async exportText(defaultName: string, content: string): Promise<string | null> {
    this.exports.set(defaultName, content);
    return defaultName;
  }

  async onFileChange(listener: (change: FileChange) => void): Promise<() => void> {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async onCloseRequested(): Promise<() => void> {
    return () => undefined;
  }

  async onMenu(): Promise<() => void> {
    return () => undefined;
  }

  /** Simulates a change from a different program. */
  outsideWrite(path: string, content: string | null): void {
    if (content === null) this.files.delete(path);
    else this.files.set(path, content);
    for (const listener of this.listeners) listener({ path, content, unreadable: false });
  }
}
