import type { ConstructionPosition, RenderPreviewDescriptor } from "../../../../ports/index.ts";
import { appendNodeDisk, appendStraightQuads, createRibbonMeshPreview, NODE_DISK_ELEVATION, PREVIEW_ELEVATION } from "../shapes/ribbon-mesh-preview.ts";

export { NODE_DISK_ELEVATION, PREVIEW_ELEVATION };

export const ROAD_PREVIEW_COLOR = 0x38bdf8;
export const ROAD_PREVIEW_OPACITY = 0.65;
export const ROAD_ERROR_COLOR = 0xf87171;
export const ROAD_ERROR_OPACITY = 0.6;
export const SNAP_DISK_COLOR = 0x06b6d4;
export const SNAP_DISK_OPACITY = 0.85;

export interface RoadMeshPreviewOptions {
  readonly ribbons?: readonly { readonly ribbon: { readonly outer: readonly (readonly [number, number, number])[] } | null }[];
  readonly fallbackPoints?: readonly ConstructionPosition[];
  readonly anchors: readonly ConstructionPosition[];
  readonly cursor?: ConstructionPosition;
  readonly bedWidth: number;
  readonly color?: number;
  readonly opacity?: number;
}

/** A road's ribbon preview: the shared ribbon mesh in the road's own colours. */
export function createRoadMeshPreview(options: RoadMeshPreviewOptions): RenderPreviewDescriptor {
  return createRibbonMeshPreview({ ...options, width: options.bedWidth, color: options.color ?? ROAD_PREVIEW_COLOR, opacity: options.opacity ?? ROAD_PREVIEW_OPACITY });
}

/** Build a lightweight straight-quad preview mesh connecting path points directly, without WASM round-trips. */
export function createFastRoadPreview(
  points: readonly ConstructionPosition[],
  bedWidth: number,
  cursor?: ConstructionPosition,
  color?: number,
  opacity?: number,
): RenderPreviewDescriptor {
  const positions: number[] = [];
  const indices: number[] = [];
  const allPoints = cursor && (points.length === 0 || Math.hypot(cursor.x - points.at(-1)!.x, cursor.z - points.at(-1)!.z) > 1e-3)
    ? [...points, cursor]
    : points;
  const halfWidth = Math.max(0.1, bedWidth / 2);
  const diskRadius = Math.max(0.35, bedWidth * 0.52);

  if (allPoints.length >= 2) {
    appendStraightQuads(positions, indices, allPoints, halfWidth, PREVIEW_ELEVATION);
  }

  for (const p of allPoints) {
    appendNodeDisk(positions, indices, p, diskRadius, NODE_DISK_ELEVATION, 12);
  }

  return {
    kind: "mesh",
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(indices),
    color: color ?? ROAD_PREVIEW_COLOR,
    opacity: opacity ?? ROAD_PREVIEW_OPACITY,
  };
}

/** Build a glowing circular snap preview mesh at the target junction location. */
export function createSnapMeshPreview(target: ConstructionPosition, radius = 0.45): RenderPreviewDescriptor {
  const positions: number[] = [];
  const indices: number[] = [];
  // Elevated disk for clear junction target visual
  appendNodeDisk(positions, indices, target, radius, NODE_DISK_ELEVATION + 0.01, 12);

  return {
    kind: "mesh",
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(indices),
    color: SNAP_DISK_COLOR,
    opacity: SNAP_DISK_OPACITY,
  };
}

