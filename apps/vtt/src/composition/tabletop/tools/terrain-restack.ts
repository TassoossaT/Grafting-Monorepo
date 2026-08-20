import { resolveCoverage, type ResolvedCoverage } from "@/features/edit-construction";
import type {
  ConstructionCoveredRegion,
  ConstructionNodeId,
  ConstructionOrientedEdgeUse,
  ConstructionPosition,
  ConstructionRegionEdge,
} from "@/ports";

import type { ToolContext } from "./tool-context.ts";

/**
 * Painting terrain over terrain **raises** it.
 *
 * The covered faces are deleted, the same faces are recreated one step
 * above, and the rim the removal exposed is stitched to the raised patch by
 * a band of side faces -- one per rim edge. Nothing is laid on top of
 * anything: the old faces are gone, so a stroke over the same ground twice
 * raises it twice instead of stacking a second lattice over the first.
 *
 * **Why the band reuses the rim edge rather than rebuilding it.** The rim
 * edges survive the removal because the *unraised* neighbours still hold
 * them. Registering the band through `addSurface` would derive its own fresh
 * edge along that same line -- coincident with the neighbour's, but a
 * different identity, joined to nothing. Reusing the rim edge walked
 * backwards is what makes the band and the neighbour manifold neighbours,
 * and is why this goes through `addRegion` instead.
 */

/** How far one stroke raises the ground it covers. */
export const ELEVATION_STEP = 0.5;

export interface RestackOutcome {
  readonly raisedFaces: number;
  readonly bandFaces: number;
  /**
   * Why some covered faces were left alone -- a wall the brush centred on,
   * most commonly. Reported rather than thrown: refusing the *whole* stroke
   * over one such face was the earlier behaviour, and it meant painting
   * terrain anywhere near a wall did nothing at all, since a wall stands on
   * terrain and therefore always overlaps it in XZ.
   */
  readonly skipped: readonly string[];
}

function elevatedId(nodeId: ConstructionNodeId, salt: number): ConstructionNodeId {
  return `${nodeId}:up${salt}`;
}

function edgeIdFor(prefix: string, from: ConstructionNodeId, to: ConstructionNodeId): string {
  return `${prefix}:${from}->${to}`;
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
 * Raises every covered face the type table allows, and stitches the result
 * back onto the ground around it.
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
  if (raising.length === 0) return { raisedFaces: 0, bandFaces: 0, skipped };

  // Positions must be read *before* the removal: the engine's own orphan
  // cleanup deletes every interior node of the patch, and their heights are
  // what the raised copy is derived from.
  const positions = new Map<ConstructionNodeId, ConstructionPosition>();
  const map = ctx.runtime.getSnapshot().map;
  for (const face of raising) {
    for (const nodeId of face.nodeIds) {
      const entry = map.nodePositions.get(nodeId);
      if (entry !== undefined) positions.set(nodeId, entry.position);
    }
  }

  const salt = ctx.nextSequence();
  const prefix = `${ctx.tableId}:terrain-restack:${salt}`;
  const removal = ctx.runtime.deleteRegions(
    raising.map((face) => face.surfaceKey),
    "local",
    causeId,
  );

  // One elevated twin per node the patch used, including the rim's own --
  // the raised boundary sits directly above the rim, and the band spans
  // between them.
  const elevatedNodes: { readonly id: ConstructionNodeId; readonly position: ConstructionPosition }[] = [];
  for (const [nodeId, position] of positions) {
    elevatedNodes.push({
      id: elevatedId(nodeId, salt),
      position: { x: position.x, y: position.y + ELEVATION_STEP, z: position.z },
    });
  }

  ctx.runtime.applyIrregularTerrainPatch(
    elevatedNodes,
    raising.map((face) => ({
      cycle: face.nodeIds.map((nodeId) => elevatedId(nodeId, salt)),
      surfaceType: paintedType,
      physical: true,
    })),
    "local",
    causeId,
  );

  const bandFaces = stitchBand(ctx, removal.exposedLoops, paintedType, prefix, salt, causeId);
  return { raisedFaces: raising.length, bandFaces, skipped };
}

/**
 * One side face per rim edge, spanning from the untouched ground up to the
 * raised patch. Each reuses the rim edge itself (walked backwards, so the
 * band and the neighbour meet in opposite directions as a shared boundary
 * must) plus three edges of its own.
 */
function stitchBand(
  ctx: ToolContext,
  exposedLoops: readonly (readonly ConstructionRegionEdge[])[],
  surfaceType: string,
  prefix: string,
  salt: number,
  causeId: string,
): number {
  let built = 0;
  for (const loop of exposedLoops) {
    for (const rim of loop) {
      const lowStart = rim.startNodeId;
      const lowEnd = rim.endNodeId;
      const highStart = elevatedId(lowStart, salt);
      const highEnd = elevatedId(lowEnd, salt);

      const riseAtEnd = edgeIdFor(prefix, lowEnd, highEnd);
      const top = edgeIdFor(prefix, highEnd, highStart);
      const dropAtStart = edgeIdFor(prefix, highStart, lowStart);
      for (const [edgeId, from, to] of [
        [riseAtEnd, lowEnd, highEnd],
        [top, highEnd, highStart],
        [dropAtStart, highStart, lowStart],
      ] as const) {
        ctx.runtime.addContourEdge(
          { edgeId, startNodeId: from, endNodeId: to, geometry: { kind: "line" } },
          "local",
          causeId,
        );
      }

      // The engine already reports each rim use oriented for the stitching
      // face -- opposite the surviving neighbour -- so it is used verbatim.
      // Flipping it here would recreate the very same-direction double use
      // the orientation exists to avoid.
      const boundary: ConstructionOrientedEdgeUse[] = [
        { edgeId: rim.edgeId, reversed: rim.reversed },
        { edgeId: riseAtEnd, reversed: false },
        { edgeId: top, reversed: false },
        { edgeId: dropAtStart, reversed: false },
      ];
      ctx.runtime.addRegion(
        {
          regionId: `${prefix}:band:${lowStart}->${lowEnd}`,
          outerLoops: [boundary],
          surfaceType,
          physical: true,
        },
        "local",
        causeId,
      );
      built += 1;
    }
  }
  return built;
}
