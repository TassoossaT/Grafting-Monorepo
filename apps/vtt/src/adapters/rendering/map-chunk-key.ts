import type { ClipPlaneDescriptor, Vec3 } from "@grafting/render-3d";

/** Default spatial bucket size, in world units, along both ground-plane axes. */
const DEFAULT_CHUNK_SIZE = 8;

/**
 * Buckets a world-space centroid into a fixed-size XZ grid cell, identified
 * by its own cell coordinates. Pure arithmetic, not a graph algorithm, so it
 * stays app-owned rather than reproducing a `libs/*` capability by hand.
 *
 * Vertical position never affects the bucket: chunking exists to bound how
 * much geometry one buffer holds on the ground plane, not to slice by floor
 * (floor cutting is the clip plane's job, see {@link clipPlaneForCameraHeight}).
 */
export function chunkKeyFor(centroid: Vec3, chunkSize: number = DEFAULT_CHUNK_SIZE): string {
  const cellX = Math.floor(centroid.x / chunkSize);
  const cellZ = Math.floor(centroid.z / chunkSize);
  return `${cellX}:${cellZ}`;
}

/**
 * Converts a camera height into the clip plane that hides geometry above it,
 * so a viewer above a floor can see into it instead of only its roof.
 *
 * Continuous world-space Y, not a discrete floor index -- the roadmap's own
 * requirement for this task. Not called from this task's own wiring (no live
 * camera exists in `apps/vtt` yet); it is the ready integration point `E3.7`
 * calls once pointer/camera control exists.
 */
export function clipPlaneForCameraHeight(cameraY: number, offset = 0): ClipPlaneDescriptor {
  const height = cameraY - offset;
  // normal = (0, -1, 0): dot(normal, point) + constant >= 0 keeps points
  // where -point.y + height >= 0, i.e. point.y <= height.
  return { normal: { x: 0, y: -1, z: 0 }, constant: height };
}
