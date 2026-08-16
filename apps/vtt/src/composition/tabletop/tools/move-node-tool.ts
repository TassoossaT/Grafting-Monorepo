import type { ConstructionPosition } from "@/ports";
import type { ConstructionTool, PointerSample, ToolContext, ToolGesture } from "./tool-context.ts";

function resolveConstrainedPoint(start: PointerSample, current: PointerSample): ConstructionPosition {
  if (start.axis === "y-height") {
    // Vertical elevation manipulation: lock (X, Z), adjust Y
    return {
      x: start.point.x,
      y: Math.max(0, current.point.y),
      z: start.point.z,
    };
  }

  // Planar (X, Z) manipulation: lock Y, adjust (X, Z)
  return {
    x: current.point.x,
    y: start.point.y,
    z: current.point.z,
  };
}

/**
 * Drag-to-move a construction node in 3D.
 *
 * Supports both planar (X, Z) manipulation via base node handles and
 * vertical elevation (Y) height manipulation via Tiny Glade-style 3D height gizmos.
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
    const targetPoint = resolveConstrainedPoint(gesture.start, gesture.current);
    ctx.reportSelection({ id: gesture.start.nodeId, point: targetPoint });
    ctx.runtime.moveNode(gesture.start.nodeId, targetPoint, "local", `drag:${gesture.start.nodeId}`);
  },

  onPointerUp(ctx: ToolContext, gesture: ToolGesture): void {
    if (gesture.start.nodeId === undefined) return;
    const targetPoint = resolveConstrainedPoint(gesture.start, gesture.current);
    ctx.history.record({ nodeId: gesture.start.nodeId, from: gesture.start.point, to: targetPoint });
  },
};
