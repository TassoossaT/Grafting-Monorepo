import type { ConstructionPosition } from "@/ports";
import { bezierChains, unionBezierRibbons } from "./bezier-road-plan.ts";
import { bezierContourId, changedSpineCloud, standingRegionsForCloud } from "./path-cloud-scope.ts";
import { planSpineContour } from "./contour/index.ts";
import type { SpineRegeneration, SpineRegenerationInput } from "../structure-type.ts";
import { PATH_SURFACE_TYPE } from "./path-surface-type.ts";

/**
 * A road regenerated from its spine after an edit: every band ribbon of the
 * touched spine component, unioned in plan into the contour faces that
 * replace the standing ones. The edit itself -- what moved on the spine -- is
 * the generic spine module's; this is only what a road makes of it.
 */
export function regeneratePathSpine(input: SpineRegenerationInput): SpineRegeneration | undefined {
  const { snapshot: source, graphPatch } = input;
  const cloud = changedSpineCloud(source, graphPatch, input.topologies);
  const chains = bezierChains(cloud.snapshot, input.port, [-2, 2], 4);
  const beforeCloud = changedSpineCloud(source, { nodes: graphPatch.nodes.filter((n) => source.nodes.some((s) => s.id === n.id)), edges: [] }, input.topologies);
  const standing = standingRegionsForCloud(input.topologies, new Set([...cloud.corridorIds, ...beforeCloud.corridorIds]));
  if (chains.length === 0) return { request: { operationId: input.operationId, sourceSurfaceKeys: standing.map((s) => s.surfaceKey), patch: { nodes: [], edges: [], regions: [] }, graphPatch }, preview: new Float32Array() };
  const edgeUses = new Map<string, boolean[]>();
  for (const topology of input.topologies) for (const loop of [...topology.outerLoops, ...topology.holes]) {
    for (const e of loop) edgeUses.set(e.edgeId, [...(edgeUses.get(e.edgeId) ?? []), e.reversed]);
  }
  const weldableNodes = new Map<string, ConstructionPosition>();
  for (const topology of input.topologies.filter((t) => t.surfaceType === PATH_SURFACE_TYPE)) {
    for (const node of topology.nodes) {
      if (!weldableNodes.has(node.id)) weldableNodes.set(node.id, node.position);
    }
  }
  const existingNodes = [...weldableNodes].map(([id, position]) => ({ id, position }));
  const plan = planSpineContour({ tableId: input.tableId, operationId: bezierContourId(cloud.corridorIds, input.operationId), surfaceType: PATH_SURFACE_TYPE,
    field: input.field, union: (ribbons) => unionBezierRibbons(input.port, ribbons), editedChains: chains, standingRegions: standing, existingNodes, existingEdgeUses: edgeUses });
  if (!plan) return undefined;
  const segments = chains.flatMap((c) => c.sampledPoints!.slice(1).flatMap((p, i) => {
    const a = c.sampledPoints![i]!; return [a.x, a.y, a.z, p.x, p.y, p.z];
  }));
  const footprintOutline = chains.flatMap((c) => c.ribbons.flatMap((r) => r.outer)).map((p) => [p.x, p.z] as const);
  return { request: { operationId: input.operationId, sourceSurfaceKeys: plan.consumedSurfaceKeys, patch: plan.patch, graphPatch, footprintOutline },
    preview: Float32Array.from(segments) };
}
