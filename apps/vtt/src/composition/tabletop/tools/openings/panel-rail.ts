import type {
  ConstructionEdgeGeometry,
  ConstructionPosition,
  ConstructionRegionEdge,
  ConstructionRegionTopology,
} from "@/ports";

import { reverseGeometry } from "../core/boundary-edges.ts";

/**
 * Reading an upright face as a rail: where its base runs, how tall it
 * stands, and how to put a point anywhere on it.
 *
 * This is the same unrolling the mesh does, on this side of the boundary and
 * for the opposite reason. There it flattens a panel so it can be
 * triangulated; here it flattens one so a caller can say "an opening this
 * wide, this far along, this high" without caring whether the wall is
 * straight or curved. A chord is an arc whose radius has gone to infinity,
 * so both are the same two coordinates: distance along the rail, and height.
 */

/** How close two XZ points must be to count as one upright side rather than a run. */
const UPRIGHT_EPSILON = 1e-4;

type Frame =
  | { readonly kind: "chord"; readonly origin: readonly [number, number]; readonly direction: readonly [number, number] }
  | {
      readonly kind: "cylinder";
      readonly center: readonly [number, number];
      readonly radius: number;
      readonly startAngle: number;
      readonly clockwise: boolean;
    };

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
   * The rail's own curvature, as an edge geometry walked in the direction of
   * increasing travel. A straight panel reads as a line; a curved one carries
   * the arc, so anything stamped onto the panel bends with it.
   */
  readonly geometry: ConstructionEdgeGeometry;
}

function angleAround(center: readonly [number, number], x: number, z: number): number {
  return Math.atan2(z - center[1], x - center[0]);
}

/** Sweep from `from` to `to` in the given direction, always in `[0, 2*PI)`. */
function sweep(from: number, to: number, clockwise: boolean): number {
  const raw = clockwise ? from - to : to - from;
  const wrapped = raw % (Math.PI * 2);
  return wrapped < 0 ? wrapped + Math.PI * 2 : wrapped;
}

/** The geometry of `edge` as the loop actually walks it. */
function walkedGeometry(edge: ConstructionRegionEdge): ConstructionEdgeGeometry {
  return edge.reversed ? reverseGeometry(edge.geometry) : edge.geometry;
}

function isUpright(start: ConstructionPosition, end: ConstructionPosition): boolean {
  return (
    Math.abs(start.x - end.x) <= UPRIGHT_EPSILON &&
    Math.abs(start.z - end.z) <= UPRIGHT_EPSILON &&
    Math.abs(start.y - end.y) > UPRIGHT_EPSILON
  );
}

function frameOf(geometry: ConstructionEdgeGeometry, start: ConstructionPosition): Frame | undefined {
  if (geometry.kind === "arc") {
    const radius = Math.hypot(start.x - geometry.center[0], start.z - geometry.center[1]);
    if (radius < 1e-6) return undefined;
    return {
      kind: "cylinder",
      center: geometry.center,
      radius,
      startAngle: angleAround(geometry.center, start.x, start.z),
      clockwise: geometry.clockwise,
    };
  }
  return undefined;
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
export function panelRailOf(topology: ConstructionRegionTopology): PanelRail | undefined {
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

  const railStart = base[0]!.start!;
  const geometry = walkedGeometry(base[0]!.edge);
  const frame = frameOf(geometry, railStart);

  const baseY = railStart.y;
  const topY = top[0]!.start!.y;

  // Rail length, run by run, so a subdivided base measures the same as an
  // unbroken one.
  const length = base.reduce((total, step) => {
    const stepGeometry = walkedGeometry(step.edge);
    if (stepGeometry.kind === "arc" && frame?.kind === "cylinder") {
      return total + frame.radius * sweep(
        angleAround(frame.center, step.start!.x, step.start!.z),
        angleAround(frame.center, step.end!.x, step.end!.z),
        stepGeometry.clockwise,
      );
    }
    return total + Math.hypot(step.end!.x - step.start!.x, step.end!.z - step.start!.z);
  }, 0);
  if (!(length > 1e-6) || !(topY > baseY)) return undefined;

  const railEnd = base[base.length - 1]!.end!;
  const chordDirection: readonly [number, number] = [
    (railEnd.x - railStart.x) / Math.hypot(railEnd.x - railStart.x, railEnd.z - railStart.z),
    (railEnd.z - railStart.z) / Math.hypot(railEnd.x - railStart.x, railEnd.z - railStart.z),
  ];
  const resolved: Frame = frame ?? {
    kind: "chord",
    origin: [railStart.x, railStart.z],
    direction: chordDirection,
  };

  const clamp = (travel: number): number => Math.min(Math.max(travel, 0), length);

  return {
    length,
    baseY,
    topY,
    geometry:
      resolved.kind === "cylinder"
        ? { kind: "arc", center: resolved.center, clockwise: resolved.clockwise }
        : { kind: "line" },
    travelTo(point) {
      if (resolved.kind === "chord") {
        return clamp(
          (point.x - resolved.origin[0]) * resolved.direction[0] +
            (point.z - resolved.origin[1]) * resolved.direction[1],
        );
      }
      const angle = angleAround(resolved.center, point.x, point.z);
      return clamp(resolved.radius * sweep(resolved.startAngle, angle, resolved.clockwise));
    },
    positionAt(travel, y) {
      const along = clamp(travel);
      if (resolved.kind === "chord") {
        return {
          x: resolved.origin[0] + resolved.direction[0] * along,
          y,
          z: resolved.origin[1] + resolved.direction[1] * along,
        };
      }
      const swept = along / resolved.radius;
      const angle = resolved.startAngle + (resolved.clockwise ? -swept : swept);
      return {
        x: resolved.center[0] + resolved.radius * Math.cos(angle),
        y,
        z: resolved.center[1] + resolved.radius * Math.sin(angle),
      };
    },
  };
}
