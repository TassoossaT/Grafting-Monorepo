import type {
  ConstructionPatch,
  ConstructionEdgeId,
  ConstructionPatchEdge,
  ConstructionPatchRegion,
  ConstructionPosition,
  ConstructionRegionTopology,
  ConstructionSurfaceKey,
} from "@/ports";

import { sampleCatmullRom } from "./catmull-rom.ts";
import { type BandRibbon, offsetBands } from "./offset-bands.ts";
import { ringOf, unionBandLayer } from "./union-bands.ts";
import { buildContourPatch, type ExistingNode } from "./contour-patch.ts";

/**
 * One curve chain's spine, already resolved to an ordered list of control
 * points. Kept decoupled from `spine-graph.ts`'s own types (and from
 * `PathKind`/`pathFormationFor`) on purpose: this module only knows "a
 * curve, a band profile," never a corridor, a subtype, or a station -- the
 * same genericity the Rust primitives themselves keep.
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
  /**
   * Every chain of the touched spine cloud -- not just the one a stroke or a
   * control-node drag directly changed, but every chain the caller's own
   * connectivity walk (`changedSpineCloud` in `path-cloud-scope.ts`)
   * found reachable from it. Each is resampled fresh from its own *current*
   * control points every time this function runs; nothing here ever reads
   * a chain's own previous contour back as input, which is what keeps
   * floating-point noise from one union pass compounding into the next.
   */
  readonly editedChains: readonly SpineChainInput[];
  /**
   * Every standing region of `surfaceType` belonging to this same cloud --
   * always replaced in full. *Which* regions belong to the cloud is decided
   * once, by the caller, from the spine graph itself (exact node-id
   * membership); this function does not re-derive or filter that answer by
   * geometry -- there is no partial, "only what actually overlaps" version
   * of this list any more. A road duplicating or a face going missing was
   * always this file and the caller silently disagreeing about which faces
   * belonged together; giving the caller's answer nothing left to second-
   * guess is what closes that gap for good.
   */
  readonly standingRegions: readonly ConstructionRegionTopology[];
  /** Every node already standing on the table, for welding by position. */
  readonly existingNodes: readonly ExistingNode[];
  /** All currently live contour uses, including faces outside this local edit. */
  readonly existingEdgeUses?: ReadonlyMap<ConstructionEdgeId, readonly boolean[]>;
}

export interface PlanSpineContourResult {
  readonly patch: ConstructionPatch;
  /**
   * Every one of `input.standingRegions`, unconditionally -- their faces are
   * superseded by the freshly unioned ones in `patch.regions`, even where
   * most of their own nodes were welded back unchanged. The caller replaces
   * them in one atomic transaction with the unioned patch; a refused target
   * can never leave the standing faces deleted.
   */
  readonly consumedSurfaceKeys: readonly ConstructionSurfaceKey[];
}

/**
 * Derives the contour patch for one spine edit: Catmull-Rom sample -> banded
 * offset -> union each band layer, across every chain of the touched cloud
 * at once -> `ConstructionPatch`.
 *
 * **The whole cloud, derived fresh, every time -- never patched onto what
 * was already there.** `input.editedChains` is every chain the touched
 * cloud has; `input.standingRegions` is every face that cloud currently
 * owns. This function reads the *first* for geometry and the *second* only
 * for which surface keys to retire -- a standing region's own boundary is
 * never fed back into a union as input. A T, an X, or an L are not cases
 * this function knows about, they are whatever {@link unionBandLayer}
 * happens to produce when two chains' ribbons overlap.
 *
 * Returns `undefined` when `editedChains` is empty -- nothing changed, so
 * nothing to regenerate.
 */
export function planSpineContour(input: PlanSpineContourInput): PlanSpineContourResult | undefined {
  if (input.editedChains.length === 0) return undefined;

  const ribbons: BandRibbon[] = [];
  for (const chain of input.editedChains) {
    const polyline = sampleCatmullRom(chain.controlPoints, chain.tolerance);
    const minOffset = Math.min(...chain.bandOffsets);
    const maxOffset = Math.max(...chain.bandOffsets);
    for (const ribbon of offsetBands(polyline, [minOffset, maxOffset], chain.miterLimit)) {
      ribbons.push(ribbon);
    }
  }

  const consumed = input.standingRegions.map((topology) => topology.surfaceKey);

  // `applyPatchReplacement` removes these faces before it registers the new
  // contour. Their old uses therefore do not occupy an edge budget; only
  // faces outside this cloud must reserve a side of an edge.
  const retainedEdgeUses = new Map<ConstructionEdgeId, boolean[]>();
  for (const [edgeId, uses] of input.existingEdgeUses ?? []) retainedEdgeUses.set(edgeId, [...uses]);
  for (const topology of input.standingRegions) {
    for (const loop of [...topology.outerLoops, ...topology.holes]) {
      for (const use of loop) {
        const uses = retainedEdgeUses.get(use.edgeId);
        if (uses === undefined) continue;
        const index = uses.indexOf(use.reversed);
        if (index >= 0) uses.splice(index, 1);
        if (uses.length === 0) retainedEdgeUses.delete(use.edgeId);
      }
    }
  }

  let shapes = unionBandLayer(ribbons);
  if (shapes.length === 0 && ribbons.length > 0) {
    shapes = ribbons.map((ribbon) => [ringOf(ribbon.outer)]);
  }
  const heightSamples = ribbons.flatMap((ribbon) => ribbon.outer);
  const built = buildContourPatch(
    input.tableId,
    input.operationId,
    input.surfaceType,
    0,
    shapes,
    heightSamples,
    input.existingNodes,
    retainedEdgeUses,
  );

  return {
    patch: built.patch,
    consumedSurfaceKeys: consumed,
  };
}
