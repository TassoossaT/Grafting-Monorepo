import type { ConstructionPosition } from "../../../../ports/index.ts";
import type { PointerSample } from "./tool-context.ts";

/**
 * Where the pointer is at height `y`: its ray from the camera crossing that
 * level, so something drawn at `y` sits right under the cursor rather than
 * above or below whatever the ray hit. Without a ray -- or one that never
 * reaches that level in front of the camera -- the hit point, at `y`.
 */
export function pointerAtHeight(sample: PointerSample, y: number): ConstructionPosition {
  const ray = sample.ray;
  if (ray && Math.abs(ray.direction.y) > 1e-6) {
    const t = (y - ray.origin.y) / ray.direction.y;
    if (t > 0) return { x: ray.origin.x + ray.direction.x * t, y, z: ray.origin.z + ray.direction.z * t };
  }
  return { ...sample.point, y };
}
