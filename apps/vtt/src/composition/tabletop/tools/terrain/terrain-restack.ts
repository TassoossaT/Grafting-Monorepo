import type { AtomicEditOp, ResolvedCoverage } from "@/features/edit-construction";
import type { ConstructionCoveredRegion, ConstructionNodeId, ConstructionPosition } from "@/ports";

// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time. The type-only
// `@/` imports above are fine -- those are erased.
import { resolveCoverage } from "../../../../features/edit-construction/index.ts";

import type { ToolContext } from "../core/tool-context.ts";

/**
 * Painting terrain over terrain **adds ground to it** -- by moving the vertices
 * it already has, and nothing else.
 *
 * A load of earth, not a platform. Every node the covered faces stand on goes
 * up by an amount that falls off toward the edge of the stroke, so the result
 * is a mound: most where the brush passed, nothing at all where it stopped.
 * A flat step for every covered node built a plateau with a cliff around it,
 * and the cliff then had to be met by whatever stood outside the stroke --
 * which is a seam made of height rather than of topology.
 *
 * The faces come along for free: a region is a loop of edges over shared
 * nodes, so moving a node *is* moving every face that references it. No face
 * is deleted, no face is recreated, no node gains a twin, and the element
 * count of the map is exactly the same before and after -- which is the whole
 * reason to express "add ground" as a move rather than as geometry. Painting
 * the same hill twenty times costs twenty moves and not one new vertex.
 *
 * **Why not delete-and-rebuild.** The earlier version removed the covered
 * faces, generated elevated copies with fresh `:upN` node ids, and stitched
 * a band of side faces onto the rim the removal exposed. That is the recipe
 * for a *step*, and it costs a duplicated node plus a new face for every
 * edge on the perimeter -- every stroke, compounding, since the next
 * stroke's rim is the previous band's top. It also churned node identity
 * (`v183` -> `v183:up7` -> `v183:up7:up12`), stranding history entries that
 * referenced the old ids.
 *
 * Moving instead means the boundary nodes stay *shared* with the ground that
 * was not painted, so the neighbouring faces tilt into a ramp rather than
 * tearing open a cliff that then needs filling. No step, no gap, no band --
 * the hole never exists in the first place, so there is nothing to stitch.
 * The falloff makes that ramp the rule instead of a happy accident: a node on
 * the rim of the stroke moves by nearly nothing, so the tilt it hands its
 * unpainted neighbours is small however many times the middle is painted.
 */

/** How far one stroke raises the ground under the middle of the brush. */
export const ELEVATION_STEP = 0.5;

/**
 * The shape of one load of earth: `1` under the brush, easing to `0` at its
 * rim.
 *
 * Smoothstep rather than a straight taper because the derivative matters more
 * than the value here -- a linear falloff leaves a visible crease where the
 * mound meets flat ground, since the slope jumps from something to nothing at
 * a point. Smoothstep arrives flat.
 */
export function dirtProfile(normalizedDistance: number): number {
  const t = 1 - Math.min(Math.max(normalizedDistance, 0), 1);
  return t * t * (3 - 2 * t);
}

/** Square of the distance from `point` to the segment `from`-`to`, in XZ. */
function distanceSqToSegment(
  point: ConstructionPosition,
  from: ConstructionPosition,
  to: ConstructionPosition,
): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const lengthSq = dx * dx + dz * dz;
  const along =
    lengthSq > 0
      ? Math.min(Math.max(((point.x - from.x) * dx + (point.z - from.z) * dz) / lengthSq, 0), 1)
      : 0;
  const cx = from.x + dx * along - point.x;
  const cz = from.z + dz * along - point.z;
  return cx * cx + cz * cz;
}

/**
 * How much earth lands on a given point: the profile, measured from the path
 * the brush actually travelled.
 *
 * From the path rather than from the covered faces' own extent, because the
 * brush is what the person moved -- a face clipped by the very edge of the
 * stroke should barely rise, whoever else it touches.
 */
