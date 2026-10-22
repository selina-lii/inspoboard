// Built-in plugin "Sorting tray" (docs/SPEC.md section 7.16): the tray of a sorting map. It shows on a map board, at the
// bottom left, in the look of the link bench. "Pull" takes X random items out of the tray onto the map (X is a setting).
// The sources of the map and the thrown-away items are listed here too.
// A processing map (SPEC 7.16): "Detach…" (with the size of the scope first), pulls that copy, and its Updates.

import { Check, ChevronDown, ChevronUp, Columns2, GitBranch, Inbox, LifeBuoy, Plus, RotateCcw, Shuffle, Sparkle, X } from "lucide-react";
import { useState } from "react";
import type { Id } from "../../../core/types";
import { TRAY_COUNT_RANGE } from "../../../io/settings";
import { titleOf } from "../../board/boardModel";
import { useRunCommand, useSession, useSessionState, useStoreRevision } from "../../app/sessionContext";
import { useWorkspaceActions } from "../../app/workspaceActions";
import { addSource, canBeSource, discardedItems, isSortingMap, newInTray, pullFromTray, removeSource, restoreToTray, setLostAndFound, sourceName, trayItems } from "./tray";
import { acceptChanges, changedSources } from "../../../core/lineage";
import { asCopies, attachMap, canAttach, detachMap, detachScope, isProcessingMap, referenceCards, textBytes, updatesOf } from "./processing";
import { copyFilesOf } from "./autoCopies";
import { t } from "../../i18n/i18n";
import "./tray.css";

type Props = { boardId: Id; viewCenter(): { x: number; y: number } };

