import type { ConstructionPosition } from "@/ports";

import type { FittedEdge } from "../../topology/index.ts";

/**
 * How far the road may float above or below the ground before a station is
 * spent to bring it back down, in world units.
 *
 * A road rides the ground it was drawn over, and the only record of that
 * ground is the stroke itself -- every pointer sample carries the height the
 * renderer picked there. Fitting deliberately throws most of those samples
 * away, so a run over a hill would be left with height readings at its two
 * ends and a chord tunnelling through everything between.
 *
 * The answer used to be a station every two metres, everywhere. That buys a
 * hundred stations for a hundred-metre road across a car park, all of them
 * saying the same thing, and it is the wall pattern abandoned: a wall commits
 * the straightest thing that still fits, and so should this. A station now
 * has to earn its place by the ground under it actually differing from what
 * the stretch either side of it already says.
 */
const TERRAIN_HEIGHT_TOLERANCE = 0.2;

/** How finely the ground is read while deciding whether it needs a station. */
const TERRAIN_PROBE_STEP = 1.0;

/** The height interpolated along the stroke polyline nearest this ground position. */
function groundHeightNear(
  stroke: readonly ConstructionPosition[],
  x: number,
  z: number,
): number {
  if (stroke.length === 0) return 0;
  if (stroke.length === 1) return stroke[0]!.y;

  let minDistanceSq = Infinity;
  let interpolatedY = stroke[0]!.y;

  for (let i = 0; i + 1 < stroke.length; i += 1) {
    const a = stroke[i]!;
    const b = stroke[i + 1]!;
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const lenSq = abx * abx + abz * abz;
    if (lenSq < 1e-9) {
      const dSq = (a.x - x) ** 2 + (a.z - z) ** 2;
      if (dSq < minDistanceSq) {
        minDistanceSq = dSq;
        interpolatedY = a.y;
      }
      continue;
    }
    const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / lenSq));
    const projX = a.x + t * abx;
    const projZ = a.z + t * abz;
    const dSq = (projX - x) ** 2 + (projZ - z) ** 2;
    if (dSq < minDistanceSq) {
      minDistanceSq = dSq;
      interpolatedY = a.y + t * (b.y - a.y);
    }
  }

  return interpolatedY;
}

/** One point of the sampled track: where it sits, and whether the run genuinely turns there. */
interface TrackPoint {
  readonly x: number;
  readonly z: number;
  readonly corner: boolean;
}

/**
 * The fitted contour as ground positions -- one control point per fitted
 * corner. Kept few on purpose: `planSpineContour`'s own Catmull-Rom already
 * turns a handful of well-placed corners into a smooth curve (the same
 * few-anchors-plus-a-spline model a wall's own fit uses), so subdividing a
 * corner-to-corner run further here would only add points the curve never
 * needed.
 */
function groundTrack(fitted: readonly FittedEdge[]): readonly TrackPoint[] {
  const first = fitted[0];
  if (first === undefined) return [];
  const track: TrackPoint[] = [{ x: first.start.x, z: first.start.z, corner: true }];
  for (const edge of fitted) {
    track.push({ x: edge.end.x, z: edge.end.z, corner: true });
  }
  return track;
}

/**
 * Simplifies a sequence of samples in the vertical plane using Ramer-Douglas-Peucker:
 * keeps endpoints and any intermediate sample whose height deviates from the chord
 * by more than `tolerance`.
 */
