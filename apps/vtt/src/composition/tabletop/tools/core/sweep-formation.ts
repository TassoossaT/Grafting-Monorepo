import type { ConstructionPosition, ConstructionSweepPlan } from "@/ports";

/**
 * Sweeping a transverse profile along a reference line, in the application.
 *
 * This used to be a call into Rust, and that was the wrong side of the line.
 * Rust's job in this repo is to validate and execute what the application
 * decided -- `wallPatch` and `pathPatch` say as much -- and a sweep is not
 * execution. It decides where every vertex of the road goes, which faces
 * exist, and, most of all, **which rim is the outside of it**. Deciding the
 * outside of a road is the one decision the contour work is entirely about.
 *
 * Keeping it over there cost exactly what you would expect. The rim came back
 * as index arithmetic over a station-by-slot grid -- first column down, last
 * station across, last column back -- which is the true rim of a road
 * standing alone and cannot be anything else. It has no way to know that a
 * stretch of it is now the mouth of a junction, because it has never heard of
 * a junction, a cloud, or a surface type. All of that lives here. So the rim
 * came back wrong and the application had no seam at which to correct it.
 *
 * Now the application owns the whole shape, and Rust is handed a finished
 * patch to register. Nothing about the geometry changed in the move: the
 * frames, the mitre limit and the boundary walk are the same maths. What
 * changed is who may alter them.
 */

/** One sample of a formation's transverse profile. */
export interface TransverseProfilePoint {
  /** Signed world distance from the reference line, left to right. */
  readonly lateralOffset: number;
  /** Height above the reference line's own height at that station. */
  readonly elevation: number;
}

/** Two stations closer than this in XZ are the same station. */
const COINCIDENT_EPSILON = 1e-4;

function xzDistance(left: ConstructionPosition, right: ConstructionPosition): number {
  return Math.hypot(left.x - right.x, left.z - right.z);
}

/**
 * The caller's stations with any coincident repeat dropped.
 *
 * Hygiene, not resampling: it only ever removes, never places. Two stations
 * at one spot give the frame maths no direction to read, and a pointer held
 * still or a grid snap folding samples onto one intersection both produce
 * exactly that. Where the stations go is the caller's decision, because it
 * depends on what the formation runs over.
 */
export function withoutCoincidentStations(
  samples: readonly ConstructionPosition[],
): readonly ConstructionPosition[] {
  const distinct: ConstructionPosition[] = [];
  for (const sample of samples) {
    const previous = distinct[distinct.length - 1];
    if (previous === undefined || xzDistance(previous, sample) > COINCIDENT_EPSILON) {
      distinct.push(sample);
    }
  }
  return distinct;
}

/** Unit left normal of a direction on the ground plane. */
function leftNormal(x: number, z: number): readonly [number, number] {
  const length = Math.hypot(x, z);
  if (length < COINCIDENT_EPSILON) return [0, 0];
  return [-z / length, x / length];
}

/**
 * The direction one station offsets its profile along.
 *
 * At a corner it is the mitre: the bisector of the two neighbouring normals,
 * lengthened so the offset rim still meets both straight stretches, and
 * bounded so a hairpin gets a corner rather than a spike. Same rule the
 * junction mitre follows between two runs -- this one is within one run.
 */
