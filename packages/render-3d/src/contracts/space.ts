/** Grafting-owned spatial primitives. No renderer type appears in this file. */

/** A point or direction in engine space. */
export interface Vec3 {
  /** Rightward axis. */
  readonly x: number;
  /** Upward axis. */
  readonly y: number;
  /** Depth axis, toward the viewer. */
  readonly z: number;
}

/** Rotation in radians, applied in XYZ order. */
export interface Euler {
  /** Pitch, in radians. */
  readonly x: number;
  /** Yaw, in radians. */
  readonly y: number;
  /** Roll, in radians. */
  readonly z: number;
}

/** Placement of a scene item. Every field is optional; omitted fields keep their identity value. */
export interface Transform {
  /** Placement in engine space. Defaults to the origin. */
  readonly position?: Vec3;
  /** Orientation. Defaults to unrotated. */
  readonly rotation?: Euler;
  /** Uniform scale when a number, per-axis when a {@link Vec3}. Defaults to `1`. */
  readonly scale?: number | Vec3;
}

/** The origin-of-identity transform, used when an item supplies none. */
export const IDENTITY_TRANSFORM: Required<Pick<Transform, "position" | "rotation">> & {
  readonly scale: number;
} = Object.freeze({
  position: Object.freeze({ x: 0, y: 0, z: 0 }),
  rotation: Object.freeze({ x: 0, y: 0, z: 0 }),
  scale: 1,
});
