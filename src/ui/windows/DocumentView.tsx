// Document view of an outline: all its items as one continuous text, in outline order (like a cascade of notes).
// Each item keeps its own text and its own undo stack. Only the view is continuous.

import { useEffect, useRef } from "react";
import { renameItem } from "../../core/actions";
import { outlineRows } from "../../core/outline";
import type { Id } from "../../core/types";
import { CommitField } from "../app/fields";
import { useRunCommand, useSession, useSessionState, useStoreRevision } from "../app/sessionContext";
import { TextEditor } from "../editor/TextEditor";
import "./windows.css";

/** Indent of one outline level in the document. */
const LEVEL_INDENT = 28;

export function DocumentView({ outlineId, focusItemId }: { outlineId: Id; focusItemId: Id | null }) {
  const session = useSession();
  const { readOnly } = useSessionState();
  const runCommand = useRunCommand();
  useStoreRevision();
  const rows = outlineRows(session.store, session.graph, outlineId);
  const sections = useRef(new Map<Id, HTMLElement>());

  // Start at the item that was open.
  useEffect(() => {
    if (focusItemId !== null) sections.current.get(focusItemId)?.scrollIntoView({ block: "start" });
  }, [focusItemId]);

  if (rows.length === 0) return <div className="document-view muted">This outline has no items.</div>;
  return (
    <div className="document-view">
      <div className="document-column">
        {rows.map((row) => {
          const item = session.store.get("items", row.recordId);
          if (item === undefined) return null;
          const heading = row.depth === 0 ? "document-title" : "document-title sub";
          return (
            <section
              key={row.placeId}
              className="document-section"
              style={{ marginLeft: row.depth * LEVEL_INDENT }}
              ref={(element) => {
                if (element === null) sections.current.delete(row.recordId);
                else sections.current.set(row.recordId, element);
              }}
            >
              <div className={heading}>
                {row.marker !== "" && <span className="outline-marker">{row.marker}</span>}
                <CommitField
                  className={`document-title-input${item.codeName === true ? " code-name" : ""}`}
                  value={item.name}
                  placeholder="Untitled"
                  disabled={readOnly}
                  // A note can have no name. Other items get a code.
                  onCommit={(name) => runCommand(renameItem(session.context, item.id, name.trim(), { allowEmpty: true }))}
                />
              </div>
              <TextEditor itemId={item.id} readOnly={readOnly} />
            </section>
          );
        })}
      </div>
    </div>
  );
}
