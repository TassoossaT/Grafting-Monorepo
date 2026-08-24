import type {
  ConstructionPatch,
  ConstructionPatchEdge,
  ConstructionPatchRegion,
  ConstructionPosition,
  ConstructionRegionTopology,
  ConstructionSurfaceKey,
} from "@/ports";

import { sampleCatmullRom } from "./catmull-rom.ts";
import { type BandRibbon, offsetBands } from "./offset-bands.ts";
import { unionBandLayer } from "./union-bands.ts";
import { boundsIntersectRegion, dirtyRegionAround } from "./dirty-region.ts";
import { buildContourPatch, type ExistingNode } from "./contour-patch.ts";

/**
 * One curve chain's spine, already resolved to an ordered list of control
 * points. Kept decoupled from `spine-graph.ts`'s own types (and from
 * `PathKind`/`pathFormationFor`) on purpose: this module only knows "a
 * curve, a band profile, a reach," never a corridor, a subtype, or a
 * station -- the same genericity the Rust primitives themselves keep.
 */
export interface SpineChainInput {
  readonly chainId: string;
  readonly controlPoints: readonly ConstructionPosition[];
  /** Lateral offsets defining the bands, e.g. `[-2.1, 0, 2.1]` for contour/spine/contour. */
  readonly bandOffsets: readonly number[];
  readonly miterLimit: number;
  /** Curve flattening tolerance, world units (XZ). */
  readonly tolerance: number;
}

export interface PlanSpineContourInput {
  readonly tableId: string;
  /** Scopes every node/region id this call mints -- one edit, one operation. */
  readonly operationId: string;
  readonly surfaceType: string;
  /** The chain(s) a stroke or a control-node drag just changed. */
  readonly editedChains: readonly SpineChainInput[];
  /**
   * Every region of `surfaceType` already standing on the table -- read
   * live, not reconstructed from a persisted spine graph. A standing
   * region's own bandIndex is read back from its own `regionId` (this
   * engine's own naming, `<op>:band-<n>:<shape>`); anything not shaped that
   * way was not built by this engine and is left alone.
   */
  readonly standingRegions: readonly ConstructionRegionTopology[];
  /** Every node already standing on the table, for welding by position. */
  readonly existingNodes: readonly ExistingNode[];
}

export interface PlanSpineContourResult {
  readonly patch: ConstructionPatch;
  /**
   * Standing regions this patch replaces -- their faces are superseded by
   * the freshly unioned ones in `patch.regions`, even where most of their
   * own nodes were welded back unchanged. The caller deletes these before
   * adding the patch, the same two-step "flank comes out, wedges go in"
   * shape `commitPathContour` already used for a mouth, just driven by a
   * union instead of a hand-built wedge.
   */
  readonly consumedSurfaceKeys: readonly ConstructionSurfaceKey[];
}

const BAND_INDEX_PATTERN = /:band-(\d+):/;

/** The band index encoded in one of this engine's own region ids, or `undefined` for a region it did not build. */
function bandIndexOfRegionId(regionId: string): number | undefined {
  const match = BAND_INDEX_PATTERN.exec(regionId);
  if (match === null) return undefined;
  const index = Number(match[1]);
  return Number.isNaN(index) ? undefined : index;
}

/** A standing region's own outer ring, as world positions in boundary order. */
function ringOfTopology(topology: ConstructionRegionTopology): readonly ConstructionPosition[] {
  const [outer] = topology.outerLoops;
  if (outer === undefined) return [];
  const positionById = new Map(topology.nodes.map((node) => [node.id, node.position]));
  return outer.map((use) => positionById.get(use.startNodeId)).filter((position): position is ConstructionPosition => position !== undefined);
}

function halfReachOf(chain: SpineChainInput): number {
  return chain.bandOffsets.reduce((widest, offset) => Math.max(widest, Math.abs(offset)), 0);
}

