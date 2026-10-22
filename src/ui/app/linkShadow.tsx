// A shadow of the other end of a passage link (SPEC 7.11): a faint card next to the linked passage of an item, with
// a curve to the passage. A click goes to the other item at its passage (the exact place). The unlink button (on
// hover) removes the link (a text link in the source text becomes its words).

import { CornerDownRight, Eye, EyeOff, Unlink } from "lucide-react";
import type { CSSProperties } from "react";
import { unlinkPassage, type LinkedPassage } from "../../core/linkEnds";
import { updateRelation } from "../../core/actions";
import { titleOf } from "../board/boardModel";
import { kindIcon } from "../tools/registry";
import { useRunCommand, useSession, useSessionState } from "./sessionContext";
import { useWorkspaceActions } from "./workspaceActions";

const shorten = (text: string, length: number) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);

export function LinkShadow({ passage, style }: { passage: LinkedPassage; style?: CSSProperties }) {
  const session = useSession();
  const { readOnly } = useSessionState();
  const runCommand = useRunCommand();
  const actions = useWorkspaceActions();
  const view = session.graph.homeOf(passage.otherId)?.view ?? "note";
  const Icon = kindIcon(view);
  const link = session.store.get("links", passage.linkId);
  const onBoard = link?.kind === "link" && link.onBoard === true;
  const go = () => actions.openAt(passage.otherId, passage.otherQuote !== null ? { quote: passage.otherQuote } : {});
  return (
    <div className="link-shadow" data-link-id={passage.linkId} style={style}>
      <button className="link-shadow-body" data-tip="Go to the linked place" onClick={go}>
        <span className="link-shadow-head">
          <CornerDownRight size={11} />
          <Icon size={11} />
          <span className="link-shadow-title" translate="no" dir="auto">
            {titleOf(session.store, passage.otherId)}
          </span>
        </span>
        {passage.otherQuote !== null && passage.otherQuote !== "" && (
          <span className="link-shadow-quote" translate="no" dir="auto">
            “{shorten(passage.otherQuote, 120)}”
          </span>
        )}
      </button>
      {!readOnly && (
        // Off by default: a link made from text shows only in its items. On: also on boards and in the galaxy.
        <button
          className={`icon-button small link-shadow-board${onBoard ? " active" : ""}`}
          data-tip={onBoard ? "Shown on boards: click to show it only here" : "Show this link on boards too (a dashed line)"}
          data-tip-end
          onClick={() => runCommand(updateRelation(session.context, passage.linkId, { onBoard: !onBoard }))}
        >
          {onBoard ? <Eye size={11} /> : <EyeOff size={11} />}
        </button>
      )}
      {!readOnly && (
        <button className="icon-button small link-shadow-unlink" data-tip="Remove the link" data-tip-end onClick={() => runCommand(unlinkPassage(session.context, passage.linkId))}>
          <Unlink size={11} />
        </button>
      )}
    </div>
  );
}
