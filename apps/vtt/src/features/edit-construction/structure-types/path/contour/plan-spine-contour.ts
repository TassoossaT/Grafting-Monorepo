import type {
  ConstructionPatch,
  ConstructionEdgeId,
  ConstructionPatchEdge,
  ConstructionPatchRegion,
  ConstructionPosition,
  ConstructionRegionTopology,
  ConstructionSurfaceKey,
} from "@/ports";

import type { ReferenceCurve } from "./curve-projection.ts";
import { buildContourPatch, type ExistingNode } from "./contour-patch.ts";
import type { FieldPort } from "./curve-projection.ts";

/** One swept ribbon: a closed ring, its first side forward and its other side back. */
export interface BandRibbon {
  readonly bandIndex: number;
  readonly outer: readonly ConstructionPosition[];
}

/**
 * One curve chain, already swept by the spine's ribbon generator. Kept
 * decoupled from `spine-graph.ts`'s own types (and from
 * `PathKind`/`pathFormationFor`) on purpose: this module only knows "a
 * sampled curve and its ribbons," never a corridor, a subtype, or a station.
 */
export interface SpineChainInput {
  readonly chainId: string;
  /** The curve as the engine sampled it -- the height authority for the contour. */
  readonly sampledPoints: readonly ConstructionPosition[];
  /** The chain's own ribbon, plus any junction ribbon joining it to a neighbour. */
  readonly ribbons: readonly BandRibbon[];
  readonly controlPoints: readonly ConstructionPosition[];
  readonly bandOffsets: readonly number[];
  readonly miterLimit: number;
  readonly tolerance: number;
}

export interface PlanSpineContourInput {
  /** The engine, which elevates every vertex the plan-view union hands back flat. */
  readonly field: FieldPort;
  /** The plan-view union of the ribbons, through the curve engine. */
  readonly union: (ribbons: readonly BandRibbon[]) => [number, number][][][];
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
 * Derives the contour patch for one spine edit: every chain's ribbons,
 * across the whole touched cloud at once, unioned in plan -> `ConstructionPatch`.
 *
 * **The whole cloud, derived fresh, every time -- never patched onto what
 * was already there.** `input.editedChains` is every chain the touched
 * cloud has; `input.standingRegions` is every face that cloud currently
 * owns. This function reads the *first* for geometry and the *second* only
 * for which surface keys to retire -- a standing region's own boundary is
 * never fed back into a union as input. A T, an X, or an L are not cases
 * this function knows about, they are whatever the union happens to produce
 * when two chains' ribbons overlap.
 *
 * Returns `undefined` when `editedChains` is empty -- nothing changed, so
 * nothing to regenerate.
 */
export function planSpineContour(input: PlanSpineContourInput): PlanSpineContourResult | undefined {
  if (input.editedChains.length === 0) return undefined;

  const ribbons: BandRibbon[] = [];
  // The curves themselves, kept rather than discarded once their ribbons are
  // offset: they are the height authority for every vertex the union is
  // about to mint, and the same curves the engine reads back out of the
  const referenceCurves: ReferenceCurve[] = [];
  for (const chain of input.editedChains) {
    if (chain.sampledPoints.length >= 2) referenceCurves.push({ points: chain.sampledPoints });
    ribbons.push(...chain.ribbons);
  }

  const shapes = input.union(ribbons);
  if (shapes.length === 0 && ribbons.length > 0) throw Error("O contorno da curva é degenerado; ajuste a forma ou a largura.");
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

  const heightSamples = ribbons.flatMap((ribbon) => ribbon.outer);
  const built = buildContourPatch(
    input.field,
    input.tableId,
    input.operationId,
    input.surfaceType,
    0,
    shapes,
    heightSamples,
    referenceCurves,
    input.existingNodes,
    retainedEdgeUses,
  );

  return {
    patch: built.patch,
    consumedSurfaceKeys: consumed,
  };
}
