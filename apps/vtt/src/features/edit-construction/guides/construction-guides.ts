import type { ConstructionPosition } from "@/ports";
import type { ConstructionRegionTopology, ConstructionSurfaceKey } from "@/ports";

/** A type-neutral geometric reference a construction tool may snap to. */
export interface ConstructionGuideReference {
  /** Stable identity used to break ties consistently. */
  readonly id: string;
  readonly surfaceKey?: ConstructionSurfaceKey;
  /** References in the same declared group can form equal-spacing guides. */
  readonly group?: string;
  /** World-space point carrying the reference. */
  readonly position: ConstructionPosition;
  /** Axes this reference makes available to alignment. */
  readonly axes: readonly ("x" | "y" | "z")[];
  /** Optional user-facing description for measurement feedback. */
  readonly label?: string;
}

/** A visible guide returned alongside the resolved point. */
export interface ConstructionGuide {
  readonly id: string;
  readonly axis: "x" | "y" | "z" | "point" | "distance";
  readonly start: ConstructionPosition;
  readonly end: ConstructionPosition;
  readonly label?: string;
}

/** Snaps a drag's length while preserving its direction. */
export function snapConstructionDistance(
  proposed: ConstructionPosition,
  origin: ConstructionPosition,
  step: number,
): ConstructionGuideResolution {
  if (!Number.isFinite(step) || step <= 0) return { point: proposed, guides: [] };
  const delta = { x: proposed.x - origin.x, y: proposed.y - origin.y, z: proposed.z - origin.z };
  const distance = Math.hypot(delta.x, delta.y, delta.z);
  if (distance === 0) return { point: proposed, guides: [] };
  const snappedDistance = Math.round(distance / step) * step;
  const scale = snappedDistance / distance;
  const point = {
    x: origin.x + delta.x * scale,
    y: origin.y + delta.y * scale,
    z: origin.z + delta.z * scale,
  };
  return {
    point,
    guides: [{ id: "distance-step", axis: "distance", start: origin, end: point, label: `${snappedDistance.toFixed(2)} m` }],
  };
}

export interface ConstructionGuideResolution {
  readonly point: ConstructionPosition;
  readonly guides: readonly ConstructionGuide[];
}

/** Converts guide lines to short segments so the 3D overlay reads as dashed. */
export function constructionGuideSegments(guides: readonly ConstructionGuide[]): Float32Array {
  const values: number[] = [];
  for (const guide of guides) {
    for (let index = 0; index < 12; index += 2) {
      const startT = index / 12;
      const endT = (index + 1) / 12;
      values.push(
        guide.start.x + (guide.end.x - guide.start.x) * startT,
        guide.start.y + (guide.end.y - guide.start.y) * startT,
        guide.start.z + (guide.end.z - guide.start.z) * startT,
        guide.start.x + (guide.end.x - guide.start.x) * endT,
        guide.start.y + (guide.end.y - guide.start.y) * endT,
        guide.start.z + (guide.end.z - guide.start.z) * endT,
      );
    }
  }
  return new Float32Array(values);
}

export interface ConstructionGuideOptions {
  readonly pointSnap: boolean;
  readonly horizontalAlignment: boolean;
  readonly equalHeight: boolean;
  readonly equalSpacing: boolean;
}

/** Publishes graph nodes as generic point and axis references for one type. */
export function nodeGuideReferences(
  topology: ConstructionRegionTopology,
): readonly ConstructionGuideReference[] {
  return topology.nodes.map((node) => ({
    id: node.id,
    surfaceKey: topology.surfaceKey,
    group: topology.surfaceType,
    position: node.position,
    axes: ["x", "y", "z"],
  }));
}

/** Procedurally generated terrain has no stable authored points to guide to. */
export function noGuideReferences(): readonly ConstructionGuideReference[] {
  return [];
}

/**
 * Aligns a proposed world point to declared references within a world-space
 * tolerance. The same resolver serves creation and editing; structure types
 * decide which of their geometric features are eligible references.
 */