function rdpHeight(
  samples: readonly ConstructionPosition[],
  tolerance: number,
): readonly ConstructionPosition[] {
  if (samples.length <= 2) return samples;
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  let maxDist = 0;
  let maxIndex = 0;
  const run = Math.hypot(last.x - first.x, last.z - first.z);
  for (let i = 1; i < samples.length - 1; i += 1) {
    const pt = samples[i]!;
    const reach = Math.hypot(pt.x - first.x, pt.z - first.z);
    const expectedY = run < 1e-9 ? first.y : first.y + (last.y - first.y) * (reach / run);
    const dist = Math.abs(pt.y - expectedY);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }
  if (maxDist > tolerance) {
    const left = rdpHeight(samples.slice(0, maxIndex + 1), tolerance);
    const right = rdpHeight(samples.slice(maxIndex), tolerance);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

/**
 * The reference line to build the spine from: where the fit decided the
 * road goes, at the height the ground was actually picked at.
 *
 * These points become the spine's own Catmull-Rom control points --
 * `planSpineContour` samples a smooth curve through them, so a corner this
 * function keeps as one point still reads as a genuine bend, and a run of
 * points along a straight, flat stretch still flattens back to the straight
 * chord it was drawn as (`sampleCatmullRom`'s own collinear case).
 */
export function referenceLineFrom(
  fitted: readonly FittedEdge[],
  stroke: readonly ConstructionPosition[],
  ridesTerrain: boolean,
): { readonly line: readonly ConstructionPosition[] } {
  const track = groundTrack(fitted);
  const first = track[0];
  const last = track[track.length - 1];
  if (first === undefined || last === undefined) return { line: [] };

  // A deck spans: its height comes from its own two ends, so the middle stays
  // level instead of sagging onto whatever it crosses. Everything else reads
  // the ground the stroke was drawn over, station by station.
  const startY = groundHeightNear(stroke, first.x, first.z);
  const endY = groundHeightNear(stroke, last.x, last.z);
  let total = 0;
  for (let index = 0; index + 1 < track.length; index += 1) {
    total += Math.hypot(track[index + 1]!.x - track[index]!.x, track[index + 1]!.z - track[index]!.z);
  }
  let travelled = 0;
  const heightAt = (x: number, z: number): number => {
    if (ridesTerrain) return groundHeightNear(stroke, x, z);
    return total < 1e-6 ? startY : startY + (endY - startY) * (travelled / total);
  };

  // Walked as one continuous arc length rather than segment by segment.
  // Subdividing each fitted segment on its own recomputed the step from
  // scratch every time, so a 2.0 m segment got one station and a 2.1 m
  // segment got two -- neighbouring ribs differing by a factor of two, and
  // far worse beside the short segments a corner produces. The step is now
  // uniform along the whole run, and only a genuine corner interrupts it.
  const line: ConstructionPosition[] = [
    { x: first.x, y: heightAt(first.x, first.z), z: first.z },
  ];
  const push = (x: number, z: number): void => {
    const previous = line[line.length - 1]!;
    // Two stations at one spot would collapse into a zero-length curve
    // segment.
    if (Math.hypot(x - previous.x, z - previous.z) < 1e-4) return;
    line.push({ x, y: heightAt(x, z), z });
  };

  // Every point the fit itself produced is a control point: a corner because
  // the run genuinely turns there. What is *not* automatic any more is
  // anything between them. A stretch gets extra control points only where
  // the ground under it strays from the straight line the stretch would
  // otherwise be -- so a straight road over flat ground is two control
  // points, and a straight road over a ridge is exactly as many as the
  // ridge needs.
  for (let index = 0; index + 1 < track.length; index += 1) {
    const from = track[index]!;
    const to = track[index + 1]!;
    const span = Math.hypot(to.x - from.x, to.z - from.z);
    if (span < 1e-9) continue;

    if (ridesTerrain && span > TERRAIN_PROBE_STEP) {
      const samples: ConstructionPosition[] = [];
      for (let d = 0; d < span; d += TERRAIN_PROBE_STEP) {
        const ratio = d / span;
        const x = from.x + (to.x - from.x) * ratio;
        const z = from.z + (to.z - from.z) * ratio;
        samples.push({ x, y: groundHeightNear(stroke, x, z), z });
      }
      samples.push({ x: to.x, y: groundHeightNear(stroke, to.x, to.z), z: to.z });
      const simplified = rdpHeight(samples, TERRAIN_HEIGHT_TOLERANCE);
      for (let i = 1; i < simplified.length; i += 1) {
        const pt = simplified[i]!;
        push(pt.x, pt.z);
      }
    } else {
      travelled += span;
      push(to.x, to.z);
    }
  }
  // The run has to end where it was drawn, corner or not.
  push(last.x, last.z);
  return { line };
}
