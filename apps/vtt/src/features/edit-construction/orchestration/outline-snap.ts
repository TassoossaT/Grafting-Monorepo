import type { ConstructionPosition, ConstructionRegionTopology } from "@/ports";

import type { HandleMotion } from "../global-handles/index.ts";
import { faceKey, nearestOnSegment, segmentGap } from "../topology/plan-geometry.ts";

/**
 * A structure dragged by a handle snaps onto the outline of the others
 * standing at its level: a wall's foot onto a platform's corner or side, a
 * platform's side onto the run a wall stands on. What snaps are the dragged
 * nodes at the bottom of what the handle moves -- its anchors; what they snap
 * to -- the magnets -- are the level runs of every other structure's outline:
 * a floor's whole outline, a wall's foot and top. Nothing here asks what any
 * structure is; a corner wins over a side, and the handle keeps to its own
 * path while snapping.
 */

/** How close, in plan, an anchor must come to a magnet to snap onto it. */
export const SNAP_REACH = 0.2;
/** How far apart in height an anchor and a magnet may stand and still be at one level. */
const LEVEL = 0.05;

/** A level run of another structure's outline, by its two nodes. */
export interface Magnet {
  readonly a: { readonly id: string; readonly position: ConstructionPosition };
  readonly b: { readonly id: string; readonly position: ConstructionPosition };
}

/** A node the handle drags that may snap, where it stood when the drag began. */
export interface SnapAnchor {
  readonly id: string;
  readonly position: ConstructionPosition;
}

/** The snapped displacement, which anchor snapped, and the nodes of what it snapped onto. */
export interface OutlineSnap {
  readonly delta: ConstructionPosition;
  readonly anchor: string;
  readonly magnet: readonly string[];
}


/** Every level run of the outlines of `topologies` but those `skip` names, and the ground's -- what a dragged structure snaps onto. */
export function outlineMagnets(topologies: readonly ConstructionRegionTopology[], skip: ReadonlySet<string>, isGround: (surfaceType: string) => boolean): readonly Magnet[] {
  const seen = new Set<string>();
  const magnets: Magnet[] = [];
  for (const topology of topologies) {
    if (skip.has(faceKey(topology)) || isGround(topology.surfaceType)) continue;
    const at = new Map(topology.nodes.map((node) => [node.id, node.position]));
    for (const use of topology.outerLoops.flat()) {
      if (use.geometry.kind !== "line") continue;
      const a = at.get(use.startNodeId)!, b = at.get(use.endNodeId)!;
      const key = use.startNodeId < use.endNodeId ? `${use.startNodeId}|${use.endNodeId}` : `${use.endNodeId}|${use.startNodeId}`;
      if (Math.abs(a.y - b.y) > LEVEL || Math.hypot(b.x - a.x, b.z - a.z) < 1e-6 || seen.has(key)) continue;
      seen.add(key);
      magnets.push({ a: { id: use.startNodeId, position: a }, b: { id: use.endNodeId, position: b } });
    }
  }
  return magnets;
}


/**
 * `delta` snapped: the anchors, moved by it, onto the nearest magnet corner
 * within {@link SNAP_REACH}, else onto the nearest magnet run -- only ever
 * along the handle's own `motion`; `undefined` when none is within reach.
 */
export function snapToOutlines(anchors: readonly SnapAnchor[], delta: ConstructionPosition, motion: HandleMotion, magnets: readonly Magnet[], reach = SNAP_REACH): OutlineSnap | undefined {
  const line = motion.kind === "line" ? motion.direction : undefined;
  if (!line && motion.kind !== "plane" && motion.kind !== "free") return undefined;
  let corner: (OutlineSnap & { readonly distance: number }) | undefined;
  let side: (OutlineSnap & { readonly distance: number }) | undefined;
  for (const anchor of anchors) {
    const p = { x: anchor.position.x + delta.x, y: anchor.position.y + delta.y, z: anchor.position.z + delta.z };
    for (const magnet of magnets) {
      if (Math.abs(magnet.a.position.y - p.y) > LEVEL) continue;
      for (const end of [magnet.a, magnet.b]) {
        // Never back onto itself where it began -- a node another structure shares would hold every small move there.
        if (end.id === anchor.id) continue;
        let fix = { x: end.position.x - p.x, z: end.position.z - p.z };
        // Along its line only: a corner off the handle's path is not snapped to.
        if (line) {
          const along = fix.x * line.x + fix.z * line.z;
          if (Math.hypot(fix.x - line.x * along, fix.z - line.z * along) > 1e-3) continue;
          fix = { x: line.x * along, z: line.z * along };
        }
        const distance = Math.hypot(fix.x, fix.z);
        if (distance <= reach && (!corner || distance < corner.distance)) {
          corner = { delta: { x: delta.x + fix.x, y: delta.y, z: delta.z + fix.z }, anchor: anchor.id, magnet: [end.id], distance };
        }
      }
      let fix: { x: number; z: number } | undefined;
      if (line) {
        // Onto the run's line along the anchor's path -- as long as what the handle drags then meets the run itself.
        const a = magnet.a.position, b = magnet.b.position;
        const ex = b.x - a.x, ez = b.z - a.z;
        const cross = line.x * ez - line.z * ex;
        if (Math.abs(cross) < 1e-9) continue;
        const s = ((a.x - p.x) * ez - (a.z - p.z) * ex) / cross;
        fix = { x: line.x * s, z: line.z * s };
        const moved = anchors.map((other) => ({ x: other.position.x + delta.x + fix!.x, z: other.position.z + delta.z + fix!.z }));
        if (segmentGap(moved[0]!, moved[moved.length - 1]!, a, b) > 1e-3) continue;
      } else {
        const q = nearestOnSegment(p, magnet.a.position, magnet.b.position);
        fix = { x: q.x - p.x, z: q.z - p.z };
      }
      const distance = Math.hypot(fix.x, fix.z);
      if (distance <= reach && (!side || distance < side.distance)) {
        side = { delta: { x: delta.x + fix.x, y: delta.y, z: delta.z + fix.z }, anchor: anchor.id, magnet: [magnet.a.id, magnet.b.id], distance };
      }
    }
  }
  const snapped = corner ?? side;
  return snapped && { delta: snapped.delta, anchor: snapped.anchor, magnet: snapped.magnet };
}
