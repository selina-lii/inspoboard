// Commands, undo, and redo. See docs/SPEC.md section 5.
//
// A command is a list of record operations. The global history holds commands.
// Undo writes each `before` value. Redo writes each `after` value.
// Undo and redo record the values that they replace. Thus a redo after an undo
// restores the exact state, also if a change outside the history occurred
// (for example, an editor text change or a reload from disk).

import type { Store } from "./store";
import type { Id, TableName, TableRecords } from "./types";

export type Op<T extends TableName = TableName> = {
  table: T;
  id: Id;
  before: TableRecords[T] | null;
  after: TableRecords[T] | null;
};

export type Command = {
  label: string;
  ops: Op[];
  /**
   * A view step (no ops): a change of what shows, not of the data (for example, a translation shown in place of
   * the text). Undo and redo call these functions. They never write the store.
   */
  view?: { undo(): void; redo(): void };
};

export function makeOp<T extends TableName>(
  table: T,
  id: Id,
  before: TableRecords[T] | null,
  after: TableRecords[T] | null,
): Op {
  return { table, id, before, after } as Op;
}

export type HistoryListener = () => void;

export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private listeners = new Set<HistoryListener>();

  constructor(private readonly store: Store) {}

  /** Does the command and puts it on the undo stack. A command with no ops does nothing. */
  run(command: Command): void {
    if (command.ops.length === 0) return;
    const written = this.store.write(command.ops.map((op) => ({ table: op.table, id: op.id, after: op.after })));
    this.undoStack.push({ label: command.label, ops: written });
    this.redoStack = [];
    this.notify();
  }

  /** Puts a view step on the undo stack (it is already done). Undo and redo then call its functions. */
  recordView(label: string, view: { undo(): void; redo(): void }): void {
    this.undoStack.push({ label, ops: [], view });
    this.redoStack = [];
    this.notify();
  }

  undo(): Command | undefined {
    const command = this.undoStack.pop();
    if (command === undefined) return undefined;
    if (command.view !== undefined) {
      command.view.undo();
      this.redoStack.push(command);
      this.notify();
      return command;
    }
    const reversed = [...command.ops].reverse();
    const written = this.store.write(reversed.map((op) => ({ table: op.table, id: op.id, after: op.before })));
    // `written` has the values that undo replaced. Redo writes them again.
    const redoOps = written.reverse().map((change) => ({ ...change, before: change.after, after: change.before }));
    this.redoStack.push({ label: command.label, ops: redoOps });
    this.notify();
    return command;
  }

  redo(): Command | undefined {
    const command = this.redoStack.pop();
    if (command === undefined) return undefined;
    if (command.view !== undefined) {
      command.view.redo();
      this.undoStack.push(command);
      this.notify();
      return command;
    }
    const written = this.store.write(command.ops.map((op) => ({ table: op.table, id: op.id, after: op.after })));
    this.undoStack.push({ label: command.label, ops: written });
    this.notify();
    return command;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  nextUndoLabel(): string | undefined {
    return this.undoStack.at(-1)?.label;
  }

  nextRedoLabel(): string | undefined {
    return this.redoStack.at(-1)?.label;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.notify();
  }

  subscribe(listener: HistoryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

/** A command that changes nothing (for example an action that has nothing to do). */
export function emptyCommand(label: string): Command {
  return { label, ops: [] };
}
