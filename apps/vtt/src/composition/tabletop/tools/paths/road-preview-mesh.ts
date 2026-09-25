import type { ConstructionPosition, RenderPreviewDescriptor } from "../../../../ports/index.ts";

export const PREVIEW_ELEVATION = 0.05;
export const NODE_DISK_ELEVATION = 0.055;
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

/** Append triangulated quad strips for a ribbon outline computed by graph-core. */
export function appendRibbonQuads(
  positions: number[],
  indices: number[],
  outer: readonly (readonly [number, number, number])[],
  elevation = PREVIEW_ELEVATION,
): void {
  if (outer.length < 4 || outer.length % 2 !== 0) return;
  const n = outer.length / 2;
  const baseVertex = positions.length / 3;

  for (let k = 0; k < n; k++) {
    const left = outer[k]!;
    const right = outer[outer.length - 1 - k]!;
    positions.push(left[0], left[1] + elevation, left[2]);
    positions.push(right[0], right[1] + elevation, right[2]);
  }

  for (let k = 0; k < n - 1; k++) {
    const v0 = baseVertex + 2 * k;
    const v1 = baseVertex + 2 * k + 1;
    const v2 = baseVertex + 2 * (k + 1);
    const v3 = baseVertex + 2 * (k + 1) + 1;
    indices.push(v0, v1, v2);
    indices.push(v1, v3, v2);
  }
}

/** Fallback straight quads connecting consecutive points when curve fitting is unavailable. */
export function appendStraightQuads(
  positions: number[],
  indices: number[],
  points: readonly ConstructionPosition[],
  halfWidth: number,
  elevation = PREVIEW_ELEVATION,
): void {
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) continue;
    const nx = (-dz / len) * halfWidth;
    const nz = (dx / len) * halfWidth;

    const base = positions.length / 3;
    positions.push(
      a.x - nx, a.y + elevation, a.z - nz,
      a.x + nx, a.y + elevation, a.z + nz,
      b.x - nx, b.y + elevation, b.z - nz,
      b.x + nx, b.y + elevation, b.z + nz,
    );
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
}

/** Append a filled circular disk at a specific anchor node or cursor position. */
export function appendNodeDisk(
  positions: number[],
  indices: number[],
  center: ConstructionPosition,
  radius: number,
  elevation = NODE_DISK_ELEVATION,
  segments = 24,
): void {
  const cIndex = positions.length / 3;
  positions.push(center.x, center.y + elevation, center.z);

  for (let s = 0; s <= segments; s++) {
    const angle = (2 * Math.PI * s) / segments;
    positions.push(
      center.x + radius * Math.cos(angle),
      center.y + elevation,
      center.z + radius * Math.sin(angle),
    );
  }

  for (let s = 0; s < segments; s++) {
    indices.push(cIndex, cIndex + 1 + s, cIndex + 1 + s + 1);
  }
}

/** Build a solid translucent 3D mesh preview for a road, including ribbon quads and anchor disks. */
export function createRoadMeshPreview(options: RoadMeshPreviewOptions): RenderPreviewDescriptor {
  const positions: number[] = [];
  const indices: number[] = [];
  const halfWidth = Math.max(0.1, options.bedWidth / 2);
  const diskRadius = Math.max(0.35, options.bedWidth * 0.52);

  if (options.ribbons && options.ribbons.length > 0) {
    for (const ribbonResult of options.ribbons) {
      if (ribbonResult.ribbon?.outer) {
        appendRibbonQuads(positions, indices, ribbonResult.ribbon.outer);
      }
    }
  }

  // Fallback to straight quads if curve ribbons could not be evaluated
  if (positions.length === 0 && options.fallbackPoints && options.fallbackPoints.length >= 2) {
    appendStraightQuads(positions, indices, options.fallbackPoints, halfWidth);
  }

  // Anchor and cursor node disks
  const allPoints: ConstructionPosition[] = [...options.anchors];
  if (options.cursor) allPoints.push(options.cursor);

  const uniqueAnchors: ConstructionPosition[] = [];
  for (const p of allPoints) {
    if (!uniqueAnchors.some(u => Math.hypot(u.x - p.x, u.y - p.y, u.z - p.z) < 0.05)) {
      uniqueAnchors.push(p);
    }
  }

  for (const anchor of uniqueAnchors) {
    appendNodeDisk(positions, indices, anchor, diskRadius);
  }

  // If there are still no positions (e.g. empty draft), draw at least one disk at origin
  if (positions.length === 0 && options.cursor) {
    appendNodeDisk(positions, indices, options.cursor, diskRadius);
  }

  return {
    kind: "mesh",
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(indices),
    color: options.color ?? ROAD_PREVIEW_COLOR,
    opacity: options.opacity ?? ROAD_PREVIEW_OPACITY,
  };
}

/** Build a glowing circular snap preview mesh at the target junction location. */
export function createSnapMeshPreview(target: ConstructionPosition, radius = 0.45): RenderPreviewDescriptor {
  const positions: number[] = [];
  const indices: number[] = [];
  // Elevated disk with outer ring for clear junction target visual
  appendNodeDisk(positions, indices, target, radius, NODE_DISK_ELEVATION + 0.01, 24);
  appendNodeDisk(positions, indices, target, radius * 1.35, NODE_DISK_ELEVATION + 0.005, 24);

  return {
    kind: "mesh",
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(indices),
    color: SNAP_DISK_COLOR,
    opacity: SNAP_DISK_OPACITY,
  };
}
