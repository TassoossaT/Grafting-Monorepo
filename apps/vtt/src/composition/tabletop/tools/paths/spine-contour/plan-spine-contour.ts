import type { ConstructionPatch, ConstructionPatchEdge, ConstructionPatchRegion, ConstructionPosition } from "@/ports";

import { sampleCatmullRom } from "./catmull-rom.ts";
import { type BandRibbon, offsetBands } from "./offset-bands.ts";
import { unionBandLayer } from "./union-bands.ts";
import { boundsIntersectRegion, dirtyRegionAround } from "./dirty-region.ts";
import { buildContourPatch, type ExistingNode } from "./contour-patch.ts";

/**
 * One curve chain's spine, already resolved to an ordered list of control
 * points -- what `chainsOf`'s `SpineChain.nodes` becomes once a caller reads
 * off their positions. Kept decoupled from `spine-graph.ts`'s own types (and
 * from `PathKind`/`pathFormationFor`) on purpose: this module only knows
 * "a curve, a band profile, a reach," never a corridor, a subtype, or a
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
  /** Every chain the cloud has, so a neighbour within reach is never missed. */
  readonly chains: readonly SpineChainInput[];
  /** Which of `chains` just changed -- what the dirty region grows from. */
  readonly changedChainIds: readonly string[];
  /** Every node already standing on the table, for welding by position. */
  readonly existingNodes: readonly ExistingNode[];
}

export interface PlanSpineContourResult {
  readonly patch: ConstructionPatch;
  /** Chains actually inside the dirty region and reprocessed -- everything else was left alone. */
  readonly touchedChainIds: readonly string[];
}

function halfReachOf(chain: SpineChainInput): number {
  return chain.bandOffsets.reduce((widest, offset) => Math.max(widest, Math.abs(offset)), 0);
}

/**
 * Derives the contour patch for one spine edit: dirty region -> Catmull-Rom
 * sample -> banded offset -> union per band layer -> `ConstructionPatch`.
 *
 * **The dirty region, not the whole cloud.** `changedChainIds` says what
 * moved; every other chain is included in the search only to be *ruled out*
 * by `boundsIntersectRegion` -- its own geometry, and every node id in it,
 * never changes if it falls outside the grown box. This is what replaces
 * the old station-sweep engine's per-topology mouth/wedge/mitre machinery:
 * a T, an X, or an L are not cases this function knows about, they are
 * whatever `unionBandLayer` happens to produce when two touched chains'
 * ribbons overlap.
 *
 * Returns `undefined` when none of `changedChainIds` names a chain actually
 * present in `chains` -- nothing to regenerate.
 */
export function planSpineContour(input: PlanSpineContourInput): PlanSpineContourResult | undefined {
  const changed = input.chains.filter((chain) => input.changedChainIds.includes(chain.chainId));
  if (changed.length === 0) return undefined;

  const reach = input.chains.reduce((widest, chain) => Math.max(widest, halfReachOf(chain)), 0);
  const changedPoints = changed.flatMap((chain) => chain.controlPoints);
  const region = dirtyRegionAround(changedPoints, reach);
  if (region === undefined) return undefined;

  const touched = input.chains.filter((chain) => boundsIntersectRegion(chain.controlPoints, region));

  const ribbonsByBand = new Map<number, BandRibbon[]>();
  for (const chain of touched) {
    const polyline = sampleCatmullRom(chain.controlPoints, chain.tolerance);
    for (const ribbon of offsetBands(polyline, chain.bandOffsets, chain.miterLimit)) {
      const list = ribbonsByBand.get(ribbon.bandIndex) ?? [];
      list.push(ribbon);
      ribbonsByBand.set(ribbon.bandIndex, list);
    }
  }

  const nodes = new Map<string, ConstructionPosition>();
  const edges = new Map<string, ConstructionPatchEdge>();
  const regions: ConstructionPatchRegion[] = [];
  for (const [bandIndex, ribbons] of ribbonsByBand) {
    const shapes = unionBandLayer(ribbons);
    const heightSamples = ribbons.flatMap((ribbon) => ribbon.outer);
    const built = buildContourPatch(
      input.tableId,
      input.operationId,
      input.surfaceType,
      bandIndex,
      shapes,
      heightSamples,
      input.existingNodes,
    );
    for (const node of built.patch.nodes) nodes.set(node.id, node.position);
    for (const edge of built.patch.edges) edges.set(edge.edgeId, edge);
    regions.push(...built.patch.regions);
  }

  return {
    patch: { nodes: [...nodes].map(([id, position]) => ({ id, position })), edges: [...edges.values()], regions },
    touchedChainIds: touched.map((chain) => chain.chainId),
  };
}
