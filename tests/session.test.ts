import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createItemOnBoard, deleteItem, renameItem, writeText } from "../src/core/actions";
import { TABLE_FILES } from "../src/core/format";
import { NotAVaultError, Session } from "../src/io/session";
import { DEFAULT_SETTINGS } from "../src/io/settings";
import { FakeBackend } from "./fakeBackend";
import { DATA_INTEGRITY, IDEAS, readTestVault, ROOT } from "./helpers";

async function openTestVault(): Promise<{ backend: FakeBackend; session: Session }> {
  const backend = new FakeBackend(readTestVault());
  const session = await Session.open(backend, "/vault");
  return { backend, session };
}

describe("session", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("opens the test vault with no errors and is writable", async () => {
    const { session } = await openTestVault();
    expect(session.getState().readOnly).toBe(false);
    expect(session.rootId).toBe(ROOT);
  });

  it("writes only the changed files after the delay", async () => {
    const { backend, session } = await openTestVault();
    session.history.run(renameItem(session.context, IDEAS, "Ideas 2"));
    expect(backend.calls.filter((call) => call.startsWith("write"))).toEqual([]);
    await vi.advanceTimersByTimeAsync(400);
    expect(backend.calls.filter((call) => call.startsWith("write"))).toEqual([`write ${TABLE_FILES.items}`]);
    expect(backend.files.get(TABLE_FILES.items)).toContain('"name":"Ideas 2"');
  });

  it("makes a snapshot before it deletes text, and the file goes to the trash", async () => {
    const { backend, session } = await openTestVault();
    session.history.run(deleteItem(session.context, DATA_INTEGRITY));
    await vi.advanceTimersByTimeAsync(400);
    const snapshotIndex = backend.calls.indexOf("snapshot Before delete");
    const writeIndex = backend.calls.findIndex((call) => call.includes(`items/${DATA_INTEGRITY}.md`));
    expect(snapshotIndex).toBeGreaterThan(-1);
    expect(snapshotIndex).toBeLessThan(writeIndex);
    expect(backend.snapshots[0]!.files.has(`items/${DATA_INTEGRITY}.md`)).toBe(true);
    expect(backend.trash.map((entry) => entry.path)).toEqual([`items/${DATA_INTEGRITY}.md`]);
  });

  it("makes an automatic snapshot after a quiet time", async () => {
    const { backend, session } = await openTestVault();
    writeText(session.store, IDEAS, "new text");
    await vi.advanceTimersByTimeAsync(31_000);
    expect(backend.calls).toContain("snapshot Auto");
  });

  it("writes everything and makes a snapshot on close", async () => {
    const { backend, session } = await openTestVault();
    writeText(session.store, IDEAS, "unsaved");
    await session.close();
    expect(backend.files.get(`items/${IDEAS}.md`)).toBe("unsaved");
    expect(backend.calls).toContain("snapshot Close");
  });

  it("loads an outside change and does not write it back", async () => {
    const { backend, session } = await openTestVault();
    backend.outsideWrite(`items/${IDEAS}.md`, "edited in another editor");
    expect(session.store.get("texts", IDEAS)?.body).toBe("edited in another editor");
    await vi.advanceTimersByTimeAsync(400);
    expect(backend.calls.filter((call) => call.startsWith("write"))).toEqual([]);
  });

  it("takes no change of a different vault (a different window)", async () => {
    const { backend, session } = await openTestVault();
    const before = session.store.get("texts", IDEAS)?.body;
    backend.outsideWrite(`items/${IDEAS}.md`, "a file of a different vault", "/a/different/vault");
    expect(session.store.get("texts", IDEAS)?.body).toBe(before);
  });

  it("loads an outside table change", async () => {
    const { backend, session } = await openTestVault();
    const items = backend.files.get(TABLE_FILES.items)!.replace('"name":"Ideas"', '"name":"Outside name"');
    backend.outsideWrite(TABLE_FILES.items, items);
    expect(session.store.get("items", IDEAS)?.name).toBe("Outside name");
  });

  it("does not load or overwrite a broken outside table", async () => {
    const { backend, session } = await openTestVault();
    backend.outsideWrite(TABLE_FILES.items, "{broken");
    expect(session.store.get("items", IDEAS)?.name).toBe("Ideas");
    session.history.run(renameItem(session.context, IDEAS, "Mine"));
    await vi.advanceTimersByTimeAsync(400);
    expect(backend.files.get(TABLE_FILES.items)).toBe("{broken");
    expect(session.getState().problems).toContainEqual(expect.objectContaining({ code: "bad-json" }));
  });

  it("records a conflict and writes nothing until the user decides", async () => {
    const { backend, session } = await openTestVault();
    writeText(session.store, IDEAS, "mine");
    backend.outsideWrite(`items/${IDEAS}.md`, "theirs");
    await vi.advanceTimersByTimeAsync(400);
    expect(backend.files.get(`items/${IDEAS}.md`)).toBe("theirs");
    expect(session.getState().conflicts).toEqual([{ path: `items/${IDEAS}.md`, theirs: "theirs" }]);

    await session.keepMine(`items/${IDEAS}.md`);
    await vi.advanceTimersByTimeAsync(400);
    expect(backend.files.get(`items/${IDEAS}.md`)).toBe("mine");
    expect(backend.snapshots.at(-1)!.files.get(`items/${IDEAS}.md`)).toBe("theirs");
    expect(session.getState().conflicts).toEqual([]);
  });

  it("can take the outside version of a conflict and keeps the app version in history", async () => {
    const { backend, session } = await openTestVault();
    writeText(session.store, IDEAS, "mine");
    backend.outsideWrite(`items/${IDEAS}.md`, "theirs");
    await session.takeTheirs(`items/${IDEAS}.md`);
    expect(session.store.get("texts", IDEAS)?.body).toBe("theirs");
    expect(backend.snapshots.at(-1)!.files.get(`items/${IDEAS}.md`)).toBe("mine");
  });

  it("opens as read-only when a different window has the lock", async () => {
    const backend = new FakeBackend(readTestVault());
    backend.lockedByOther = true;
    const session = await Session.open(backend, "/vault");
    expect(session.getState().readOnly).toBe(true);
    writeText(session.store, IDEAS, "x");
    await vi.advanceTimersByTimeAsync(400);
    expect(backend.calls.filter((call) => call.startsWith("write"))).toEqual([]);
  });

  it("opens as read-only when the vault has errors", async () => {
    const files = readTestVault();
    files.set(TABLE_FILES.links, `${files.get(TABLE_FILES.links)!}{bad\n`);
    const session = await Session.open(new FakeBackend(files), "/vault");
    expect(session.getState().readOnly).toBe(true);
  });

  it("does not make a vault in a folder without asking", async () => {
    const backend = new FakeBackend();
    await expect(Session.open(backend, "/empty")).rejects.toBeInstanceOf(NotAVaultError);
    expect(backend.files.size).toBe(0);
  });

  it("makes a new vault when asked", async () => {
    const backend = new FakeBackend();
    const session = await Session.open(backend, "/empty", { create: true });
    expect(session.store.get("items", session.rootId)?.name).toBe("Home");
    const { command } = createItemOnBoard(session.context, { boardId: session.rootId, view: "note", x: 0, y: 0 });
    session.history.run(command);
    await vi.advanceTimersByTimeAsync(400);
    expect(backend.files.get(TABLE_FILES.links)).toContain('"kind":"place"');
  });
});

