import type { ConstructionPosition } from "@/ports";

import type { HandleMotion } from "../global-handles/index.ts";
import { RULER_REACH, resolveRuler, type RulerGuide, type RulerLinks, type RulerMeasure, type RulerMotion, type RulerResult } from "../ruler/index.ts";
import { segmentGap } from "../topology/plan-geometry.ts";

/**
 * A structure dragged by a handle is joined to, lined up with and measured
 * against the others standing at its level -- by the ruler (`ruler/`), which
 * is the only place that knows how. What is dragged are the nodes at the
 * bottom of what the handle moves -- its anchors; the handle keeps to its own
 * path throughout. This is only the translation between a handle's drag and
 * the ruler's question: nothing here asks what any structure is.
 */

/** How close, in plan, an anchor must come to a link to snap onto it. */
export const SNAP_REACH = RULER_REACH;

/** A node the handle drags that may snap, where it stood when the drag began. */
export interface SnapAnchor {
  readonly id: string;
  readonly position: ConstructionPosition;
}

/** The snapped displacement, which anchor snapped, and what it caught. */
export interface OutlineSnap {
  readonly delta: ConstructionPosition;
  readonly anchor: string;
  /** The nodes of the corner or side it landed on; empty for a line-up or a matched length. */
  readonly magnet: readonly string[];
  /** Whether it landed on an outline -- a corner or a side -- and is to be joined there. */
  readonly joins: boolean;
  readonly guides: readonly RulerGuide[];
  readonly measures: readonly RulerMeasure[];
}

const PRIORITY = { point: 0, run: 1, align: 2, length: 3 } as const;

const motionOf = (motion: HandleMotion): RulerMotion | undefined => {
  if (motion.kind === "line") return { kind: "line", direction: motion.direction };
  return motion.kind === "plane" || motion.kind === "free" ? { kind: "free" } : undefined;
};

/** The node ids of what a result landed on: a corner's own, or a side's two ends. */
function landedOn(result: RulerResult): readonly string[] {
  const guide = result.guides.find((candidate) => candidate.kind === "point" || candidate.kind === "run");
  if (guide?.kind === "point") return [guide.node];
  return [];
}

/**
 * `delta` ruled: each anchor, moved by it, asked of the ruler -- the nearest
 * catch of the best kind wins -- only ever along the handle's own `motion`;
 * `undefined` when nothing is within reach. `snap: false` leaves `delta` as
 * it is and only reports what was near, for the guides.
 */
export function snapToOutlines(anchors: readonly SnapAnchor[], delta: ConstructionPosition, motion: HandleMotion, links: RulerLinks, options: { readonly reach?: number; readonly snap?: boolean; readonly origin?: ConstructionPosition } = {}): OutlineSnap | undefined {
  const ruled = motionOf(motion);
  if (!ruled) return undefined;
  let best: { readonly snap: OutlineSnap; readonly rank: number; readonly distance: number } | undefined;
  for (const anchor of anchors) {
    const point = { x: anchor.position.x + delta.x, y: anchor.position.y + delta.y, z: anchor.position.z + delta.z };
    const result = resolveRuler({
      point, links, motion: ruled, skip: new Set([anchor.id]), reach: options.reach, snap: true,
      ...(options.origin ? { origin: options.origin } : {}),
      // Onto a side only as long as what the handle drags then meets that side itself.
      accept: (landing, run) => {
        if (anchors.length < 2) return true;
        const moved = anchors.map((other) => ({ x: other.position.x + delta.x + landing.x - point.x, z: other.position.z + delta.z + landing.z - point.z }));
        return segmentGap(moved[0]!, moved[moved.length - 1]!, run.a.position, run.b.position) <= 1e-3;
      },
    });
    if (!result.caught) continue;
    const fix = { x: result.position.x - point.x, z: result.position.z - point.z };
    const distance = Math.hypot(fix.x, fix.z);
    const rank = PRIORITY[result.caught];
    if (best && (rank > best.rank || (rank === best.rank && distance >= best.distance))) continue;
    const joins = result.caught === "point" || result.caught === "run";
    const magnet = result.caught === "run" ? runNodes(links, result) : landedOn(result);
    const taken = options.snap === false ? delta : { x: delta.x + fix.x, y: delta.y, z: delta.z + fix.z };
    best = { rank, distance, snap: { delta: taken, anchor: anchor.id, magnet, joins, guides: result.guides, measures: result.measures } };
  }
  return best?.snap;
}

/** The two node ids of the side a result landed on. */
function runNodes(links: RulerLinks, result: RulerResult): readonly string[] {
  const guide = result.guides.find((candidate) => candidate.kind === "run");
  if (guide?.kind !== "run") return [];
  const run = links.runs.find((candidate) => candidate.a.position === guide.a && candidate.b.position === guide.b);
  return run ? [run.a.id, run.b.id] : [];
}
