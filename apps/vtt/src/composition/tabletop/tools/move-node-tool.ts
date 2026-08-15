import type { ConstructionTool, PointerSample, ToolContext, ToolGesture } from "./tool-context.ts";

/**
 * Drag-to-move a construction node. Migrated from `tabletop-entry.tsx`'s
 * former inline `handlePointerDown`/`handlePointerMove`/`endDrag` -- same
 * behavior, just relocated behind the generic tool dispatcher
 * (`use-construction-pointer.ts`) so that hook never has to special-case
 * "if the active tool is move-node."
 */
export const moveNodeTool: ConstructionTool<"move-node"> = {
  id: "move-node",
  defaultParams: () => ({}),

  onPointerDown(ctx: ToolContext, sample: PointerSample): void {
    if (sample.nodeId === undefined) return;
    ctx.reportSelection({ id: sample.nodeId, point: sample.point });
  },

  onPointerMove(ctx: ToolContext, gesture: ToolGesture): void {
    if (gesture.start.nodeId === undefined) return;
    ctx.reportSelection({ id: gesture.start.nodeId, point: gesture.current.point });
    ctx.runtime.moveNode(gesture.start.nodeId, gesture.current.point, "local", `drag:${gesture.start.nodeId}`);
  },

  onPointerUp(ctx: ToolContext, gesture: ToolGesture): void {
    if (gesture.start.nodeId === undefined) return;
    ctx.history.record({ nodeId: gesture.start.nodeId, from: gesture.start.point, to: gesture.current.point });
  },
};
