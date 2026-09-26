import { createAngleTracker, rotateInPlan, type HandleMotion } from "../../../../features/edit-construction/index.ts";
import type { ConstructionPosition } from "../../../../ports/index.ts";
import type { PointerSample, ToolGesture } from "./tool-context.ts";

/** Shift snaps an orbit to steps of this many radians -- 15 degrees. */
const TURN_STEP = Math.PI / 12;
/** Screen pixels a vertical drag takes per world unit. */
const PIXELS_PER_UNIT = 40;

/** Where a dragged handle stands now, and -- on an orbit -- how far round it has turned. */
export interface ConstrainedPosition {
  readonly position: ConstructionPosition;
  readonly angle?: number;
}

export interface ConstrainedDragOptions {
  /** The scene manipulator is carrying the handle: its point is taken as it is. */
  readonly spatialTarget?: boolean;
  /** Elevation mode: a free handle's pointer drag moves it up and down instead of along the ground. */
  readonly elevation?: boolean;
  /** Where the pointer was when the drag began; the handle keeps its offset from it. */
  readonly pointerOrigin?: ConstructionPosition;
}

/**
 * A handle dragged along its own path (`HandleMotion`): whatever the pointer
 * does, the handle only goes where its motion allows. Any handle of any
 * structure uses this; the path is the handle's, not its type's.
 */
export function createConstrainedDrag(motion: HandleMotion, handle: ConstructionPosition, sample: PointerSample, options: ConstrainedDragOptions = {}): { at(gesture: ToolGesture): ConstrainedPosition } {
  const origin = options.pointerOrigin ?? sample.point;
  const turning = motion.kind === "orbit" ? createAngleTracker(motion.center, handle) : undefined;
  const rise = (current: PointerSample) => options.spatialTarget
    ? current.point.y - handle.y
    : sample.screenY !== undefined && current.screenY !== undefined ? (sample.screenY - current.screenY) / PIXELS_PER_UNIT : 0;
  return {
    at(gesture) {
      const current = gesture.current;
      switch (motion.kind) {
        case "free":
          if (options.spatialTarget) return { position: current.point };
          if (options.elevation) return { position: { ...handle, y: handle.y + rise(current) } };
          return { position: { x: handle.x + current.point.x - origin.x, y: handle.y, z: handle.z + current.point.z - origin.z } };
        case "plane":
          return { position: options.spatialTarget ? { ...current.point, y: handle.y } : { x: handle.x + current.point.x - origin.x, y: handle.y, z: handle.z + current.point.z - origin.z } };
        case "vertical":
          return { position: { ...handle, y: handle.y + rise(current) } };
        case "orbit": {
          const turned = turning!.turn(current.point);
          const angle = current.shiftKey ? Math.round(turned / TURN_STEP) * TURN_STEP : turned;
          return { position: rotateInPlan(handle, motion.center, angle), angle };
        }
      }
    },
  };
}
