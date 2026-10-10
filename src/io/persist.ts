// Save cycle. See docs/SPEC.md section 4.2.
//
// - The persister listens to store changes and marks files as dirty.
// - After a short quiet time, it writes the dirty files.
// - After a long quiet time, it makes a history snapshot.
// - Before it deletes body text, it makes a snapshot first.

import { encodeTable, LINE_TABLES, TABLE_FILES, textPath, type LineTable } from "../core/format";
import type { Change, Store } from "../core/store";
import type { FileWrite, VaultAccess } from "./backend";

export const WRITE_DELAY_MS = 300;
export const SNAPSHOT_DELAY_MS = 30_000;

export type PersistStatus = "saved" | "pending" | "saving" | "error";

export type PersistEvents = {
  onStatus(status: PersistStatus, error?: string): void;
};

export class Persister {
  private dirty = new Set<string>();
  /** Paths with a conflict. The persister does not write them until the user decides. */
  private blocked = new Set<string>();
  private paused = 0;
  private writeTimer: ReturnType<typeof setTimeout> | undefined;
  private snapshotTimer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | null = null;
  private unsubscribe: () => void;
  private snapshotNeeded = false;

  constructor(
    private readonly store: Store,
    private readonly backend: VaultAccess,
    private readonly events: PersistEvents,
  ) {
    this.unsubscribe = store.subscribe((changes) => this.onChanges(changes));
  }

  /** Runs the function without a save of its changes. Use it to apply data that came from disk. */
  withoutSave(apply: () => void): void {
    this.paused += 1;
    try {
      apply();
    } finally {
      this.paused -= 1;
    }
  }

  isDirty(path: string): boolean {
    return this.dirty.has(path);
  }

  block(path: string): void {
    this.blocked.add(path);
  }

  /** Removes the block. If `save` is true, the store version is written. */
  unblock(path: string, save: boolean): void {
    this.blocked.delete(path);
    if (save) this.markDirty(path);
    else this.dirty.delete(path);
  }

  /** Writes all dirty files now. */
  async flush(): Promise<void> {
    clearTimeout(this.writeTimer);
    // Wait for a running write. Then write what is still dirty.
    while (this.running !== null) await this.running;
    const paths = [...this.dirty].filter((path) => !this.blocked.has(path));
    if (paths.length === 0) return;
    this.running = this.write(paths);
    try {
      await this.running;
    } finally {
      this.running = null;
    }
  }

  async snapshot(message: string): Promise<void> {
    await this.flush();
    await this.backend.snapshot(message);
    this.snapshotNeeded = false;
  }

  /** Writes all files and makes a snapshot. Call this before the app closes. */
  async close(): Promise<void> {
    // Save first. If the save fails, the persister stays active: the user can keep the window open and go on.
    await this.flush();
    clearTimeout(this.snapshotTimer);
    this.unsubscribe();
    // A change can come while the first flush runs. Write it too.
    await this.flush();
    if (this.snapshotNeeded) await this.backend.snapshot("Close");
  }

  private onChanges(changes: readonly Change[]): void {
    if (this.paused > 0) return;
    for (const change of changes) this.markDirty(pathOfChange(change));
  }

  private markDirty(path: string): void {
    this.dirty.add(path);
    this.events.onStatus("pending");
    clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => void this.flushAndReport(), WRITE_DELAY_MS);
  }

  private async flushAndReport(): Promise<void> {
    try {
      await this.flush();
    } catch {
      // write() reported the error already.
    }
  }

  private async write(paths: string[]): Promise<void> {
    this.events.onStatus("saving");
    const writes = paths.map((path): FileWrite => ({ path, content: this.contentOf(path) }));
    try {
      if (writes.some((write) => write.content === null)) {
        // The files on disk still have the text. Save them in history before the delete.
        await this.backend.snapshot("Before delete");
      }
      await this.backend.writeFiles(writes);
      for (const write of writes) {
        if (this.contentOf(write.path) === write.content) this.dirty.delete(write.path);
      }
      this.snapshotNeeded = true;
      this.scheduleSnapshot();
      this.events.onStatus(this.dirty.size > 0 ? "pending" : "saved");
    } catch (error) {
      // The files stay dirty. The next change or flush tries again.
      this.events.onStatus("error", String(error));
      throw error;
    }
  }

  private scheduleSnapshot(): void {
    clearTimeout(this.snapshotTimer);
    this.snapshotTimer = setTimeout(() => {
      void this.backend.snapshot("Auto").then(
        () => (this.snapshotNeeded = false),
        (error: unknown) => this.events.onStatus("error", String(error)),
      );
    }, SNAPSHOT_DELAY_MS);
  }

  private contentOf(path: string): string | null {
    const table = tableOfPath(path);
    if (table !== null) return encodeTable(this.store, table);
    const id = path.slice("items/".length, -".md".length);
    return this.store.get("texts", id)?.body ?? null;
  }
}

export function pathOfChange(change: Change): string {
  return change.table === "texts" ? textPath(change.id) : TABLE_FILES[change.table];
}

export function tableOfPath(path: string): LineTable | null {
  return LINE_TABLES.find((table) => TABLE_FILES[table] === path) ?? null;
}
