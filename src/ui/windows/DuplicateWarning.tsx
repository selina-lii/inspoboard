// A warning under the head of a text page or an editor window: the text can be a copy of a different item
// (the same first sentence, see core/duplicates.ts). "Open" shows the other item. The X hides the warning
// for this text until the app closes.

import { Copy, X } from "lucide-react";
import { useMemo, useState } from "react";
import { findDuplicates, firstSentence } from "../../core/duplicates";
import type { Id } from "../../core/types";
import { useSession } from "../app/sessionContext";
import { useWorkspaceActions } from "../app/workspaceActions";

/** Dismissed warnings: item ID + first sentence. */
const dismissed = new Set<string>();

export function DuplicateWarning({ itemId }: { itemId: Id }) {
  const session = useSession();
  const actions = useWorkspaceActions();
  const [, setRevision] = useState(0);
  const body = session.store.get("texts", itemId)?.body ?? "";
  const sentence = firstSentence(body);
  // Only a change of the first sentence searches again.
  const others = useMemo(() => (sentence === null ? [] : findDuplicates(session.store, itemId, body)), [sentence, itemId, session]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = `${itemId}\u0000${sentence ?? ""}`;
  if (others.length === 0 || dismissed.has(key)) return null;
  const other = others[0]!;
  const name = session.store.get("items", other)?.name || "an item without a name";
  return (
    <div className="duplicate-warning" role="status">
      <Copy size={13} />
      <span>
        {others.length > 1 ? `This text can be a copy: ${others.length} items have the same first sentence.` : `This text can be a copy: “${name}” has the same first sentence.`}
      </span>
      <button onClick={() => actions.openText(other)}>Open</button>
      <button
        className="icon-button small"
        data-tip="Hide this warning"
        data-tip-end
        onClick={() => {
          dismissed.add(key);
          setRevision((value) => value + 1);
        }}
      >
        <X size={13} />
      </button>
    </div>
  );
}
