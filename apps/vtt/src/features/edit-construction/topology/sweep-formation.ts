import type { // Generic formation geometry capability.
  ConstructionEdgeGeometry,
  ConstructionPosition,
  ConstructionSweepPlan,
} from "@/ports";

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

/** The curve a stretch of a formation runs on, if it is not straight. */
export interface SweptArc {
  readonly center: readonly [number, number];
  readonly clockwise: boolean;
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
 *
 * Where a stretch curves, its normal comes from the curve rather than from
 * the chord standing in for it. A station in the middle of an arc then has
 * the *same* normal arriving and leaving, so the mitre resolves to no corner
 * at all -- correctly, because there is none: a circle does not have corners,
 * only the polygon that approximates it does. That is what lets a curved road
 * be smooth instead of faceted, and it is why the rim of one can be declared
 * as a single arc.
 */
export function stationFrame(
  line: readonly ConstructionPosition[],
  index: number,
  miterLimit: number,
  arcs: readonly (SweptArc | undefined)[] = [],
): readonly [number, number] {
  const outgoing = normalLeaving(line, index, arcs);
  const incoming = normalArriving(line, index, arcs);
  if (incoming === undefined) return outgoing ?? [0, 0];
  if (outgoing === undefined) return incoming;

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
 * The offset direction a curve dictates: straight out from its centre.
 *
 * A point offset radially from a circle lands on a **concentric** circle, so
 * an offset arc is the same arc with a different radius -- same centre, same
 * sense of turn. That is the whole reason a road can be curved in the graph
 * rather than chopped: the rim is one arc edge, not fifty chords.
 *
 * Read from the curve rather than from the chords between stations, and that
 * distinction is the point. A chord normal is tilted by half the angle the
 * chord subtends, so offsetting along it lands slightly off the concentric
 * circle -- fine for a polyline, fatal for an arc, whose two ends have to be
 * the same distance from the centre or it is not an arc at all.
 */
function radialNormal(at: ConstructionPosition, arc: SweptArc): readonly [number, number] {
  const dx = at.x - arc.center[0];
  const dz = at.z - arc.center[1];
  const radius = Math.hypot(dx, dz);
  if (radius < COINCIDENT_EPSILON) return [0, 0];
  const sign = arc.clockwise ? 1 : -1;
  return [(sign * dx) / radius, (sign * dz) / radius];
}

/** The normal of the stretch leaving this station, or `undefined` at the end. */
function normalLeaving(
  line: readonly ConstructionPosition[],
  index: number,
  arcs: readonly (SweptArc | undefined)[],
): readonly [number, number] | undefined {
  const next = line[index + 1];
  if (next === undefined) return undefined;
  const arc = arcs[index];
  if (arc !== undefined) return radialNormal(line[index]!, arc);
  return leftNormal(next.x - line[index]!.x, next.z - line[index]!.z);
}

/** The normal of the stretch arriving at this station, or `undefined` at the start. */
function normalArriving(
  line: readonly ConstructionPosition[],
  index: number,
  arcs: readonly (SweptArc | undefined)[],
): readonly [number, number] | undefined {
  const previous = line[index - 1];
  if (previous === undefined) return undefined;
  const arc = arcs[index - 1];
  if (arc !== undefined) return radialNormal(line[index]!, arc);
  return leftNormal(line[index]!.x - previous.x, line[index]!.z - previous.z);
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
  options: {
    /** The curve each span runs on; one shorter than `referenceLine`. */
    readonly arcs?: readonly (SweptArc | undefined)[];
  } = {},
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
  // Dropping a station would slide every later one out from under its curve,
  // so the curves are only trusted while nothing was dropped.
  const arcs = line.length === referenceLine.length ? (options.arcs ?? []) : [];

  const vertices: ConstructionPosition[] = [];
  for (const [index, station] of line.entries()) {
    const frame = stationFrame(line, index, miterLimit, arcs);
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

  // Every lengthwise edge of a curved span is the same arc offset sideways,
  // which is a concentric arc: same centre, same turn. Reported per pair of
  // vertices so the patch can declare the curve itself rather than the chord
  // that stands in for it.
  const curves: { readonly from: number; readonly to: number; readonly geometry: ConstructionEdgeGeometry }[] = [];
  for (const [index, arc] of arcs.entries()) {
    if (arc === undefined || index + 1 >= line.length) continue;
    for (let slot = 0; slot < profile.length; slot += 1) {
      curves.push({
        from: index * profile.length + slot,
        to: (index + 1) * profile.length + slot,
        geometry: { kind: "arc", center: arc.center, clockwise: arc.clockwise },
      });
    }
  }

  return {
    referenceLine: line,
    vertices,
    quads,
    boundary: sweptBoundary(line.length, profile.length),
    curves,
  };
}
