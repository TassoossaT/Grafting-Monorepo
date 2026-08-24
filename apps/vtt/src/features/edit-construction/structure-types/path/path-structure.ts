import type { ConstructionRegionTopology } from "@/ports";

import type { AtomicEditOp, EditTarget } from "../../orchestration/atomic-edit.ts";
import { ALL_AXES, addPosition } from "../../orchestration/atomic-edit.ts";
import { followsOutward, parseStationNodeId } from "./station-node-id.ts";
import type { CascadeContext, EditRole, RolePolicy, StructureTypeDefinition } from "../structure-type.ts";
import { allowed, denied } from "../structure-type.ts";
import type { CreationInteraction } from "../creation-interaction.ts";

/**
 * The role model for anything swept along a travel line: a spine, whatever
 * lies between the spine and the rim, and the rim itself.
 *
 * **The whole rule is one sentence.** Dragging a node carries every node of
 * its own station that lies further out on the same side. The spine's "further
 * out" is the entire cross-section; a node partway out carries only what is
 * beyond it; the rim carries nothing, because nothing is beyond it. That
 * single rule replaces a per-slot table, and it is why there is no separate
 * `contour` role here to keep in sync with a `rib` one.
 *
 * **Same-delta, deliberately.** Nothing is recomputed. A drag does not re-run
 * the recipe or re-derive the mitre frame, so a corner made by dragging the
 * spine narrows the way any hand-edited shape narrows. That is the model this
 * repo already commits to for walls -- the graph is the truth and the recipe
 * only seeds it -- and it is what lets the whole cascade be plain same-delta
 * ops, which is all `RolePolicy` supports.
 *
 * **Widening has a direction now.** Because the cross-section is materialised
 * as real nodes out to the rim, pushing the rim outward is an ordinary edit
 * rather than a width parameter that would need the frame recomputed to mean
 * anything.
 */

export const PATH_ROLES = {
  spine: "path-spine",
  across: "path-across",
  body: "path-body",
  /** Along the travel line: the seam the two central bands meet on. */
  spineEdge: "path-spine-edge",
  /** Along the run at an extreme slot -- one side of the outer contour. */
  contourEdge: "path-contour-edge",
  /** Across the run, within one station: what links the spine to a contour. */
  ribEdge: "path-rib-edge",
  edge: "path-edge",
  unknown: "path-unknown",
} as const;

/**
 * Which of the three parts an edge belongs to, read off its two endpoints.
 *
 * An edge running between two nodes of the same slot runs *along* the run; at
 * slot 0 that is the spine, at an extreme slot it is a contour. An edge
 * between two slots of one station runs *across* it, which is a rib. The
 * classification is the same fact the ids already carry, and having it in the
 * role table rather than only in a viewer is what lets an edit rule -- or a
 * colour -- ask the type instead of re-deriving it.
 */
function pathEdgeRole(
  topology: ConstructionRegionTopology,
  edgeId: string,
): EditRole {
  for (const loop of [...topology.outerLoops, ...topology.holes]) {
    for (const use of loop) {
      if (use.edgeId !== edgeId) continue;
      const start = parseStationNodeId(use.startNodeId);
      const end = parseStationNodeId(use.endNodeId);
      if (start === undefined || end === undefined) return PATH_ROLES.edge;
      // Read off the slots alone, and only the slots.
      //
      // Two ends on one slot run *along* the road: the travel line if that
      // slot is the spine, an outer contour if it is an extreme. Two ends on
      // different slots run *across* it, which is a rib -- however far apart
      // their stations are, and whichever runs they were minted by.
      //
      // Comparing stations as well is what put a V of contour across every T.
      // The rib closing an arriving road onto the junction goes from that
      // road's own corner to a spine node the *other* road minted, so the two
      // stations are on different scales and never match. Read as neither
      // along nor across, it fell through to nothing in particular and drew
      // as a rim -- a contour touching the spine, which is precisely what a
      // contour may never do.
      if (start.across === end.across) {
        return start.across === 0 ? PATH_ROLES.spineEdge : PATH_ROLES.contourEdge;
      }
      return PATH_ROLES.ribEdge;
    }
  }
  return PATH_ROLES.edge;
}

