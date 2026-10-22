// The core of a radial graph on a board (docs/SPEC.md section 7.17): a light red circle with its text in white.
// Its cards are child nodes around it (boardModel.ts puts them in place): a drag of the core moves them all.
// Double-click the core to write its text (the text is the only content of a core).

import type { NodeProps } from "@xyflow/react";
import { TitleInput, useBoardCallbacks, type FlowNode } from "./nodes";

export function RadialNode({ data, selected }: NodeProps<FlowNode>) {
  const { node } = data;
  const callbacks = useBoardCallbacks();
  const radialId = node.outlineId;
  return (
    <div
      className={`radial-core${selected ? " selected" : ""}${data.dropTarget === true ? " drop-target" : ""}`}
      style={{ width: node.w, height: node.h }}
      data-tip={data.editing === "title" ? undefined : "Drag: move the radial with its cards · drop a card here to add it · double-click: write the core"}
      onDoubleClick={(event) => {
        if (callbacks.readOnly || radialId === null) return;
        event.stopPropagation();
        callbacks.onStartEdit(node.id, "title");
      }}
    >
      {data.editing === "title" && radialId !== null ? (
        <TitleInput node={node} value={node.groupName} placeholder="Core" onCommit={(name) => callbacks.onRenameGroup(radialId, name)} />
      ) : (
        <span className={`radial-core-text${node.groupName === "" ? " untitled" : ""}`} dir="auto">
          {node.groupName !== "" ? node.groupName : "Core"}
        </span>
      )}
    </div>
  );
}
