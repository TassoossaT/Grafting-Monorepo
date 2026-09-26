import type { ApplyPatchReplacementRequest, ConstructionEdgeSnapshot, ConstructionGraphPatch, ConstructionGraphSnapshot, ConstructionRegionTopology, CurvePoint } from "@/ports";

import { isSpineEdge, prospectiveGraph, spineComponent } from "../spine/index.ts";
import { hasTrait, type SpineGeneration, type SpineRegeneration, type SpineRegenerationInput } from "../structure-types/index.ts";
import { floorLandingNear, floorsWeldedBy, floorsWithout, reweldFloors, sharedEdgeIds, type FloorLanding } from "../topology/floor-weld.ts";

/**
 * A spine's free ends connecting to floors, for any owner that declares
 * where an end's cross-section is (`SpineGeneration.endRung`): an end an
 * edit moves comes off the floor it was welded into, and lands on the floor
 * edge it is moved onto -- placed on that edge at the floor's height, its
 * span leaving square to the edge, off the floor -- and is welded there.
 * Every spine edit goes through {@link regenerateWithEndWelds}, so a drag, a
 * panel change and a whole-structure handle all connect the same way.
 */

const floorsOf = (topologies: readonly ConstructionRegionTopology[]) => topologies.filter((topology) => hasTrait(topology.surfaceType, "floor"));
const moved = (a: { readonly x: number; readonly y: number; readonly z: number }, b: { readonly x: number; readonly y: number; readonly z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > 1e-6;

/** The free ends -- control nodes on exactly one span -- of the spine a patch touches, as it would stand. */
export function spineChainEnds(graph: ConstructionGraphSnapshot, seeds: Iterable<string>): readonly string[] {
  const degree = new Map<string, number>();
  for (const span of spineComponent(graph, seeds).edges.filter(isSpineEdge)) {
    for (const id of [span.startNodeId, span.endNodeId]) degree.set(id, (degree.get(id) ?? 0) + 1);
  }
  return [...degree].filter(([, count]) => count === 1).map(([id]) => id);
}

/** `handle` turned to leave along `out` in plan, keeping its plan length and its climb. */
function leaving(handle: CurvePoint, out: FloorLanding["out"]): CurvePoint {
  const reach = Math.hypot(handle[0], handle[2]) || 1;
  return [out.x * reach, handle[1], out.z * reach];
}

/** The ends `graphPatch` moves, and where each now lands, with the patch placing them there. */
function landEnds(snapshot: ConstructionGraphSnapshot, graphPatch: ConstructionGraphPatch, generation: SpineGeneration, topologies: readonly ConstructionRegionTopology[]) {
  const endRung = generation.endRung!;
  const drafted = prospectiveGraph(snapshot, graphPatch);
  const seeds = [...graphPatch.nodes.map((node) => node.id), ...graphPatch.edges.flatMap((edge) => [edge.startNodeId, edge.endNodeId])];
  const ends = spineChainEnds(drafted, seeds);
  const before = new Map(snapshot.nodes.map((node) => [node.id, node.position]));
  const after = new Map(drafted.nodes.map((node) => [node.id, node.position]));
  const shifted = ends.filter((id) => !before.has(id) || moved(before.get(id)!, after.get(id)!));
  if (shifted.length === 0) return { graphPatch, shifted, landed: new Map<string, FloorLanding>() };
  const floors = floorsOf(topologies);
  const shared = sharedEdgeIds(topologies);
  const released = floorsWithout(floors, shifted.map((id) => endRung(id).edgeId), shared);
  // An end never lands on the floor the chain's other end is welded into.
  const heldBy = new Set(ends.filter((id) => !shifted.includes(id)).flatMap((id) => floorsWeldedBy(floors, endRung(id).edgeId)).map((floor) => floor.surfaceKey.join("\u0000")));
  const landed = new Map<string, FloorLanding>();
  const nodes = new Map(graphPatch.nodes.map((node) => [node.id, node]));
  const edges = new Map(graphPatch.edges.map((edge) => [edge.edgeId, edge]));
  for (const id of shifted) {
    const landing = floorLandingNear(released.filter((floor) => !heldBy.has(floor.surfaceKey.join("\u0000"))), after.get(id)!);
    if (!landing) continue;
    landed.set(id, landing);
    heldBy.add(landing.topology.surfaceKey.join("\u0000"));
    nodes.set(id, { id, position: landing.point });
    const span: ConstructionEdgeSnapshot | undefined = edges.get(drafted.edges.find((edge) => isSpineEdge(edge) && (edge.startNodeId === id || edge.endNodeId === id))?.edgeId ?? "")
      ?? drafted.edges.find((edge) => isSpineEdge(edge) && (edge.startNodeId === id || edge.endNodeId === id));
    if (!span?.curve) continue;
    const side = span.startNodeId === id ? "start" : "end";
    // A span pinned straight or circular cannot also leave square: it is freed to curve.
    const { geometry: _pinned, ...curve } = span.curve;
    edges.set(span.edgeId, { ...span, curve: { ...curve, [side]: leaving(span.curve[side], landing.out), mode: "aligned" } });
  }
  return { graphPatch: { ...graphPatch, nodes: [...nodes.values()], edges: [...edges.values()] }, shifted, landed };
}

/** `graphPatch` with every moved free end placed on the floor edge it lands on -- what a preview draws. */
export function spineEndsLanded(snapshot: ConstructionGraphSnapshot, graphPatch: ConstructionGraphPatch, generation: SpineGeneration, topologies: readonly ConstructionRegionTopology[]): ConstructionGraphPatch {
  return generation.endRung ? landEnds(snapshot, graphPatch, generation, topologies).graphPatch : graphPatch;
}

/**
 * `generation`'s regeneration of `input`, with the spine's moved free ends
 * coming off their floors and welding into the floors they land on -- one
 * replacement. An owner that declares no `endRung` regenerates unchanged.
 */
export function regenerateWithEndWelds(generation: SpineGeneration, input: SpineRegenerationInput): SpineRegeneration | undefined {
  if (!generation.endRung) return generation.regenerate(input);
  const endRung = generation.endRung;
  const { graphPatch, shifted, landed } = landEnds(input.snapshot, input.graphPatch, generation, input.topologies);
  const regenerated = generation.regenerate({ ...input, graphPatch });
  if (!regenerated || shifted.length === 0) return regenerated;
  const { request } = regenerated;
  const positions = new Map(request.patch.nodes.map((node) => [node.id, node.position]));
  const welds = reweldFloors(floorsOf(input.topologies), {
    detach: shifted.map((id) => endRung(id).edgeId),
    attach: [...landed].map(([id, landing]) => ({ rung: endRung(id), floor: landing.topology.surfaceKey })),
  }, positions, input.operationId, sharedEdgeIds(input.topologies));
  if (welds.sourceSurfaceKeys.length === 0) return regenerated;
  const rewelded: ApplyPatchReplacementRequest = {
    ...request,
    sourceSurfaceKeys: [...request.sourceSurfaceKeys, ...welds.sourceSurfaceKeys],
    patch: {
      nodes: [...request.patch.nodes, ...welds.nodes],
      edges: [...request.patch.edges, ...welds.edges],
      regions: [...request.patch.regions, ...welds.regions],
    },
  };
  return { ...regenerated, request: rewelded };
}

/** Takes the free end `controlNodeId` off the floor it is welded into, leaving the spine as it stands; `undefined` when it is welded to none. */
export function detachSpineEnd(generation: SpineGeneration, controlNodeId: string, topologies: readonly ConstructionRegionTopology[], operationId: string): ApplyPatchReplacementRequest | undefined {
  const rung = generation.endRung?.(controlNodeId);
  if (!rung || floorsWeldedBy(floorsOf(topologies), rung.edgeId).length === 0) return undefined;
  const welds = reweldFloors(floorsOf(topologies), { detach: [rung.edgeId], attach: [] }, new Map(), operationId, sharedEdgeIds(topologies));
  return { operationId, sourceSurfaceKeys: welds.sourceSurfaceKeys, patch: { nodes: welds.nodes, edges: welds.edges, regions: welds.regions } };
}

/** Whether the free end `controlNodeId` is welded into a floor. */
export function spineEndWelded(generation: SpineGeneration, controlNodeId: string, topologies: readonly ConstructionRegionTopology[]): boolean {
  const rung = generation.endRung?.(controlNodeId);
  return rung !== undefined && floorsWeldedBy(floorsOf(topologies), rung.edgeId).length > 0;
}
