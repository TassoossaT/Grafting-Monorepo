import type { PathBrushEffect } from "../../modes/surface-edit-contract.ts";
import type {
  ApplyPatchReplacementRequest,
  ConstructionCoveredRegion,
  ConstructionGraphSnapshot,
  ConstructionRegionTopology,
} from "@/ports";

// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time. A type-only
// `@/` import is fine -- those are erased.
import {
  firstRefusal,
  resolveCoverage,
  resolveCutRepair,
  type CutFallout,
} from "../index.ts";
import { graphPatchForSpine } from "./spine-graph/index.ts";
import { changedSpineCloud, standingRegionsForCloud } from "./path-cloud-scope.ts";
import { pathRidesTerrain } from "./path-recipe.ts";
import { referenceLineFrom } from "./path-reference-line.ts";
import { pathSpineDraftFor } from "./path-spine-draft.ts";

import { fitPath } from "../../topology/index.ts";
import {
  offsetBands,
  planSpineContour,
  sampleCatmullRom,
  unionBandLayer,
  type SpineChainInput,
} from "./contour/index.ts";

/**
 * How finely the committed curve follows the true Catmull-Rom shape, in
 * world units (XZ). The spine's own control points stay few -- `groundTrack`
 * keeps one per real corner, never one per flattening step -- and this is
 * what turns that handful of points into a smooth curve for the contour
 * union and the footprint/coverage outline, the same Catmull-Rom-through-
 * few-anchors model this whole spine is styled on (no attempt to prove any
 * one span is a literal circle; a smooth spline through the right corners
 * already looks right).
 */
const CURVE_FLATTENING_TOLERANCE = 0.05;

/** The table facts supplied to the PathCloud before it plans a mutation. */
export interface PathCloudMutationInput {
  readonly tableId: string;
  readonly snapToGrid: boolean;
  readonly graphSnapshot: ConstructionGraphSnapshot;
  readonly regionTopologies: readonly ConstructionRegionTopology[];
  readonly coverageFor: (outline: readonly (readonly [number, number])[]) => readonly ConstructionCoveredRegion[];
  readonly effect: PathBrushEffect;
  readonly tolerance: number;
}

/** The PathCloud's decision; the runtime only executes the ready request. */
export type PathCloudMutationPlan =
  | { readonly kind: "noop"; readonly message: string }
  | { readonly kind: "refused"; readonly reason: string }
  | {
      readonly kind: "ready";
      readonly request: ApplyPatchReplacementRequest;
      readonly plannedRegionCount: number;
      /**
       * `undefined` when this stroke consumed nothing. This module only
       * reports what it did -- which regions, of which type, it consumed --
       * and has no idea what a caller does with that beyond here; whichever
       * covered type actually repairs itself owns that logic entirely on
       * its own side. See `CutFallout`.
       */
      readonly cutFallout: CutFallout | undefined;
    };

/**
 * Every terrain-like face this footprint covers whole and is allowed to
 * consume -- the creation-side half of `CUT`, resolved generically through
 * `resolveCutRepair` rather than by naming terrain here.
 *
 * `CUT`'s meaning is universal -- consume what is covered -- but only a face
 * the covered type can actually survive losing gets consumed. A face the
 * footprint merely clips is left standing regardless (the same "whole faces
 * only" fidelity `terrain-restack.ts` already accepts), and a covered type
 * that answers `resolveCutRepair` with `"unsupported"` is left standing too:
 * deleting it with no way to repair the leftover would trade a visible
 * overlap for an unrepairable hole, which is worse.
 */
function cutRegionsFor(resolved: ReturnType<typeof resolveCoverage>) {
  const consumed = resolved
    .filter((entry) => entry.interaction.kind === "cut" && entry.covered.coverage === "centroid")
    .filter((entry) => resolveCutRepair(entry.covered.surfaceType).kind === "regenerate")
    .map((entry) => entry.covered);
  return {
    surfaceKeys: consumed.map((covered) => covered.surfaceKey),
    nodeScope: [...new Set(consumed.flatMap((covered) => covered.nodeIds))],
  };
}

