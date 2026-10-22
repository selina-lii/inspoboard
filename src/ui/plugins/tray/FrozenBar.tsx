// The soft freeze of a lineage (SPEC 7.16): a bar under the head of a text page or an editor window when the item was
// processed further (items were made from it). It names the newest versions to edit instead.
// - "Edit here anyway" hides the bar for this item until the app closes.
// - After a change here, the items made directly from it are outdated: the bar names them, with "Same meaning".

import { GitBranch, X } from "lucide-react";
import { useState } from "react";
import { acceptChanges, changedSources, madeIndex, newestOf } from "../../../core/lineage";
import type { Id } from "../../../core/types";
import { useRunCommand, useSession, useSessionState, useStoreRevision } from "../../app/sessionContext";
import { useWorkspaceActions } from "../../app/workspaceActions";
import { titleOf } from "../../board/boardModel";
import { t } from "../../i18n/i18n";

/** Items whose bar the user closed ("Edit here anyway"), for this app session. */
const editHere = new Set<Id>();

export function FrozenBar({ itemId }: { itemId: Id }) {
  const session = useSession();
  const { settings, readOnly } = useSessionState();
  const actions = useWorkspaceActions();
  const runCommand = useRunCommand();
  const [, setRevision] = useState(0);
  useStoreRevision();
  if (!settings.tray) return null;
  const index = madeIndex(session.store);
  const made = index.get(itemId) ?? [];
  if (made.length === 0) return null;
  // The items made directly from this one that this item's change made outdated.
  const outdated = made.filter((id) => changedSources(session.store, id).includes(itemId));
  if (editHere.has(itemId)) {
    if (outdated.length === 0) return null;
    return (
      <div className="duplicate-warning frozen-bar" role="status">
        <GitBranch size={13} />
        <span>{t("Changed here: {0} made from this are outdated now ({1}).", outdated.length, outdated.map((id) => titleOf(session.store, id)).join(", "))}</span>
        {!readOnly && (
          <button data-tip="The change does not change the meaning: the items made from this stay up to date" onClick={() => runCommand(acceptChanges(session.context, outdated, [itemId]))}>
            Same meaning
          </button>
        )}
      </div>
    );
  }
  const newest = newestOf(session.store, itemId, index).slice(0, 4);
  return (
    <div className="duplicate-warning frozen-bar" role="status">
      <GitBranch size={13} />
      <span>This was processed further. Edit the newest version?</span>
      {newest.map((id) => (
        <button key={id} translate="no" dir="auto" onClick={() => actions.openText(id)}>
          {titleOf(session.store, id)}
        </button>
      ))}
      <button
        className="icon-button small"
        data-tip="Edit here anyway (the items made from this become outdated)"
        data-tip-end
        onClick={() => {
          editHere.add(itemId);
          setRevision((value) => value + 1);
        }}
      >
        <X size={13} />
      </button>
    </div>
  );
}