export function dirtLoadOver(
  path: readonly ConstructionPosition[],
  radius: number,
): (point: ConstructionPosition) => number {
  return (point) => {
    let nearestSq = Infinity;
    for (let index = 0; index < path.length; index += 1) {
      const from = path[index]!;
      const to = path[index + 1] ?? from;
      nearestSq = Math.min(nearestSq, distanceSqToSegment(point, from, to));
    }
    return dirtProfile(Math.sqrt(nearestSq) / radius);
  };
}

export interface RestackOutcome {
  readonly raisedFaces: number;
  /** Distinct nodes actually moved -- shared corners count once. */
  readonly movedVertices: number;
  /**
   * Why some covered faces were left alone -- a wall the brush centred on,
   * most commonly. Reported rather than thrown: refusing the *whole* stroke
   * over one such face was the earlier behaviour, and it meant painting
   * terrain anywhere near a wall did nothing at all, since a wall stands on
   * terrain and therefore always overlaps it in XZ.
   */
  readonly skipped: readonly string[];
}

/**
 * The faces a terrain stroke should raise: those the brush covers whole.
 * A face the brush merely clips is left alone -- raising it would drag
 * ground the user never painted over.
 */
export function facesToRaise(resolved: readonly ResolvedCoverage[]): readonly ConstructionCoveredRegion[] {
  return resolved
    .filter((entry) => entry.interaction.kind === "restack" && entry.covered.coverage === "centroid")
    .map((entry) => entry.covered);
}

/**
 * Raises every covered face the type table allows.
 *
 * A face the table forbids -- a wall the brush centred on -- is left alone
 * and reported in `skipped`, not thrown. The stroke still does everything
 * else it was asked to.
 */
export function restackTerrain(
  ctx: ToolContext,
  paintedType: string,
  covered: readonly ConstructionCoveredRegion[],
  causeId: string,
  /** How much of a full step lands on a given node. Defaults to all of it. */
  loadAt: (point: ConstructionPosition) => number = () => 1,
): RestackOutcome {
  const resolved = resolveCoverage(paintedType, covered);
  // Only a face the brush actually covers can be refused; one it merely
  // clips is none of this stroke's business either way.
  const skipped = [
    ...new Set(
      resolved
        .filter((entry) => entry.covered.coverage === "centroid" && entry.interaction.kind === "forbid")
        .map((entry) => (entry.interaction.kind === "forbid" ? entry.interaction.reason : "")),
    ),
  ].filter((reason) => reason.length > 0);

  const raising = facesToRaise(resolved);
  if (raising.length === 0) return { raisedFaces: 0, movedVertices: 0, skipped };

  // A node shared by two raised faces must move once, not once per face --
  // moving it twice would raise that corner a full step above the rest and
  // tear the patch it is supposed to hold together.
  const targets = new Set<ConstructionNodeId>();
  for (const face of raising) {
    for (const nodeId of face.nodeIds) targets.add(nodeId);
  }

  const nodePositions = ctx.runtime.getSnapshot().map.nodePositions;
  const ops: AtomicEditOp[] = [];
  for (const nodeId of targets) {
    const entry = nodePositions.get(nodeId);
    if (entry === undefined) continue;
    const lift = ELEVATION_STEP * loadAt(entry.position);
    // A node the load does not reach is not moved at all. Emitting a zero
    // move would still mark its faces dirty and cost a render fold for a
    // change nobody can see.
    if (lift <= 1e-6) continue;
    const position: ConstructionPosition = {
      x: entry.position.x,
      y: entry.position.y + lift,
      z: entry.position.z,
    };
    ops.push({ kind: "move-vertex", nodeId, position });
  }
  if (ops.length === 0) return { raisedFaces: 0, movedVertices: 0, skipped };

  ctx.runtime.applyRegionEdit(ops, "local", causeId);
  return { raisedFaces: raising.length, movedVertices: ops.length, skipped };
}