export function TrayPanel({ boardId, viewCenter }: Props) {
  const session = useSession();
  const { readOnly, settings } = useSessionState();
  const runCommand = useRunCommand();
  const actions = useWorkspaceActions();
  useStoreRevision();
  const [open, setOpen] = useState(true);
  const [showThrown, setShowThrown] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showUpdates, setShowUpdates] = useState(true);
  const [showNew, setShowNew] = useState(false);
  /** "Detach…": the scope (items that can be copied, their size in bytes; null while the files are measured). */
  const [detaching, setDetaching] = useState<{ items: number; onMap: number; bytes: number | null } | null>(null);
  if (!settings.tray || !isSortingMap(session, boardId)) return null;

  const map = session.store.get("items", boardId);
  const sources = map?.sources ?? [];
  const lostAndFound = map?.lostAndFound === true;
  const waiting = trayItems(session, boardId, session.rootId);
  const thrown = discardedItems(session, boardId);
  const count = settings.trayCount;

  const processing = isProcessingMap(session, boardId);
  // New in the sources since the last visit of this map (made after it).
  const fresh = newInTray(session, boardId, session.openedBeforeAt(boardId), session.rootId);
  const updates = updatesOf(session, boardId);
  const pull = (only?: readonly Id[]) => {
    const { command, placeIds } = pullFromTray(session.context, boardId, count, viewCenter(), Math.random, session.rootId, only);
    if (placeIds.length === 0) return;
    // A processing map that does not wait for the first edit: the pulled cards are copies at once.
    if (processing && settings.detachCopies !== "edit") {
      const copies = asCopies(session.context, command);
      if (runCommand(copies.command)) copyFilesOf(session, copies.copied);
      return;
    }
    runCommand(command);
  };
  const askDetach = () => {
    const scope = detachScope(session, boardId, session.rootId);
    const onMap = referenceCards(session, boardId).length;
    const texts = textBytes(session, scope);
    setDetaching({ items: scope.length, onMap, bytes: null });
    session
      .itemFilesSize(scope)
      .then((files) => setDetaching((current) => (current === null ? null : { ...current, bytes: texts + files })))
      .catch(() => setDetaching((current) => (current === null ? null : { ...current, bytes: texts })));
  };
  const detach = () => {
    const { command, copied } = detachMap(session.context, boardId, settings.detachCopies);
    if (runCommand(command)) copyFilesOf(session, copied);
    setDetaching(null);
  };
  const add = async () => {
    setMessage(null);
    const sourceId = await actions.pickItem({ title: "Add a source (a collection)…" });
    if (sourceId === null) return;
    if (!canBeSource(session, sourceId)) {
      setMessage("A source must be a collection: an item with its own board. (A calendar or an outline: right-click its frame.)");
      return;
    }
    runCommand(addSource(session.context, boardId, sourceId));
  };

  if (!open) {
    return (
      <button className="sorting-tray folded" data-tip="Sorting tray: open it" onClick={() => setOpen(true)}>
        <Inbox size={18} />
        <span className="sorting-tray-badge">{waiting.length}</span>
        {fresh.length > 0 && <span className="sorting-tray-new-dot" aria-label={t("{0} new", fresh.length)} />}
      </button>
    );
  }
  return (
    <div className="sorting-tray open" role="dialog" aria-label="Sorting tray">
      <div className="sorting-tray-head">
        <Inbox size={14} />
        <span className="sorting-tray-title">Sorting tray</span>
        {processing && (
          <span className="sorting-tray-chip processing" data-tip="A processing map: its cards are copies, and the originals stay as they are">
            <GitBranch size={11} />
            <span>Processing</span>
          </span>
        )}
        {processing && !readOnly && canAttach(session, boardId) && (
          <button className="sorting-tray-attach" data-tip="No card is copied yet: the map can be a sorting map again" onClick={() => runCommand(attachMap(session.context, boardId))}>
            Attach again
          </button>
        )}
        <span className="muted sorting-tray-count">{`${waiting.length} in the tray`}</span>
        {!processing && !readOnly && detaching === null && (
          <button className="icon-button small" data-tip="Detach: make this a processing map (its cards become copies)…" onClick={askDetach}>
            <GitBranch size={14} />
          </button>
        )}
        <button className="icon-button small" data-tip="Fold the tray" onClick={() => setOpen(false)}>
          <ChevronDown size={14} />
        </button>
      </div>
      <div className="sorting-tray-body">
        {detaching !== null && (
          <div className="sorting-tray-detach" role="group" aria-label="Detach the map">
            <span>Detach: the cards become the map’s own copies. The originals stay as they are.</span>
            <span className="muted">
              {detaching.bytes === null
                ? t("Up to {0} items can be copied (measuring their size…).", detaching.items)
                : t("Up to {0} items, about {1}, can be copied.", detaching.items, formatBytes(detaching.bytes))}
            </span>
            <span className="sorting-tray-detach-warning">After the first copy, you cannot attach the map again. Until then, “Attach again” in the tray takes the detach back.</span>
            {settings.detachCopies === "all" && detaching.onMap > 0 && <span className="muted">{t("The {0} cards on the map are copied now.", detaching.onMap)}</span>}
            <div className="sorting-tray-detach-buttons">
              <button className="primary" onClick={detach}>
                Detach
              </button>
              <button onClick={() => setDetaching(null)}>Cancel</button>
            </div>
          </div>
        )}        <div className="sorting-tray-pull">
          <button className="primary" disabled={readOnly || waiting.length === 0} data-tip="Take random items out of the tray onto the map (⌘Z puts them back)" onClick={() => pull()}>
            <Shuffle size={14} /> {`Pull ${Math.min(count, waiting.length)}`}
          </button>
          <label className="sorting-tray-number" data-tip="How many items each Pull takes">
            <span>Each time</span>
            <input
              type="number"
              min={TRAY_COUNT_RANGE.min}
              max={TRAY_COUNT_RANGE.max}
              value={count}
              onChange={(event) => {
                const value = Math.round(Number(event.target.value));
                if (Number.isFinite(value)) void session.updateSettings({ trayCount: Math.min(TRAY_COUNT_RANGE.max, Math.max(TRAY_COUNT_RANGE.min, value)) });
              }}
            />
          </label>
        </div>
        {fresh.length > 0 && (
          <div className="sorting-tray-new">
            <button className="sorting-tray-thrown-head" onClick={() => setShowNew((value) => !value)}>
              {showNew ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              <Sparkle size={12} />
              <span>{t("New ({0}): added to the sources since your last visit", fresh.length)}</span>
            </button>
            {!readOnly && (
              <button className="sorting-tray-pull-new" data-tip="Take the new items first" onClick={() => pull(fresh)}>
                {t("Pull new ({0})", Math.min(count, fresh.length))}
              </button>
            )}
          </div>
        )}
        {showNew && fresh.length > 0 && (
          <ul className="sorting-tray-thrown">
            {fresh.map((itemId) => (
              <li key={itemId}>
                <span translate="no" dir="auto">{titleOf(session.store, itemId)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="sorting-tray-section">
          <span className="sorting-tray-label">Sources</span>
          {sources.map((sourceId) => (
            <span key={sourceId} className="sorting-tray-chip">
              <span translate="no" dir="auto">{sourceName(session, sourceId) || (session.store.has("items", sourceId) || session.store.has("outlines", sourceId) ? "Untitled" : "Missing")}</span>
              {!readOnly && (
                <button className="icon-button small" data-tip="Remove this source (its cards on the map stay)" onClick={() => runCommand(removeSource(session.context, boardId, sourceId))}>
                  <X size={11} />
                </button>
              )}
            </span>
          ))}
          {lostAndFound && (
            <span className="sorting-tray-chip lost">
              <LifeBuoy size={11} />
              <span>Lost and found</span>
              {!readOnly && (
                <button className="icon-button small" data-tip="Remove this source (its cards on the map stay)" onClick={() => runCommand(setLostAndFound(session.context, boardId, false))}>
                  <X size={11} />
                </button>
              )}
            </span>
          )}
          {!readOnly && (
            <button className="icon-button small" data-tip="Add a source (a collection)…" onClick={() => void add()}>
              <Plus size={13} />
            </button>
          )}
          {!readOnly && !lostAndFound && (
            <button className="icon-button small" data-tip="Add “Lost and found”: the items that no board shows (in the trash, or on a board that is on no board)" onClick={() => runCommand(setLostAndFound(session.context, boardId, true))}>
              <LifeBuoy size={13} />
            </button>
          )}
        </div>
        {processing && (
          <>
            <button className="sorting-tray-thrown-head" disabled={updates.length === 0} onClick={() => setShowUpdates((value) => !value)}>
              {showUpdates ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              <span>{`Updates (${updates.length})`}</span>
            </button>
            {showUpdates && updates.length > 0 && (
              <ul className="sorting-tray-thrown">
                {updates.map((itemId) => {
                  const changed = changedSources(session.store, itemId);
                  return (
                    <li key={itemId}>
                      <span translate="no" dir="auto" data-tip={t("Changed: {0}", changed.map((id) => titleOf(session.store, id)).join(", "))}>
                        {titleOf(session.store, itemId)}
                      </span>
                      <button
                        className="icon-button small"
                        data-tip="Open both: this item and its changed source"
                        onClick={() => {
                          for (const sourceId of changed) actions.openText(sourceId);
                          actions.openText(itemId);
                        }}
                      >
                        <Columns2 size={12} />
                      </button>
                      {!readOnly && (
                        <button className="icon-button small" data-tip="Same meaning: accept the change (this item does not change)" onClick={() => runCommand(acceptChanges(session.context, [itemId]))}>
                          <Check size={12} />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
        <button className="sorting-tray-thrown-head" disabled={thrown.length === 0} onClick={() => setShowThrown((value) => !value)}>
          {showThrown ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          <span>{`Thrown away (${thrown.length})`}</span>
        </button>
        {showThrown && thrown.length > 0 && (
          <ul className="sorting-tray-thrown">
            {thrown.map((itemId) => (
              <li key={itemId}>
                <span translate="no" dir="auto">{titleOf(session.store, itemId)}</span>
                {!readOnly && (
                  <button className="icon-button small" data-tip="Restore: back into the tray" onClick={() => runCommand(restoreToTray(session.context, boardId, [itemId]))}>
                    <RotateCcw size={12} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {message !== null && <div className="sorting-tray-message">{message}</div>}
    </div>
  );
}

/** A size for people: "820 KB", "96 MB", "1.4 GB". */
function formatBytes(bytes: number): string {
  if (bytes < 1e6) return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
  if (bytes < 1e9) return `${Math.round(bytes / 1e6)} MB`;
  return `${(bytes / 1e9).toFixed(1)} GB`;
}
