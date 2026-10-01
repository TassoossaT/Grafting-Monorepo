import type { ConstructionPosition } from "../../../../ports/index.ts";
import type { PointerSample } from "./tool-context.ts";

/**
 * How many metres one pixel of the screen is where the pointer is: the camera
 * looks through a lens of fixed field of view, so a pixel spans
 * `2 * distance * tan(fov / 2) / height` metres at `distance` from it. What
 * the ruler needs to measure its reach in pixels -- the same feel at every
 * zoom -- rather than in metres, which would snap everything together zoomed
 * out and nothing zoomed in. `undefined` when the view gave no ray to take the
 * distance along, or has no height.
 */
export function metersPerPixelAt(hit: Pick<PointerSample, "point" | "ray">, viewportHeight: number, fovDegrees: number): number | undefined {
  const ray = hit.ray;
  if (!ray || !(viewportHeight > 0)) return undefined;
  const distance = distanceBetween(ray.origin, hit.point);
  if (!(distance > 0)) return undefined;
  return (2 * distance * Math.tan((fovDegrees * Math.PI) / 360)) / viewportHeight;
}

const distanceBetween = (a: ConstructionPosition, b: ConstructionPosition): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
