// Tables in memory. The store is the single source of truth while the app runs.
// The store does not know about undo. See commands.ts for undo and redo.

import type { Id, TableName, TableRecords } from "./types";

/** One change to one record. `before: null` is a create. `after: null` is a delete. */
export type Change<T extends TableName = TableName> = {
  table: T;
  id: Id;
  before: TableRecords[T] | null;
  after: TableRecords[T] | null;
};

export type ChangeListener = (changes: readonly Change[]) => void;

type Tables = { [T in TableName]: Map<Id, TableRecords[T]> };

function emptyTables(): Tables {
  return { items: new Map(), texts: new Map(), links: new Map(), stamps: new Map(), outlines: new Map() };
}

export class Store {
  private tables: Tables = emptyTables();
  private listeners = new Set<ChangeListener>();
  private revision = 0;

  /** Increases by one after each write. Views use it to detect changes. */
  getRevision(): number {
    return this.revision;
  }

  get<T extends TableName>(table: T, id: Id): TableRecords[T] | undefined {
    return this.tables[table].get(id);
  }

  has(table: TableName, id: Id): boolean {
    return this.tables[table].has(id);
  }

  all<T extends TableName>(table: T): IterableIterator<TableRecords[T]> {
    return this.tables[table].values();
  }

  count(table: TableName): number {
    return this.tables[table].size;
  }

  /**
   * Sets each record to its `after` value, in order.
   * Returns the changes with the true `before` values that were replaced.
   * Callers must use this function for all writes.
   */
  write(entries: readonly { table: TableName; id: Id; after: TableRecords[TableName] | null }[]): Change[] {
    const changes: Change[] = [];
    for (const entry of entries) {
      changes.push(this.writeOne(entry.table, entry.id, entry.after));
    }
    if (changes.length > 0) {
      this.revision += 1;
      this.notify(changes);
    }
    return changes;
  }

  subscribe(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private writeOne(table: TableName, id: Id, after: TableRecords[TableName] | null): Change {
    const map = this.tables[table] as Map<Id, TableRecords[TableName]>;
    if (after !== null && after.id !== id) {
      throw new Error(`Record ID "${after.id}" does not agree with key "${id}" in table "${table}".`);
    }
    const before = map.get(id) ?? null;
    if (after === null) {
      map.delete(id);
    } else {
      map.set(id, freezeCopy(after));
    }
    return { table, id, before, after: after === null ? null : (map.get(id) ?? null) };
  }

  private notify(changes: readonly Change[]): void {
    for (const listener of this.listeners) {
      listener(changes);
    }
  }
}

/** Records in the store are frozen copies. Thus no caller can change them without a write. */
function freezeCopy<R extends object>(record: R): R {
  const copy = structuredClone(record);
  for (const value of Object.values(copy)) {
    if (typeof value === "object" && value !== null) Object.freeze(value);
  }
  return Object.freeze(copy);
}