describe("settings", () => {
  it("hide item dates by default, and a change is saved in the vault", async () => {
    const { backend, session } = await openTestVault();
    expect(session.getState().settings.showItemDates).toBe(false);
    await session.updateSettings({ showItemDates: true });
    expect(session.getState().settings.showItemDates).toBe(true);
    expect(JSON.parse(backend.files.get(".inspoboard/settings.json")!)).toEqual({ ...DEFAULT_SETTINGS, showItemDates: true });
    const reopened = await Session.open(backend, "/vault");
    expect(reopened.getState().settings.showItemDates).toBe(true);
  });

  it("use the defaults for a bad settings file", async () => {
    const { readSettings } = await import("../src/io/settings");
    expect(readSettings("{not json")).toEqual(DEFAULT_SETTINGS);
    expect(readSettings('{"showItemDates":"yes"}')).toEqual(DEFAULT_SETTINGS);
  });
});

describe("save now", () => {
  it("writes unsaved changes at once and makes a snapshot", async () => {
    const { backend, session } = await openTestVault();
    writeText(session.store, IDEAS, "saved by Cmd+S");
    await session.saveNow();
    expect(backend.files.get(`items/${IDEAS}.md`)).toBe("saved by Cmd+S");
    expect(backend.calls).toContain("snapshot Save");
  });
});

describe("closed vault", () => {
  it("refuses file access after close, so a late timer cannot open it again", async () => {
    const { backend, session } = await openTestVault();
    await session.close();
    const writesBefore = backend.calls.filter((call) => call.startsWith("write")).length;
    await session.updateSettings({ showItemDates: true });
    expect(backend.calls.filter((call) => call.startsWith("write")).length).toBe(writesBefore);
  });
});