export function stationFrame(
  line: readonly ConstructionPosition[],
  index: number,
  miterLimit: number,
): readonly [number, number] {
  const current = line[index]!;
  if (index === 0) {
    const next = line[1]!;
    return leftNormal(next.x - current.x, next.z - current.z);
  }
  if (index + 1 === line.length) {
    const previous = line[index - 1]!;
    return leftNormal(current.x - previous.x, current.z - previous.z);
  }

  const previous = line[index - 1]!;
  const next = line[index + 1]!;
  const incoming = leftNormal(current.x - previous.x, current.z - previous.z);
  const outgoing = leftNormal(next.x - current.x, next.z - current.z);
  const sumX = incoming[0] + outgoing[0];
  const sumZ = incoming[1] + outgoing[1];
  const length = Math.hypot(sumX, sumZ);
  if (length < COINCIDENT_EPSILON) return outgoing;
  const bisector: readonly [number, number] = [sumX / length, sumZ / length];
  const denominator = bisector[0] * outgoing[0] + bisector[1] * outgoing[1];
  if (Math.abs(denominator) <= COINCIDENT_EPSILON) return outgoing;
  const scale = Math.min(miterLimit, Math.max(-miterLimit, 1 / denominator));
  return [bisector[0] * scale, bisector[1] * scale];
}

/**
 * The rim of a plain formation, as vertex indices.
 *
 * Down the first column, across the last station, back up the last column,
 * and across the first station to close. True of a formation standing on its
 * own, which is the only thing a sweep can know -- everything that makes it
 * *untrue*, a junction above all, is known only where clouds and surface
 * types are. Exported so that side can walk it, compare against it, or
 * replace it outright.
 */
export function sweptBoundary(stationCount: number, profileLength: number): readonly number[] {
  const last = stationCount - 1;
  const boundary: number[] = [];
  for (let station = 0; station < stationCount; station += 1) boundary.push(station * profileLength);
  for (let slot = 1; slot < profileLength; slot += 1) boundary.push(last * profileLength + slot);
  for (let station = last - 1; station >= 0; station -= 1) {
    boundary.push(station * profileLength + profileLength - 1);
  }
  for (let slot = profileLength - 2; slot >= 1; slot -= 1) boundary.push(slot);
  return boundary;
}

/** Why a sweep could not be planned. */
export class SweepFormationError extends Error {}

/**
 * Samples a transverse profile along a reference line into connected quads.
 *
 * Vertices are station-major: every consecutive `profile.length` entries form
 * one transverse station, which is what lets `pathPatch` read a station
 * address straight off a vertex index. Quads reference those shared vertices,
 * so neighbouring strips are connected by construction rather than by welding
 * coincident geometry afterwards.
 */
export function sweepFormation(
  referenceLine: readonly ConstructionPosition[],
  profile: readonly TransverseProfilePoint[],
  miterLimit: number,
): ConstructionSweepPlan {
  if (!Number.isFinite(miterLimit) || miterLimit < 1) {
    throw new SweepFormationError(`a sweep needs a mitre limit of at least 1, got ${miterLimit}`);
  }
  if (profile.length < 2) {
    throw new SweepFormationError("a sweep needs a profile of at least two samples");
  }
  for (let index = 0; index + 1 < profile.length; index += 1) {
    if (profile[index]!.lateralOffset >= profile[index + 1]!.lateralOffset) {
      throw new SweepFormationError("a profile has to run strictly left to right");
    }
  }

  const line = withoutCoincidentStations(referenceLine);
  if (line.length < 2) {
    throw new SweepFormationError("a sweep needs two stations that are not the same station");
  }

  const vertices: ConstructionPosition[] = [];
  for (const [index, station] of line.entries()) {
    const frame = stationFrame(line, index, miterLimit);
    for (const point of profile) {
      vertices.push({
        x: station.x + frame[0] * point.lateralOffset,
        y: station.y + point.elevation,
        z: station.z + frame[1] * point.lateralOffset,
      });
    }
  }

  const quads: (readonly [number, number, number, number])[] = [];
  for (let station = 0; station + 1 < line.length; station += 1) {
    const current = station * profile.length;
    const next = (station + 1) * profile.length;
    for (let slot = 0; slot + 1 < profile.length; slot += 1) {
      quads.push([current + slot, next + slot, next + slot + 1, current + slot + 1]);
    }
  }

  return {
    referenceLine: line,
    vertices,
    quads,
    boundary: sweptBoundary(line.length, profile.length),
  };
}