/**
 * Turns a draw intent into the next state of the entire touched PathCloud.
 * Junction resolution, spine splitting, face ownership and contour rebuild
 * all live here; callers merely provide snapshots and apply the result.
 *
 * This is the only path a path is ever built by. A free stroke, and any
 * straight drag or preset that comes later, differ in nothing but the
 * reference line they hand over: they all resolve to the same spine, go
 * through the same whole-cloud contour engine, and declare the same faces.
 *
 * **What changed from the station-sweep engine this replaces.** There is no
 * mouth, no wedge, no mitre, no crossing-preparation sweep here any more. A
 * T, an X, and an L are not cases this function distinguishes -- they are
 * whatever `planSpineContour`'s per-band union happens to produce once this
 * stroke's own ribbons are unioned against an explicitly selected standing
 * continuation. `pathCorridorId`/`pathFormationFor` still decide the
 * subtype's profile; everything past that is derived, not hand-closed.
 *
 * **What this stage deliberately did not carry over**, flagged rather than
 * silently dropped:
 * - Dragging an already-committed road's own nodes still resolves roles
 *   through `station-node-id.ts`'s address scheme (`path-structure.ts`),
 *   which a contour node minted by this engine does not carry. A newly
 *   drawn road commits correctly; editing it interactively afterwards is a
 *   follow-up, not something this function attempts.
 * - A terrain face the footprint only clips (`coverage: "overlap"`) is left
 *   standing rather than cut to the road's exact contour -- the old engine's
 *   partial-overlap precision (`applyRegionOverlay`'s overlap-planning) is
 *   not reproduced here. Only a face the footprint covers whole
 *   (`coverage: "centroid"`) is consumed, the same fidelity trade-off
 *   `terrain-restack.ts` already accepts for raising (see `cutRegionsFor`
 *   above). The `cutFallout` this returns reports what happened; closing
 *   that seam is entirely the covered type's own business, done in its own
 *   module (terrain's is `terrain-cut-repair.ts`), never this one's.
 * - `graphPatchForSpine`'s own welding and crossing checks read a real arc
 *   span by its chord (`spine.controlPoints` no longer carries intermediate
 *   samples along one -- see `groundTrack`), the same way every other span
 *   here always has. A gentle curve's chord and its true arc barely differ;
 *   a very tight, wide-swinging one could weld or cross slightly off from
 *   where the curve itself actually runs. Not a case this stage resolves,
 *   only one it accepts in exchange for never chopping a real arc into
 *   graph nodes it does not need.
 */
