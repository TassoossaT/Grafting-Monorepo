import type { ConstructionGraphSnapshot, ConstructionPosition } from "@/ports";
import { bezierChains, unionBezierRibbons } from "./bezier-road-plan.ts";
import { bezierContourId, changedSpineCloud, standingRegionsForCloud } from "./path-cloud-scope.ts";
import { planSpineContour, type SpineChainInput } from "./contour/index.ts";
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
  const footprintOutline = editedFootprint(input, cloud.snapshot, chains);
  return { request: { operationId: input.operationId, sourceSurfaceKeys: plan.consumedSurfaceKeys, patch: plan.patch, graphPatch, footprintOutline },
    preview: Float32Array.from(segments) };
}

/**
 * The ground this edit claims: the spans it actually moved, not the component.
 *
 * The contour is the whole component regenerated, but what lies underneath
 * only cares where the road now reaches *because of this edit*. Handing the
 * terrain every ribbon of the network -- worse, their rings concatenated into
 * one polygon that bridges across the ground between them -- made every drag
 * regenerate the whole corridor, and each regeneration came back finer along
 * the road than the last. Ground the road left is not this footprint's job:
 * the lattice reaction reads it from the before/after shape difference.
 */
function editedFootprint(
  input: SpineRegenerationInput,
  snapshot: ConstructionGraphSnapshot,
  chains: readonly SpineChainInput[],
): readonly (readonly [number, number])[] | undefined {
  const movedNodes = new Set(input.graphPatch.nodes.map((node) => node.id));
  const patchedEdges = new Set(input.graphPatch.edges.map((edge) => edge.edgeId));
  const touched = new Set(snapshot.edges
    .filter((edge) => patchedEdges.has(edge.edgeId) || movedNodes.has(edge.startNodeId) || movedNodes.has(edge.endNodeId))
    .map((edge) => edge.edgeId));
  const ribbons = chains.filter((chain) => touched.has(chain.chainId)).flatMap((chain) => chain.ribbons ?? []);
  if (ribbons.length === 0) return undefined;
  let union: [number, number][][][];
  try {
    union = unionBezierRibbons(input.port, ribbons);
  } catch {
    return undefined;
  }
  // One ring is what the footprint contract carries. The spans around one
  // moved node or edge are joined, so their union is one piece; should it
  // ever split, the largest piece is the one worth answering for.
  let best: [number, number][] | undefined;
  let bestArea = 0;
  for (const piece of union) {
    const ring = piece[0];
    if (ring === undefined || ring.length < 3) continue;
    let twice = 0;
    for (let index = 0; index < ring.length; index += 1) {
      const [ax, az] = ring[index]!;
      const [bx, bz] = ring[(index + 1) % ring.length]!;
      twice += ax * bz - bx * az;
    }
    if (Math.abs(twice) > bestArea) {
      bestArea = Math.abs(twice);
      best = ring;
    }
  }
  return best?.map(([x, z]) => [x, z] as const);
}
