import type { FieldPort } from "./contour/curve-projection.ts";
import { planBezierRoad, unionBezierRibbons } from "./bezier-road-plan.ts";
import { pathCorridorId } from "./path-corridor.ts";
import type { BezierPort } from "@/ports";
import type { PathBrushEffect } from "../../modes/surface-edit-contract.ts";
import type {
  ApplyPatchReplacementRequest,
  ConstructionCoveredRegion,
  ConstructionGraphSnapshot,
  ConstructionPosition,
  ConstructionRegionTopology,
} from "@/ports";

// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time. A type-only
// `@/` import is fine -- those are erased.
import { firstRefusal, resolveCoverage } from "../index.ts";
import { PATH_SURFACE_TYPE } from "./path-surface-type.ts";
import { bezierContourId, changedSpineCloud, standingRegionsForCloud } from "./path-cloud-scope.ts";
import { pathSpineDraftFor } from "./path-spine-draft.ts";
import { planSpineContour } from "./contour/index.ts";

/** The table facts supplied to the PathCloud before it plans a mutation. */
export interface PathCloudMutationInput {
  /** The curve engine every road is fitted, sampled and unioned through. */
  readonly bezier: BezierPort;
  /** The engine, which elevates every contour vertex the plan-view union hands back flat. */
  readonly field: FieldPort;
  readonly tableId: string;
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
  | { readonly kind: "ready"; readonly request: ApplyPatchReplacementRequest; readonly plannedRegionCount: number };

/**
 * Turns a draw intent into the next state of the entire touched PathCloud.
 * Junction resolution, spine splitting, face ownership and contour rebuild
 * all live here; callers merely provide snapshots and apply the result.
 *
 * This is the only path a path is ever built by: the stroke is fitted into
 * bezier spans on the shared spine (`planBezierRoad`), every span of the
 * touched spine component is sampled into its ribbon by the same curve
 * engine a sloped platform uses, and the ribbons are unioned into the
 * contour faces that replace the component's standing ones. A T, an X and
 * an L are not cases this function distinguishes -- they are whatever the
 * union produces.
 *
 * This function decides nothing about what its own footprint cuts into:
 * `sourceSurfaceKeys` names only the path faces it replaces, and
 * `footprintOutline` is what the effect commit hands to whatever the change
 * reaches.
 */
export function planPathCloudMutation(input: PathCloudMutationInput): PathCloudMutationPlan {
  const { effect, tolerance } = input;
  const stroke = effect.brushRegion.samples;
  if (stroke.length < 2) return { kind: "noop", message: "Nenhuma alteração: o traço está vazio." };
  const operationId = effect.operationId;

  const road = planBezierRoad({
    snapshot: input.graphSnapshot, topologies: input.regionTopologies, port: input.bezier, stroke,
    corridorId: pathCorridorId(operationId, effect.parameters.kind),
    offsets: effect.parameters.profile.map((p) => p.lateralOffset),
    miterLimit: effect.parameters.miterLimit, tolerance,
    snapReach: Math.max(tolerance, effect.brushShape.kind === "square" ? effect.brushShape.size / 2 : effect.brushShape.radius),
  });
  if (road.graphPatch.edges.length === 0) return { kind: "noop", message: "Nenhuma alteração: o traço não teve extensão suficiente após o encaixe." };
  const spine = pathSpineDraftFor(effect, road.controlPoints);
  if (spine === undefined) return { kind: "noop", message: "Nenhuma alteração: o traço não teve extensão suficiente." };

  const touchedCloud = changedSpineCloud(road.snapshot, road.graphPatch, input.regionTopologies);

  // The footprint this stroke alone claims -- full width, one ribbon -- is
  // what a coverage query is asked about. It is not the patch: the patch is
  // the whole component unioned, but what lies underneath only cares how far
  // this road reaches.
  const outline = (road.footprint[0]?.[0] ?? []).map(([x, z]) => [x, z] as const);
  // A stroke whose ends both snap onto existing spine geometry can collapse
  // to a degenerate footprint. Not a road either, and the session's coverage
  // query refuses a degenerate polygon outright.
  if (outline.length < 3) {
    return { kind: "noop", message: "Nenhuma alteração: o traço não teve extensão suficiente." };
  }

  const refusal = firstRefusal(resolveCoverage(PATH_SURFACE_TYPE, input.coverageFor(outline), effect.parameters.kind));
  if (refusal !== undefined) {
    return { kind: "refused", reason: refusal };
  }

  const topologies = input.regionTopologies;
  const standingRegions = standingRegionsForCloud(topologies, touchedCloud.corridorIds);
  const existingEdgeUses = new Map<string, boolean[]>();
  for (const topology of topologies) {
    for (const loop of [...topology.outerLoops, ...topology.holes]) {
      for (const use of loop) existingEdgeUses.set(use.edgeId, [...(existingEdgeUses.get(use.edgeId) ?? []), use.reversed]);
    }
  }

  // **What the contour may weld back onto:** the path faces already standing.
  // A regeneration re-derives the same boundary from the same curves, so
  // almost every vertex lands back where it already was, and welding lets
  // those keep the node ids they already had -- a network of three hundred
  // streets is not re-issued in full because one of them was extended.
  // Scoped to paths so a road vertex can never adopt a terrain node that
  // happens to sit under it; the two types meet through the effect commit,
  // not by sharing an id.
  const weldableNodes = new Map<string, ConstructionPosition>();
  for (const topology of topologies.filter((t) => t.surfaceType === PATH_SURFACE_TYPE)) {
    for (const node of topology.nodes) {
      if (!weldableNodes.has(node.id)) weldableNodes.set(node.id, node.position);
    }
  }
  const existingNodes = [...weldableNodes].map(([id, position]) => ({ id, position }));

  const planned = planSpineContour({
    field: input.field,
    union: (ribbons) => unionBezierRibbons(input.bezier, ribbons),
    tableId: input.tableId,
    operationId: bezierContourId(touchedCloud.corridorIds, operationId),
    surfaceType: PATH_SURFACE_TYPE,
    // The changed component is read from the prospective spine graph, not
    // inferred from its old contour faces. A continuation therefore
    // regenerates one continuous road; a branch regenerates its whole
    // junction component.
    editedChains: road.chains,
    standingRegions,
    existingNodes,
    existingEdgeUses,
  });
  if (planned === undefined) return { kind: "noop", message: "Nenhuma alteração: a nuvem não produziu contorno." };
  return {
    kind: "ready",
    request: {
      operationId,
      sourceSurfaceKeys: planned.consumedSurfaceKeys,
      patch: planned.patch,
      graphPatch: road.graphPatch,
      footprintOutline: outline,
    },
    plannedRegionCount: planned.patch.regions.length,
  };
}
