// Banners for read-only state, conflicts, and problems. See docs/SPEC.md sections 4.3 and 4.4.

import { useState } from "react";
import { useSession, useSessionState } from "./sessionContext";

export function Banners() {
  const session = useSession();
  const state = useSessionState();
  const [problemsOpen, setProblemsOpen] = useState(false);
  const errors = state.problems.filter((problem) => problem.severity === "error");
  const warnings = state.problems.filter((problem) => problem.severity === "warning" && problem.code !== "ghost");

  return (
    <>
      {state.readOnly && (
        <div className="banner error">
          <strong>Read-only.</strong> {state.readOnlyReason}
          {errors.length > 0 && <button onClick={() => setProblemsOpen((open) => !open)}>{`${errors.length} errors`}</button>}
        </div>
      )}
      {state.conflicts.map((conflict) => (
        <div key={conflict.path} className="banner error">
          <div>
            {`${conflict.path} changed outside the app, and the app has unsaved changes to it. The app does not save this file until you decide. The other version goes into history.`}
          </div>
          <div className="row">
            <button className="primary" onClick={() => void session.keepMine(conflict.path)}>Keep the app version</button>
            <button onClick={() => void session.takeTheirs(conflict.path)}>Load the outside version</button>
          </div>
        </div>
      ))}
      {!state.readOnly && errors.length + warnings.length > 0 && !problemsOpen && (
        <div className="banner">
          <div className="row">
            {`${errors.length + warnings.length} problems found in the vault.`}
            <button onClick={() => setProblemsOpen(true)}>Show</button>
          </div>
        </div>
      )}
      {problemsOpen && (
        <div className="banner" style={{ top: 56, maxHeight: "60%", overflow: "auto" }}>
          {[...errors, ...warnings].map((problem, index) => (
            <div key={index}>
              <strong>{problem.severity}</strong> {problem.path ?? ""}
              {problem.line !== undefined ? `:${problem.line}` : ""} {problem.message}
            </div>
          ))}
          <button onClick={() => setProblemsOpen(false)}>Close</button>
        </div>
      )}
    </>
  );
}
