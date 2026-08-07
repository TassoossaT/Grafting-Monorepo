/** Grafting-owned spatial primitives. No renderer type appears in this file. */

/** A point or direction in engine space. */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Rotation in radians, applied in XYZ order. */
export interface Euler {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Placement of a scene item. Every field is optional; omitted fields keep their identity value. */
export interface Transform {
  readonly position?: Vec3;
  readonly rotation?: Euler;
  /** Uniform scale when a number, per-axis when a {@link Vec3}. Defaults to `1`. */
  readonly scale?: number | Vec3;
}

/** Axis-aligned extent used for visibility and spatial queries. */
export interface Bounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

/** The origin-of-identity transform, used when an item supplies none. */
export const IDENTITY_TRANSFORM: Required<Pick<Transform, "position" | "rotation">> & {
  readonly scale: number;
} = Object.freeze({
  position: Object.freeze({ x: 0, y: 0, z: 0 }),
  rotation: Object.freeze({ x: 0, y: 0, z: 0 }),
  scale: 1,
});
