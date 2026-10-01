import type { ConstructionPosition, ConstructionRegionTopology } from "@/ports";

import { faceKey } from "../topology/plan-geometry.ts";

/**
 * What a construction can be joined to or lined up with: the **links** the
 * ruler offers. They are read off the geometry of whatever stands, never off
 * a structure's type -- a new type is on the ruler the moment it has nodes
 * and level runs, with nothing declared anywhere. The ground is the one
 * thing left out: it is what is built on, not what is built against.
 */

/** A node of a standing outline: a corner something can be joined to. */
export interface LinkPoint {
  readonly id: string;
  readonly position: ConstructionPosition;
}

/** A level run of a standing outline, by its two nodes: a side something can lie along. */
export interface LinkRun {
  readonly a: LinkPoint;
  readonly b: LinkPoint;
}

/** Everything a construction can be joined to, lined up with or matched in height to. */
export interface RulerLinks {
  /** The corners: real nodes, which a structure can be joined to. */
  readonly points: readonly LinkPoint[];
  /** The middle of every level run: a place to line up with or land on, never a node to join. */
  readonly midpoints?: readonly LinkPoint[];
  readonly runs: readonly LinkRun[];
  /** The distinct heights at which something stands, ascending. */
  readonly levels: readonly number[];
}

/** How far apart in height two runs' ends may stand and still be one level run. */
const LEVEL_RUN = 0.05;
/** Heights this near each other are one level. */
const LEVEL_MERGE = 1e-3;

const runKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

export interface CollectOptions {
  /** Faces left out by key -- what is being dragged never links to itself. */
  readonly skip?: ReadonlySet<string>;
  /** Whether a `surfaceType` is ground, which has no links. */
  readonly isGround: (surfaceType: string) => boolean;
}

/** The links of every standing face of `topologies` but the ones `options` leave out. */
export function collectLinks(topologies: readonly ConstructionRegionTopology[], options: CollectOptions): RulerLinks {
  const points = new Map<string, LinkPoint>();
  const runs = new Map<string, LinkRun>();
  const midpoints: LinkPoint[] = [];
  const heights: number[] = [];
  for (const topology of topologies) {
    if (options.skip?.has(faceKey(topology)) || options.isGround(topology.surfaceType)) continue;
    const at = new Map(topology.nodes.map((node) => [node.id, node.position]));
    for (const use of [...topology.outerLoops, ...topology.holes].flat()) {
      const a = at.get(use.startNodeId), b = at.get(use.endNodeId);
      if (!a || !b) continue;
      for (const [id, position] of [[use.startNodeId, a], [use.endNodeId, b]] as const) {
        if (points.has(id)) continue;
        points.set(id, { id, position });
        heights.push(position.y);
      }
      if (use.geometry.kind !== "line") continue;
      const key = runKey(use.startNodeId, use.endNodeId);
      if (runs.has(key) || Math.abs(a.y - b.y) > LEVEL_RUN || Math.hypot(b.x - a.x, b.z - a.z) < 1e-6) continue;
      runs.set(key, { a: points.get(use.startNodeId)!, b: points.get(use.endNodeId)! });
      midpoints.push({ id: `mid:${key}`, position: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 } });
    }
  }
  const levels: number[] = [];
  for (const y of heights.sort((p, q) => p - q)) if (levels.length === 0 || y - levels[levels.length - 1]! > LEVEL_MERGE) levels.push(y);
  return { points: [...points.values()], midpoints, runs: [...runs.values()], levels };
}
