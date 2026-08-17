import type { ConstructionTool, PointerSample, ToolContext, ToolGesture } from "./tool-context.ts";
import type { ConstructionPosition } from "@/ports";

function resolveTarget(start: PointerSample, current: PointerSample): ConstructionPosition {
  if (start.axis === "y-height") {
    return { x: start.point.x, y: Math.max(0, current.point.y), z: start.point.z };
  }
  return { x: current.point.x, y: start.point.y, z: current.point.z };
}

/**
 * Drag-to-move a construction node. Migrated from `tabletop-entry.tsx`'s
 * former inline `handlePointerDown`/`handlePointerMove`/`endDrag` -- same
 * behavior, just relocated behind the generic tool dispatcher
 * (`use-construction-pointer.ts`) so that hook never has to special-case
 * "if the active tool is move-node."
 */
/** Supports planar dragging and y-height floating gizmo dragging. */
export const moveNodeTool: ConstructionTool<"move-node"> = {
  id: "move-node",
  defaultParams: () => ({}),

  onPointerDown(ctx: ToolContext, sample: PointerSample): void {
    if (sample.nodeId === undefined) return;
    ctx.reportSelection({ id: sample.nodeId, point: sample.point });
  },

  onPointerMove(ctx: ToolContext, gesture: ToolGesture): void {
    if (gesture.start.nodeId === undefined) return;
    const target = resolveTarget(gesture.start, gesture.current);
    ctx.reportSelection({ id: gesture.start.nodeId, point: target });
    ctx.runtime.moveNode(gesture.start.nodeId, target, "local", `drag:${gesture.start.nodeId}`);
  },

  onPointerUp(ctx: ToolContext, gesture: ToolGesture): void {
    if (gesture.start.nodeId === undefined) return;
    const target = resolveTarget(gesture.start, gesture.current);
    ctx.history.record({ nodeId: gesture.start.nodeId, from: gesture.start.point, to: target });
  },
};
