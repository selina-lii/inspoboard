// The outline frame on a board (docs/SPEC.md section 7.6): its bar (name, list style, document) around its rows.
// A selected frame has handles at its left and right sides: drag one to change the width.
// The rows are card nodes (boardModel.ts puts them in place).

import { NodeResizer, type NodeProps } from "@xyflow/react";
import {
  BookOpen,
  GripHorizontal,
  ScrollText,
  } from "lucide-react";
import { roundBoard } from "../../core/stamps";
import { type FlowNode, useBoardCallbacks, LIST_BUTTONS, GroupName } from "./nodes";

/**
 * The frame of an outline. Drag the frame to move the outline with all its cards.
 * Its bar has the list style and "read as one document". Right-click the frame for more.
 */
export function OutlineNode({ data, selected }: NodeProps<FlowNode>) {
  const { node } = data;
  const callbacks = useBoardCallbacks();
  const outlineId = node.outlineId;
  return (
    <div className={`outline-frame${selected ? " selected" : ""}${data.dropTarget === true ? " drop-target" : ""}`}>
      {outlineId !== null && !callbacks.readOnly && <OutlineWidthHandles outlineId={outlineId} width={node.w} visible={selected} />}
      <div className="outline-bar">
        <GripHorizontal size={14} className="outline-grip" />
        <BookOpen size={13} className="group-icon outline" />
        <GroupName data={data} />
        {outlineId !== null && !callbacks.readOnly && (
          <span className="outline-tools nodrag">
            {LIST_BUTTONS.map(({ value, icon: Icon, tip }) => (
              <button
                key={value ?? "none"}
                className={`icon-button small${node.list === value ? " active" : ""}`}
                data-tip={tip}
                onClick={(event) => {
                  event.stopPropagation();
                  callbacks.onOutlineList(outlineId, value);
                }}
              >
                <Icon size={12} />
              </button>
            ))}
            <button
              className="icon-button small"
              data-tip="Read as one document"
              onClick={(event) => {
                event.stopPropagation();
                callbacks.onOutlineDocument(outlineId);
              }}
            >
              <ScrollText size={12} />
            </button>

          </span>
        )}
      </div>
    </div>
  );
}

/** Resize handles at the left and right of a selected outline frame. Only the width changes: the rows give the height. */
function OutlineWidthHandles({ outlineId, width, visible }: { outlineId: string; width: number; visible: boolean }) {
  const callbacks = useBoardCallbacks();
  return (
    <NodeResizer
      isVisible={visible}
      minWidth={120}
      lineClassName="resize-line"
      handleClassName="resize-handle"
      shouldResize={(_, params) => params.direction[0] !== 0}
      onResizeEnd={(_, params) => callbacks.onOutlineWidth(outlineId, width, roundBoard(params.width))}
    />
  );
}