export function pathRoleFor(topology: ConstructionRegionTopology, target: EditTarget): EditRole {
  if (target.kind === "region") return PATH_ROLES.body;
  if (target.kind === "edge") return pathEdgeRole(topology, target.edgeId);
  const address = parseStationNodeId(target.nodeId);
  if (address === undefined) return PATH_ROLES.unknown;
  return address.across === 0 ? PATH_ROLES.spine : PATH_ROLES.across;
}

/**
 * Every node outward of the grabbed one, in its own station, moved by the
 * same delta.
 *
 * Scans the whole cloud, not the grabbed band, because a station is spread
 * across several of them: the spine is shared by the two bands either side of
 * it, while the rim belongs only to the outermost band. A cascade that could
 * see one region alone would reach the rib and stop short of the rim.
 *
 * The cloud is the right list rather than merely a convenient one. It is
 * every same-type band reachable through shared nodes -- which is exactly
 * what one swept run is -- so it follows a station through a whole path
 * instead of only to the grabbed band's immediate neighbours, and it never
 * offers up a terrain patch that happens to touch the rim.
 */
function outwardOfGrabbed(context: CascadeContext): readonly AtomicEditOp[] {
  const { cloud, target, delta } = context;
  if (target.kind !== "vertex") return [];
  const moved = parseStationNodeId(target.nodeId);
  if (moved === undefined) return [];

  const ops = new Map<string, AtomicEditOp>();
  for (const region of cloud.members) {
    for (const node of region.nodes) {
      if (node.id === target.nodeId || ops.has(node.id)) continue;
      const address = parseStationNodeId(node.id);
      if (address === undefined || !followsOutward(moved, address)) continue;
      ops.set(node.id, {
        kind: "move-vertex",
        nodeId: node.id,
        position: addPosition(node.position, delta),
      });
    }
  }
  return [...ops.values()];
}

export function pathPolicyFor(role: EditRole): RolePolicy {
  switch (role) {
    // Height included on purpose: lifting a spine station off the ground is
    // how a run stops riding the terrain, which is the whole of a bridge deck.
    //
    // Scope is `"surface"` for every part-level role here, and it is not a
    // hedge: the primary op names one node or one edge, and the reach past
    // it is the cascade's, declared above. Widening scope as well would move
    // each band a second time.
    case PATH_ROLES.spine:
      return allowed(role, ALL_AXES, "surface", outwardOfGrabbed);
    case PATH_ROLES.across:
      return allowed(role, ALL_AXES, "surface", outwardOfGrabbed);
    case PATH_ROLES.spineEdge:
    case PATH_ROLES.contourEdge:
    case PATH_ROLES.ribEdge:
    case PATH_ROLES.edge:
      // `moveEdge` already carries both endpoints; each of those carries its
      // own station outward through the vertex rule, so a spine edge drags
      // the two cross-sections it spans without a rule of its own.
      return allowed(role, ALL_AXES, "surface");
    // The body is the run, not the band under the pointer -- the same answer
    // a wall's body gives, for the same reason: a swept path is one thing
    // that happens to be stored as many.
    case PATH_ROLES.body:
      return allowed(role, ALL_AXES, "cloud");
    default:
      return denied(role, "this part of the path has no editing role");
  }
}

/** Builds one swept-product structure type on the shared spine model. */
export function pathStructureType(
  surfaceType: string,
  label: string,
  creation: string,
  interactionOver: (coveredType: string, paintedSubtype?: string) => CreationInteraction,
): StructureTypeDefinition {
  return Object.freeze({
    surfaceType,
    label,
    creation,
    roleFor: pathRoleFor,
    policyFor: pathPolicyFor,
    interactionOver,
  });
}
