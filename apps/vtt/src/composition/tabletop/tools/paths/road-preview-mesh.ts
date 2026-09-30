import type { ConstructionPosition, RenderPreviewDescriptor } from "../../../../ports/index.ts";
import { appendNodeDisk, createRibbonMeshPreview, NODE_DISK_ELEVATION } from "../shapes/ribbon-mesh-preview.ts";

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
  readonly bedWidth: number;
  readonly color?: number;
  readonly opacity?: number;
}

/** A road's ribbon preview: the shared ribbon mesh in the road's own colours. */
export function createRoadMeshPreview(options: RoadMeshPreviewOptions): RenderPreviewDescriptor {
  return createRibbonMeshPreview({ ...options, width: options.bedWidth, color: options.color ?? ROAD_PREVIEW_COLOR, opacity: options.opacity ?? ROAD_PREVIEW_OPACITY });
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
