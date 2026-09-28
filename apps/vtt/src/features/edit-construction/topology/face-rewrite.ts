import type { ConstructionPatchEdge, ConstructionPatchRegion, ConstructionRegionTopology } from "@/ports";

import { reverseGeometry } from "./boundary-edges.ts";

/**
 * Standing faces written again as one patch, each edge use becoming the
 * pieces a rewrite asks for -- the same edge renamed through a node let go
 * of, or split at nodes joined partway along it -- walked the same way round
 * and keeping its curve. Letting a structure go, joining it again: every
 * rewrite of standing faces goes through here, so none walks a loop its own
 * way.
 */

type EdgeUse = ConstructionRegionTopology["outerLoops"][number][number];

/** One piece an edge use becomes: the edge it is, walked from node `from` to node `to`. */
export interface EdgePiece {
  readonly edgeId: string;
  readonly from: string;
  readonly to: string;
}

/**
 * The single piece an edge use becomes when its nodes are renamed by
 * `rename`: the edge itself when neither end changed, else a new edge of the
 * operation's own, since an edge through a renamed node is another edge.
 */
export function renamedPiece(use: EdgeUse, rename: (nodeId: string) => string, operationId: string): EdgePiece {
  const from = rename(use.startNodeId), to = rename(use.endNodeId);
  const touched = from !== use.startNodeId || to !== use.endNodeId;
  return { edgeId: touched ? `${operationId}:${use.edgeId}` : use.edgeId, from, to };
}

/** `faces` written again, every edge use replaced by the pieces `piecesOf` answers for it. */
export function rewriteFaces(
  faces: readonly ConstructionRegionTopology[],
  piecesOf: (use: EdgeUse) => readonly EdgePiece[],
  operationId: string,
): { readonly edges: readonly ConstructionPatchEdge[]; readonly regions: readonly ConstructionPatchRegion[] } {
  const edges = new Map<string, ConstructionPatchEdge>();
  const regions: ConstructionPatchRegion[] = [];
  for (const face of faces) {
    const walk = (loop: readonly EdgeUse[]) => loop.flatMap((use) => piecesOf(use).map(({ edgeId, from, to }) => {
      // Stored the way the original edge was, so the use keeps walking it the same way round.
      edges.set(edgeId, use.reversed
        ? { edgeId, startNodeId: to, endNodeId: from, geometry: reverseGeometry(use.geometry) }
        : { edgeId, startNodeId: from, endNodeId: to, geometry: use.geometry });
      return { edgeId, reversed: use.reversed };
    }));
    regions.push({
      regionId: face.surfaceKey[0] === "@region" && face.surfaceKey[1] ? face.surfaceKey[1] : `${operationId}:face:${regions.length}`,
      boundary: walk(face.outerLoops[0] ?? []),
      holes: [...face.outerLoops.slice(1), ...face.holes].map(walk),
      surfaceType: face.surfaceType,
      physical: face.physical,
      ...(face.profile ? { profile: face.profile } : {}),
    });
  }
  return { edges: [...edges.values()], regions };
}
