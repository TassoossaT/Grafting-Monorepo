import { faceRings, planeOf } from "../../../../features/edit-construction/index.ts";
import type { ConstructionPosition, ConstructionRegionTopology, ConstructionSurfaceKey } from "../../../../ports/index.ts";
import type { PointerSample } from "./tool-context.ts";

/**
 * Where the pointer is at height `y` -- the one rule every tool reads the
 * pointer by, so a point lands under the cursor the same way for all of them.
 * On a face standing above `y` that is not a wall -- a roof's leaf, a
 * platform's top -- it is where the ray meets that face, laid down onto `y`:
 * carried on down the ray it would land far behind what the cursor is on.
 * Anywhere else, the ray crossing `y` itself, so something drawn at `y`
 * sits right under the cursor rather than above or below whatever the ray
 * hit. Without a ray -- or one that never reaches there in front of the
 * camera -- the hit point, at `y`. Exact but for what the ruler caught
 * (`sample.ruled`): the pointer's own ray is never rounded, only ruled.
 */
export function pointerAtHeight(sample: PointerSample, y: number): ConstructionPosition {
  const exact = exactAtHeight(sample, y);
  // The ruler's catch -- how far it moved the hit -- is carried onto the ray: every tool reads the pointer here, so every tool is ruled.
  const ruled = sample.ruled;
  return ruled ? { x: exact.x + ruled.x, y, z: exact.z + ruled.z } : exact;
}

function exactAtHeight(sample: PointerSample, y: number): ConstructionPosition {
  const ray = sample.ray;
  if (!ray) return { ...sample.point, y };
  const face = sample.face;
  if (face && Math.abs(face.normal.y) > 1e-9 && sample.point.y > y + 1e-6) {
    const at = crossing(ray, face.normal, face.centre);
    if (at) return { ...at, y };
  }
  return crossing(ray, { x: 0, y: 1, z: 0 }, { x: 0, y, z: 0 }) ?? { ...sample.point, y };
}

/** Where `ray` meets the plane through `centre` square to `normal`, in front of the camera. */
function crossing(ray: NonNullable<PointerSample["ray"]>, normal: ConstructionPosition, centre: ConstructionPosition): ConstructionPosition | undefined {
  const facing = normal.x * ray.direction.x + normal.y * ray.direction.y + normal.z * ray.direction.z;
  if (Math.abs(facing) < 1e-6) return undefined;
  const t = (normal.x * (centre.x - ray.origin.x) + normal.y * (centre.y - ray.origin.y) + normal.z * (centre.z - ray.origin.z)) / facing;
  return t > 0 ? { x: ray.origin.x + ray.direction.x * t, y: ray.origin.y + ray.direction.y * t, z: ray.origin.z + ray.direction.z * t } : undefined;
}

/**
 * The key of the face a pick's `surfaceRef` names -- the key's parts, sorted
 * and joined (`surfaceRefFromNodeSet`): for a region, `["@region", id]`.
 */
export function surfaceKeyOfRef(surfaceRef: string): ConstructionSurfaceKey {
  const parts = surfaceRef.split(",");
  const at = parts.indexOf("@region");
  if (at < 0) return parts;
  return ["@region", parts.filter((_, index) => index !== at).join(",")];
}

/**
 * `sample` knowing the face it is on: that face's slope, through the exact
 * point the pointer hit -- read before the hit is snapped to the grid, and
 * right on uneven faces too, the ground or a road, whose slope differs from
 * place to place. The pointer gives every sample this, so `faceOf` reads the
 * one face it is on: every face of the map read on every pointer move cost
 * tens of milliseconds a move on a map of a thousand faces.
 */
export function withFacePlane(sample: PointerSample, faceOf: (surfaceKey: ConstructionSurfaceKey) => ConstructionRegionTopology | undefined): PointerSample {
  if (sample.surfaceRef === undefined) return sample;
  const topology = faceOf(surfaceKeyOfRef(sample.surfaceRef));
  const plane = topology && planeOf(faceRings(topology)[0] ?? []);
  return plane ? { ...sample, face: { normal: plane.normal, centre: sample.point } } : sample;
}
