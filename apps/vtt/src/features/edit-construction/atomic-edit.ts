import type {
  ConstructionEdgeGeometry,
  ConstructionEdgeId,
  ConstructionNodeId,
  ConstructionPosition,
  ConstructionSurfaceKey,
} from "@/ports";

/**
 * The atomic edit vocabulary, as data. Every entry maps one-to-one onto a
 * `ConstructionSessionPort` primitive; nothing here knows what a wall or a
 * terrain patch is.
 *
 * Expressing an op as a value rather than a direct port call is what lets a
 * structure type's policy *substitute* one op for another, and lets a
 * cascade be a plain list of further ops applied in the same transaction --
 * see `docs/architecture/vtt-atomic-edit-and-cloud-policy-design.md`.
 */
export type AtomicEditOp =
  | { readonly kind: "move-vertex"; readonly nodeId: ConstructionNodeId; readonly position: ConstructionPosition }
  | {
      readonly kind: "insert-vertex";
      readonly edgeId: ConstructionEdgeId;
      readonly nodeId: ConstructionNodeId;
      readonly position: ConstructionPosition;
      readonly firstEdgeId: ConstructionEdgeId;
      readonly secondEdgeId: ConstructionEdgeId;
    }
  | { readonly kind: "remove-vertex"; readonly nodeId: ConstructionNodeId; readonly weldedEdgeId: ConstructionEdgeId }
  | { readonly kind: "retype-edge"; readonly edgeId: ConstructionEdgeId; readonly geometry: ConstructionEdgeGeometry }
  | { readonly kind: "move-edge"; readonly edgeId: ConstructionEdgeId; readonly delta: ConstructionPosition }
  | { readonly kind: "move-region"; readonly surfaceKey: ConstructionSurfaceKey; readonly delta: ConstructionPosition }
  | { readonly kind: "delete-region"; readonly surfaceKey: ConstructionSurfaceKey }
  | {
      readonly kind: "duplicate-region";
      readonly surfaceKey: ConstructionSurfaceKey;
      readonly suffix: string;
      readonly offset: ConstructionPosition;
      readonly surfaceType: string;
      readonly physical: boolean;
    };

export type AtomicEditOpKind = AtomicEditOp["kind"];

/** Which part of a region the user grabbed. */
export type EditTarget =
  | { readonly kind: "vertex"; readonly nodeId: ConstructionNodeId }
  | { readonly kind: "edge"; readonly edgeId: ConstructionEdgeId }
  | { readonly kind: "region" };

/** One user gesture, before any policy has looked at it. */
export interface EditGesture {
  readonly surfaceKey: ConstructionSurfaceKey;
  readonly target: EditTarget;
  /** World-space movement the pointer accumulated over the drag. */
  readonly delta: ConstructionPosition;
}

export const ZERO_DELTA: ConstructionPosition = Object.freeze({ x: 0, y: 0, z: 0 });

export function addPosition(a: ConstructionPosition, b: ConstructionPosition): ConstructionPosition {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function scalePosition(position: ConstructionPosition, factor: number): ConstructionPosition {
  return { x: position.x * factor, y: position.y * factor, z: position.z * factor };
}

/**
 * Zeroes out every axis a role does not allow -- the "constraint on the op's
 * own parameter" half of a role policy, enforced here on the TS side
 * *before* the engine call, never inside Rust.
 */
export type EditAxis = "x" | "y" | "z";

export function constrainToAxes(
  delta: ConstructionPosition,
  axes: readonly EditAxis[],
): ConstructionPosition {
  return {
    x: axes.includes("x") ? delta.x : 0,
    y: axes.includes("y") ? delta.y : 0,
    z: axes.includes("z") ? delta.z : 0,
  };
}

export const ALL_AXES: readonly EditAxis[] = Object.freeze(["x", "y", "z"] as const);
export const HORIZONTAL_AXES: readonly EditAxis[] = Object.freeze(["x", "z"] as const);
export const HEIGHT_AXIS: readonly EditAxis[] = Object.freeze(["y"] as const);
