import { resolveCoverage, type AtomicEditOp, type ResolvedCoverage } from "@/features/edit-construction";
import type { ConstructionCoveredRegion, ConstructionNodeId, ConstructionPosition } from "@/ports";

import type { ToolContext } from "./tool-context.ts";

/**
 * Painting terrain over terrain **raises** it -- by moving the vertices it
 * already has, and nothing else.
 *
 * Every node the covered faces stand on goes up one step. The faces come
 * along for free: a region is a loop of edges over shared nodes, so moving a
 * node *is* moving every face that references it. No face is deleted, no
 * face is recreated, no node gains a twin, and the element count of the map
 * is exactly the same before and after.
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
 */

/** How far one stroke raises the ground it covers. */
export const ELEVATION_STEP = 0.5;

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
    const position: ConstructionPosition = {
      x: entry.position.x,
      y: entry.position.y + ELEVATION_STEP,
      z: entry.position.z,
    };
    ops.push({ kind: "move-vertex", nodeId, position });
  }
  if (ops.length === 0) return { raisedFaces: 0, movedVertices: 0, skipped };

  ctx.runtime.applyRegionEdit(ops, "local", causeId);
  return { raisedFaces: raising.length, movedVertices: ops.length, skipped };
}
