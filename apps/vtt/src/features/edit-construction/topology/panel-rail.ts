import type {
  ConstructionEdgeGeometry,
  ConstructionPosition,
  ConstructionRegionEdge,
  ConstructionRegionTopology,
} from "@/ports";

import {
  closestOnContours,
  contourLengths,
  evaluateContour,
  parametersAtDistance,
  subContour,
} from "./contour-geometry.ts";
import type { ContourPort, ContourSpan } from "./contour-geometry.ts";

/**
 * Reading an upright face as a rail: where its base runs, how tall it
 * stands, and how to put a point anywhere on it.
 *
 * This is the same unrolling the mesh does, on this side of the boundary and
 * for the opposite reason. There it flattens a panel so it can be
 * triangulated; here it flattens one so a caller can say "an opening this
 * wide, this far along, this high" without caring whether the wall is
 * straight, arced, or a Bezier. Every one of those questions is the engine's
 * to answer -- it owns what the curve is -- so this only chains the runs
 * together and asks.
 *
 * Lives in `features/edit-construction/topology/` rather than under a tool
 * (its original home) because `panelStructureType`'s own `deriveMotion`
 * needs it too -- an opening riding a corner-stretched, deformed wall is the
 * same rail projection as placing one in the first place, and a structure
 * type in `structure-types/` cannot reach into `composition/tabletop/tools/`
 * without inverting the dependency the module layout documents.
 */

/** How close two XZ points must be to count as one upright side rather than a run. */
const UPRIGHT_EPSILON = 1e-4;

/** One run of the rail's own base: a span, its length, and where its own travel range starts within the whole rail. */
interface RailSegment {
  readonly span: ContourSpan;
  readonly length: number;
  readonly offset: number;
}

/** One upright face, flattened: a rail to travel along and a height to rise through. */
export interface PanelRail {
  /** Rail length in world units -- the full run from one side of the panel to the other. */
  readonly length: number;
  readonly baseY: number;
  readonly topY: number;
  /** Where `point` sits along the rail, clamped to the panel. */
  travelTo(point: ConstructionPosition): number;
  /** The point `travel` along the rail, at height `y`. */
  positionAt(travel: number, y: number): ConstructionPosition;
  /**
   * The rail's own curvature between two travel distances, as an edge
   * geometry walked in the direction of increasing travel -- what a caller
   * stamping something onto the panel (an opening's own rim) must declare
   * for *that* span specifically, not the whole rail's.
   *
   * A straight or arced rail answers this the same way regardless of
   * `from`/`to`: a chord is a chord end to end, and any two points on a
   * circle bound an arc of that same circle. A Bezier rail does not -- its
   * handles are anchored to its own original ends, so a shorter span
   * between two different points needs its own, freshly split, handles or it
   * traces the wrong curve.
   */
  geometryBetween(from: number, to: number): ConstructionEdgeGeometry;
}

/** The geometry of `edge` as the loop actually walks it. */
function walkedGeometry(edge: ConstructionRegionEdge): ConstructionEdgeGeometry {
  return edge.geometry;
}

function isUpright(start: ConstructionPosition, end: ConstructionPosition): boolean {
  return (
    Math.abs(start.x - end.x) <= UPRIGHT_EPSILON &&
    Math.abs(start.z - end.z) <= UPRIGHT_EPSILON &&
    Math.abs(start.y - end.y) > UPRIGHT_EPSILON
  );
}

/** Every run's own frame, chained end to end -- the segment whose own travel range contains `travel`, clamped at either end of the whole rail. */
function segmentAt(segments: readonly RailSegment[], travel: number): RailSegment {
  const last = segments[segments.length - 1]!;
  const clamped = Math.min(Math.max(travel, 0), last.offset + last.length);
  let index = 0;
  while (index < segments.length - 1 && clamped >= segments[index]!.offset + segments[index]!.length) index += 1;
  return segments[index]!;
}

/**
 * Reads a face as an upright panel: a run along the base, one side rising, a
 * run back along the top, one side coming down.
 *
 * Found by locating exactly two upright sides rather than by counting edges,
 * so a panel whose base has since been subdivided -- a T-junction welding
 * another wall onto its side -- is still the same panel. `undefined` for
 * anything that is not one, which is the whole of "you cannot put an opening
 * here".
 */
export function panelRailOf(port: ContourPort, topology: ConstructionRegionTopology): PanelRail | undefined {
  const [outer] = topology.outerLoops;
  if (outer === undefined || outer.length < 3) return undefined;

  const positionOf = (nodeId: string): ConstructionPosition | undefined =>
    topology.nodes.find((node) => node.id === nodeId)?.position;

  const walked = outer.map((edge) => ({
    edge,
    start: positionOf(edge.startNodeId),
    end: positionOf(edge.endNodeId),
  }));
  if (walked.some((step) => step.start === undefined || step.end === undefined)) return undefined;

  const sides = walked
    .map((step, index) => (isUpright(step.start!, step.end!) ? index : -1))
    .filter((index) => index >= 0);
  if (sides.length !== 2) return undefined;

  const [first, second] = sides as [number, number];
  const between = walked.slice(first + 1, second);
  const around = [...walked.slice(second + 1), ...walked.slice(0, first)];
  if (between.length === 0 || around.length === 0) return undefined;

  const meanY = (run: typeof walked): number =>
    run.reduce((sum, step) => sum + step.start!.y, 0) / run.length;
  const base = meanY(between) <= meanY(around) ? between : around;
  const top = base === between ? around : between;

  const baseY = base[0]!.start!.y;
  const topY = top[0]!.start!.y;
  if (!(topY > baseY)) return undefined;

  const spans: ContourSpan[] = base.map((step) => ({ geometry: walkedGeometry(step.edge), start: step.start!, end: step.end! }));
  const lengths = contourLengths(port, spans);
  let offset = 0;
  const segments: RailSegment[] = spans.map((span, index) => {
    const segment: RailSegment = { span, length: lengths[index] ?? 0, offset };
    offset += segment.length;
    return segment;
  });
  const length = offset;
  if (!(length > 1e-6)) return undefined;

  return {
    length,
    baseY,
    topY,
    travelTo(point) {
      // Every run answers at once: the nearest of them is where the rail was grabbed.
      const closest = closestOnContours(port, segments.map((segment) => segment.span), point);
      let best = 0;
      let bestDistanceSq = Infinity;
      closest.forEach((hit, index) => {
        const segment = segments[index]!;
        const distanceSq = (point.x - hit.position[0]) ** 2 + (point.z - hit.position[1]) ** 2;
        if (distanceSq < bestDistanceSq) {
          bestDistanceSq = distanceSq;
          best = segment.offset + segment.length * hit.t;
        }
      });
      return Math.min(Math.max(best, 0), length);
    },
    positionAt(travel, y) {
      const segment = segmentAt(segments, travel);
      const [t = 0] = parametersAtDistance(port, segment.span, [travel - segment.offset]);
      const [position] = evaluateContour(port, segment.span, [t]);
      return position === undefined ? { x: segment.span.start.x, y, z: segment.span.start.z } : { ...position, y };
    },
    geometryBetween(from, to) {
      const clampedFrom = Math.min(Math.max(from, 0), length);
      const clampedTo = Math.min(Math.max(to, 0), length);
      const segment = segmentAt(segments, clampedFrom);
      const segmentEnd = segment.offset + segment.length;
      const [t0 = 0, t1 = 1] = parametersAtDistance(port, segment.span, [
        clampedFrom - segment.offset,
        Math.min(clampedTo, segmentEnd) - segment.offset,
      ]);
      return subContour(port, segment.span, t0, t1);
    },
  };
}