export function resolveConstructionGuides(
  proposed: ConstructionPosition,
  references: readonly ConstructionGuideReference[],
  tolerance: number,
  options: ConstructionGuideOptions = {
    pointSnap: true,
    horizontalAlignment: true,
    equalHeight: true,
    equalSpacing: false,
  },
): ConstructionGuideResolution {
  if (!Number.isFinite(tolerance) || tolerance <= 0) return { point: proposed, guides: [] };

  const ordered = [...references].sort((a, b) => a.id.localeCompare(b.id));
  let nearestPoint: ConstructionGuideReference | undefined;
  let nearestPointDistance = tolerance;
  for (const reference of options.pointSnap ? ordered : []) {
    const distance = Math.hypot(
      proposed.x - reference.position.x,
      proposed.y - reference.position.y,
      proposed.z - reference.position.z,
    );
    if (distance < nearestPointDistance) {
      nearestPoint = reference;
      nearestPointDistance = distance;
    }
  }
  if (nearestPoint !== undefined) {
    return {
      point: nearestPoint.position,
      guides: [{
        id: nearestPoint.id,
        axis: "point",
        start: proposed,
        end: nearestPoint.position,
        label: nearestPoint.label,
      }],
    };
  }

  const coordinates = { x: proposed.x, y: proposed.y, z: proposed.z };
  const guides: ConstructionGuide[] = [];
  const axes = [
    ...(options.horizontalAlignment ? ["x", "z"] as const : []),
    ...(options.equalHeight ? ["y"] as const : []),
  ];
  for (const axis of axes) {
    let best: ConstructionGuideReference | undefined;
    let bestDistance = tolerance;
    for (const reference of ordered) {
      if (!reference.axes.includes(axis)) continue;
      const distance = Math.abs(proposed[axis] - reference.position[axis]);
      if (distance < bestDistance) {
        best = reference;
        bestDistance = distance;
      }
    }
    if (best === undefined) continue;
    coordinates[axis] = best.position[axis];
    const start = { ...proposed, [axis]: best.position[axis] };
    const end = { ...best.position, [axis]: best.position[axis] };
    guides.push({ id: best.id, axis, start, end, label: best.label });
  }

  if (options.equalSpacing) {
    const spacing = nearestEqualSpacing(proposed, ordered, tolerance);
    if (spacing !== undefined) {
      coordinates[spacing.axis] = spacing.position[spacing.axis];
      guides.push(
        { id: `${spacing.first.id}:spacing`, axis: spacing.axis, start: spacing.first.position, end: spacing.second.position },
        { id: `${spacing.second.id}:spacing`, axis: spacing.axis, start: spacing.second.position, end: spacing.position },
      );
    }
  }

  return {
    point: coordinates,
    guides,
  };
}

function nearestEqualSpacing(
  proposed: ConstructionPosition,
  references: readonly ConstructionGuideReference[],
  tolerance: number,
): { readonly axis: "x" | "z"; readonly position: ConstructionPosition; readonly first: ConstructionGuideReference; readonly second: ConstructionGuideReference } | undefined {
  type SpacingCandidate = { readonly axis: "x" | "z"; readonly position: ConstructionPosition; readonly first: ConstructionGuideReference; readonly second: ConstructionGuideReference };
  let best: SpacingCandidate | undefined;
  let bestDistance = tolerance;
  const byGroup = new Map<string, ConstructionGuideReference[]>();
  for (const reference of references) {
    if (reference.group === undefined) continue;
    const group = byGroup.get(reference.group) ?? [];
    group.push(reference);
    byGroup.set(reference.group, group);
  }
  for (const group of byGroup.values()) {
    // Prevent a dense generated type from turning a pointer update into a
    // quadratic full-scene comparison. Such a type can publish a smaller
    // semantic guide set from its own declaration when needed.
    if (group.length > 128) continue;
    for (let left = 0; left < group.length; left += 1) {
      const first = group[left]!;
      for (let right = left + 1; right < group.length; right += 1) {
        const second = group[right]!;
      for (const axis of ["x", "z"] as const) {
        const other = axis === "x" ? "z" : "x";
        if (Math.abs(first.position[other] - second.position[other]) > tolerance) continue;
        if (Math.abs(first.position.y - second.position.y) > tolerance) continue;
        const interval = second.position[axis] - first.position[axis];
        if (Math.abs(interval) <= tolerance) continue;
        for (const coordinate of [first.position[axis] - interval, second.position[axis] + interval]) {
          const candidate = { ...first.position, [axis]: coordinate };
          const distance = Math.hypot(
            proposed.x - candidate.x,
            proposed.y - candidate.y,
            proposed.z - candidate.z,
          );
          if (distance >= bestDistance) continue;
          bestDistance = distance;
          best = { axis, position: candidate, first, second };
        }
      }
    }
    }
  }
  return best;
}