export function planPathCloudMutation(input: PathCloudMutationInput): PathCloudMutationPlan {
  const { effect, tolerance } = input;
  const stroke = effect.brushRegion.samples;
  if (stroke.length === 0) return { kind: "noop", message: "Nenhuma alteração: o traço está vazio." };
  const operationId = effect.operationId;

  const fitted = fitPath(stroke, tolerance, { arcs: !input.snapToGrid });
  const swept = fitted.length === 0 ? { line: stroke } : referenceLineFrom(fitted, stroke, pathRidesTerrain(effect.parameters.kind));
  const spine = pathSpineDraftFor(effect, swept.line);
  if (spine === undefined) return { kind: "noop", message: "Nenhuma alteração: o traço não teve extensão suficiente." };

  const parameters = effect.parameters;
    // The full painted brush area is the local repair window. A hit only
    // helps identify the neighbourhood; snapping is a geometric decision
    // made against the PathCloud's spine, never an endpoint permission.
    const correctionReach = effect.brushShape.kind === "square" ? effect.brushShape.size / 2 : effect.brushShape.radius;
    const materialized = graphPatchForSpine(input.graphSnapshot, spine, Math.max(correctionReach, tolerance, 1e-4));
    const correctedSpine = { ...spine, controlPoints: materialized.controlPoints };

    const chain: SpineChainInput = {
      chainId: correctedSpine.corridorId,
      controlPoints: correctedSpine.controlPoints,
      bandOffsets: correctedSpine.bandOffsets,
      miterLimit: correctedSpine.miterLimit,
      tolerance: CURVE_FLATTENING_TOLERANCE,
    };
    const graphPatch = materialized.graphPatch;
    const touchedCloud = changedSpineCloud(input.graphSnapshot, graphPatch);
    const regeneratedChains = touchedCloud.chains
      .filter((controlPoints) => controlPoints.length >= 2)
      .map((controlPoints, index): SpineChainInput => ({
        ...chain,
        chainId: `${correctedSpine.corridorId}:component-${index}`,
        controlPoints,
      }));

    // The footprint this stroke alone claims -- full width, one ribbon, no
    // band separation -- is what a terrain coverage query is asked about.
    // It is not the patch: the patch is banded and unioned band by band
    // against whatever standing road it meets, but a query about what lies
    // underneath only cares how far the road reaches in total.
    const flatPolyline = sampleCatmullRom(correctedSpine.controlPoints, CURVE_FLATTENING_TOLERANCE);
    const flatLength = flatPolyline.slice(0, -1).reduce((sum, p, i) => sum + Math.hypot(p.x - flatPolyline[i + 1]!.x, p.z - flatPolyline[i + 1]!.z), 0);
    if (flatLength < 1e-4) {
      return { kind: "noop", message: "Nenhuma alteração: o traço não teve extensão suficiente." };
    }
    const outerOffset = correctedSpine.bandOffsets[0]!;
    const innerOffset = correctedSpine.bandOffsets[correctedSpine.bandOffsets.length - 1]!;
    const footprintShapes = unionBandLayer(offsetBands(flatPolyline, [outerOffset, innerOffset], correctedSpine.miterLimit));
    const outline = (footprintShapes[0]?.[0] ?? []).map(([x, z]) => [x, z] as const);
    // A stroke that survived the earlier tap check can still collapse to a
    // degenerate footprint once its own ends snap onto existing spine
    // geometry -- both landing on the same node in a dense junction, say.
    // Not a road either, for the same reason a tap is not one; bailing out
    // here rather than handing an empty/degenerate polygon to the session's
    // own coverage query, which refuses one outright.
    if (outline.length < 3) {
      return { kind: "noop", message: "Nenhuma alteração: o traço não teve extensão suficiente." };
    }

    const resolved = resolveCoverage(
      "path",
      input.coverageFor(outline),
      parameters.kind,
    );
    const refusal = firstRefusal(resolved);
    if (refusal !== undefined) {
      return { kind: "refused", reason: refusal };
    }
    const cutRegions = cutRegionsFor(resolved);

    const topologies = input.regionTopologies;
    const standingRegions = standingRegionsForCloud(topologies, touchedCloud.positions, touchedCloud.corridorIds);
    const existingEdgeUses = new Map<string, boolean[]>();
    for (const topology of topologies) {
      for (const loop of [...topology.outerLoops, ...topology.holes]) {
        for (const use of loop) existingEdgeUses.set(use.edgeId, [...(existingEdgeUses.get(use.edgeId) ?? []), use.reversed]);
      }
    }

    const planned = planSpineContour({
        tableId: input.tableId,
        operationId,
        surfaceType: "path",
        // The changed component is read from the prospective spine graph,
        // not inferred from its old contour faces. A continuation therefore
        // regenerates one continuous road; a branch regenerates its whole
        // junction component.
        editedChains: regeneratedChains.length === 0 ? [chain] : regeneratedChains,
        standingRegions,
        existingNodes: [],
        existingEdgeUses,
      });
    if (planned === undefined) return { kind: "noop", message: "Nenhuma alteração: a nuvem não produziu contorno." };
    return {
      kind: "ready",
      request: {
        operationId,
        sourceSurfaceKeys: [...planned.consumedSurfaceKeys, ...cutRegions.surfaceKeys],
        patch: planned.patch,
        graphPatch,
      },
      plannedRegionCount: planned.patch.regions.length,
      cutFallout: cutRegions.surfaceKeys.length === 0 ? undefined : { outline, nodeScope: cutRegions.nodeScope },
    };
}