/**
 * Derives the contour patch for one spine edit: dirty region -> Catmull-Rom
 * sample -> banded offset -> union each band layer (the edited chains' own
 * fresh ribbons, plus whatever standing band already sits inside the dirty
 * region) -> `ConstructionPatch`.
 *
 * **The dirty region, not the whole cloud.** `editedChains` says what
 * changed; every standing region is included in the search only to be
 * *ruled out* by {@link boundsIntersectRegion} -- a region whose own
 * footprint never enters the grown box is not in `consumedSurfaceKeys` and
 * is left exactly as it stands, same node ids, same face. This is what
 * replaces the old station-sweep engine's per-topology mouth/wedge/mitre
 * machinery: a T, an X, or an L are not cases this function knows about,
 * they are whatever {@link unionBandLayer} happens to produce when an
 * edited chain's ribbon and a standing region's own ring overlap.
 *
 * **Welding, not reconstruction, is what keeps a standing chain's own
 * width right.** This function never needs to know what profile produced a
 * standing region -- it reads that region's *current* boundary positions
 * straight off the live table and feeds them into the same union a fresh
 * ribbon goes through. A stretch of standing road nowhere near the edit
 * unions with nothing, and every one of its vertices welds straight back
 * onto itself by position, so it survives the round trip with the exact
 * ids it already had.
 *
 * Returns `undefined` when `editedChains` is empty -- nothing changed, so
 * nothing to regenerate.
 */
export function planSpineContour(input: PlanSpineContourInput): PlanSpineContourResult | undefined {
  if (input.editedChains.length === 0) return undefined;

  const reach = input.editedChains.reduce((widest, chain) => Math.max(widest, halfReachOf(chain)), 0);
  const changedPoints = input.editedChains.flatMap((chain) => chain.controlPoints);
  const region = dirtyRegionAround(changedPoints, reach);
  if (region === undefined) return undefined;

  const ribbonsByBand = new Map<number, BandRibbon[]>();
  for (const chain of input.editedChains) {
    const polyline = sampleCatmullRom(chain.controlPoints, chain.tolerance);
    for (const ribbon of offsetBands(polyline, chain.bandOffsets, chain.miterLimit)) {
      const list = ribbonsByBand.get(ribbon.bandIndex) ?? [];
      list.push(ribbon);
      ribbonsByBand.set(ribbon.bandIndex, list);
    }
  }

  const consumed: ConstructionSurfaceKey[] = [];
  for (const topology of input.standingRegions) {
    const regionId = topology.surfaceKey[topology.surfaceKey.length - 1] ?? "";
    const bandIndex = bandIndexOfRegionId(regionId);
    if (bandIndex === undefined) continue;
    const outer = ringOfTopology(topology);
    if (!boundsIntersectRegion(outer, region)) continue;
    const list = ribbonsByBand.get(bandIndex) ?? [];
    list.push({ bandIndex, outer });
    ribbonsByBand.set(bandIndex, list);
    consumed.push(topology.surfaceKey);
  }

  const nodes = new Map<string, ConstructionPosition>();
  const edges = new Map<string, ConstructionPatchEdge>();
  const regions: ConstructionPatchRegion[] = [];
  // Nodes fresh out of one band's own patch are candidates the *next* band
  // must be able to weld onto too -- offset 0 is exactly the same position
  // whichever band computed it, and without this the seam between two
  // adjacent bands would mint two different ids for one shared point.
  let liveNodes: readonly ExistingNode[] = input.existingNodes;
  for (const [bandIndex, ribbons] of [...ribbonsByBand].sort(([left], [right]) => left - right)) {
    const shapes = unionBandLayer(ribbons);
    const heightSamples = ribbons.flatMap((ribbon) => ribbon.outer);
    const built = buildContourPatch(input.tableId, input.operationId, input.surfaceType, bandIndex, shapes, heightSamples, liveNodes);
    for (const node of built.patch.nodes) nodes.set(node.id, node.position);
    for (const edge of built.patch.edges) edges.set(edge.edgeId, edge);
    regions.push(...built.patch.regions);
    liveNodes = [...liveNodes, ...built.patch.nodes];
  }

  return {
    patch: { nodes: [...nodes].map(([id, position]) => ({ id, position })), edges: [...edges.values()], regions },
    consumedSurfaceKeys: consumed,
  };
}
