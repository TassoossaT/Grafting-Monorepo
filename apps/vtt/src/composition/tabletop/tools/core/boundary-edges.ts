import type {
  ConstructionEdgeGeometry,
  ConstructionEdgeId,
  ConstructionNodeId,
  ConstructionOrientedEdgeUse,
  ConstructionPatchEdge,
} from "@/ports";

import type { ToolContext } from "./tool-context.ts";

/**
 * Naming a patch's boundary edges after the *pair of nodes* they run
 * between, so two faces meeting along a line agree on one name for it.
 *
 * Lexicographic order is the whole mechanism: it picks the same
 * representative from either side, which is what turns two coincident edges
 * used once each into one edge used twice. Nothing else makes two
 * independently generated faces agree, and without agreement there is no
 * free-versus-shared distinction left for the engine to read.
 *
 * Every generator names its edges this way. What differs between them is
 * only what to do when the edge is full, which is a per-type rule -- see
 * {@link EdgeSharing}.
 */

const LINE: ConstructionEdgeGeometry = { kind: "line" };

/**
 * The name the edge between two nodes carries, wherever it is named.
 *
 * Exported because declaring a patch is not the only way an edge comes into
 * being: splitting one at a node mints two more, and if those are named any
 * other way then a face declared later over the same pair of nodes gets a
 * second, coincident edge instead of the one already there. One rule, one
 * name, everywhere -- which is what lets a junction share a spine seam with
 * the run it split.
 */
export function sharedEdgeId(
  tableId: string,
  from: ConstructionNodeId,
  to: ConstructionNodeId,
): ConstructionEdgeId {
  return from < to ? `${tableId}:seg:${from}~${to}` : `${tableId}:seg:${to}~${from}`;
}

/**
 * What a generator does when the shared edge it wants has no room left.
 *
 * An edge bounds two faces, one on each side, and the engine refuses a
 * third use or a second one facing the same way. Whether that refusal is
 * correct depends entirely on what the type means by it, so the type says.
 */
export type EdgeSharing =
  /**
   * Share wherever the graph still has room, and keep a private edge over
   * the very same nodes wherever it does not.
   *
   * For a type whose faces legitimately meet more than two to an edge: any
   * number of walls may stand on one column. Sharing is an optimisation
   * there, never the connection itself -- what joins two walls is
   * referencing the same nodes. Without this, a run that reached a column
   * already bounded on both sides had its whole face refused, silently.
   */
  | {
      readonly kind: "private-when-full";
      /** Namespace for an edge this run has to keep to itself. Must be unique per run. */
      readonly runPrefix: string;
      /** Every direction each boundary edge is currently walked in -- {@link boundaryUsage}. */
      readonly existingUses: ReadonlyMap<ConstructionEdgeId, readonly boolean[]>;
    }
  /**
   * Always name the shared edge, and let the engine refuse a face that has
   * no room for it.
   *
   * For a type where a full edge *means* something is already there: an
   * edge with a face on both sides is interior ground, and terrain is never
   * created above anything. The refusal is the rule arriving at the level
   * where it is precise, so overriding it here would be building over the
   * very thing the check exists to protect.
   */
  | { readonly kind: "refuse-when-full" };

/**
 * Every direction each boundary edge on the table is currently walked in.
 *
 * Read once per commit by a `"private-when-full"` generator, so it can tell
 * which boundary it may join from which it has to keep to itself. A
 * `"refuse-when-full"` generator never needs this and should not pay for
 * the scan.
 */
export function boundaryUsage(ctx: ToolContext): ReadonlyMap<ConstructionEdgeId, readonly boolean[]> {
  const uses = new Map<ConstructionEdgeId, boolean[]>();
  for (const topology of ctx.runtime.getAllRegionTopologies()) {
    for (const loop of [...topology.outerLoops, ...topology.holes]) {
      for (const use of loop) {
        const recorded = uses.get(use.edgeId);
        if (recorded === undefined) uses.set(use.edgeId, [use.reversed]);
        else recorded.push(use.reversed);
      }
    }
  }
  return uses;
}

/** Collects the boundary edges one patch declares, and the uses that walk them. */
export interface BoundaryEdges {
  /** Declares (or reuses) the edge between `from` and `to`, given that edge's geometry walked `from` -> `to`, and returns the use that walks it in that direction. Geometry defaults to a straight chord. */
  use(
    from: ConstructionNodeId,
    to: ConstructionNodeId,
    geometry?: ConstructionEdgeGeometry,
  ): ConstructionOrientedEdgeUse;
  /** Every edge declared so far, each exactly once. */
  all(): readonly ConstructionPatchEdge[];
}

/** The same physical curve seen from the other end -- an arc keeps its center and flips its sweep, a chord is symmetric. */
export function reverseGeometry(geometry: ConstructionEdgeGeometry): ConstructionEdgeGeometry {
  if (geometry.kind === "line") return geometry;
  return { kind: "arc", center: geometry.center, clockwise: !geometry.clockwise };
}

export function createBoundaryEdges(tableId: string, sharing: EdgeSharing): BoundaryEdges {
  const edges = new Map<ConstructionEdgeId, ConstructionPatchEdge>();
  const claimed = new Map<ConstructionEdgeId, boolean[]>();

  /** Whether `edgeId` can take one more use walked this way -- counting what the graph holds and what this patch has already claimed. */
  const hasRoom = (edgeId: ConstructionEdgeId, reversed: boolean): boolean => {
    if (sharing.kind !== "private-when-full") return true;
    const uses = [...(sharing.existingUses.get(edgeId) ?? []), ...(claimed.get(edgeId) ?? [])];
    if (uses.length >= 2) return false;
    return uses[0] === undefined || uses[0] !== reversed;
  };

  return {
    use(from, to, geometry = LINE) {
      const forward = from < to;
      const start = forward ? from : to;
      const end = forward ? to : from;
      const reversed = !forward;

      let edgeId: ConstructionEdgeId = sharedEdgeId(tableId, start, end);
      if (sharing.kind === "private-when-full" && !hasRoom(edgeId, reversed)) {
        edgeId = `${sharing.runPrefix}:seg:${start}~${end}`;
        for (let suffix = 2; !hasRoom(edgeId, reversed); suffix += 1) {
          edgeId = `${sharing.runPrefix}:seg:${start}~${end}:${suffix}`;
        }
      }

      claimed.set(edgeId, [...(claimed.get(edgeId) ?? []), reversed]);
      if (!edges.has(edgeId)) {
        // Absent geometry already means a straight chord, so a flat patch
        // stays as small on the wire as it always was.
        const stored = forward ? geometry : reverseGeometry(geometry);
        edges.set(
          edgeId,
          stored.kind === "line"
            ? { edgeId, startNodeId: start, endNodeId: end }
            : { edgeId, startNodeId: start, endNodeId: end, geometry: stored },
        );
      }
      return { edgeId, reversed };
    },

    all() {
      return [...edges.values()];
    },
  };
}
