import type { ApplyPatchReplacementRequest, ConstructionEdgeSnapshot, ConstructionGraphPatch, ConstructionGraphSnapshot, ConstructionRegionTopology, CurvePoint } from "@/ports";

import { isSpineEdge, prospectiveGraph, spineComponent } from "../spine/index.ts";
import { hasTrait, structureTypeFor, type SpineGeneration, type SpineRegeneration, type SpineRegenerationInput } from "../structure-types/index.ts";
import { adoptJointEnd, adoptsEnds, endJointNear, releasableFace } from "./free-end-welds.ts";
import type { EndJoint } from "../topology/floor-weld.ts";
import { landingSeat } from "../topology/floor-weld.ts";
import { floorLandingNear, floorsWeldedBy, floorsWithout, reweldFloors, type FloorLanding } from "../topology/floor-weld.ts";
import { faceKey } from "../topology/plan-geometry.ts";

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


/**
 * The ends `graphPatch` moves, and where each now lands -- onto a free end
 * of a structure that takes nodes over (a straight ramp's), running straight
 * on from it, or else onto a floor's edge -- with the patch placing them there.
 */
function landEnds(snapshot: ConstructionGraphSnapshot, graphPatch: ConstructionGraphPatch, generation: SpineGeneration, topologies: readonly ConstructionRegionTopology[]) {
  const endRung = generation.endRung!;
  const drafted = prospectiveGraph(snapshot, graphPatch);
  const seeds = [...graphPatch.nodes.map((node) => node.id), ...graphPatch.edges.flatMap((edge) => [edge.startNodeId, edge.endNodeId])];
  const ends = spineChainEnds(drafted, seeds);
  const before = new Map(snapshot.nodes.map((node) => [node.id, node.position]));
  const after = new Map(drafted.nodes.map((node) => [node.id, node.position]));
  const shifted = ends.filter((id) => !before.has(id) || moved(before.get(id)!, after.get(id)!));
  if (shifted.length === 0) return { graphPatch, shifted, landed: new Map<string, FloorLanding>(), joined: new Map<string, EndJoint>() };
  const floors = floorsOf(topologies);
  const released = floorsWithout(floors, shifted.map((id) => endRung(id)));
  // An end never lands on the floor the chain's other end is welded into.
  const heldBy = new Set(ends.filter((id) => !shifted.includes(id)).flatMap((id) => floorsWeldedBy(floors, endRung(id))).map((floor) => floor.surfaceKey.join("\u0000")));
  const landed = new Map<string, FloorLanding>();
  const joined = new Map<string, EndJoint>();
  const nodes = new Map(graphPatch.nodes.map((node) => [node.id, node]));
  const edges = new Map(graphPatch.edges.map((edge) => [edge.edgeId, edge]));
  for (const id of shifted) {
    const was = before.get(id), now = after.get(id)!;
    if (was && Math.hypot(was.x - now.x, was.z - now.z) < 1e-9) continue;
    const span: ConstructionEdgeSnapshot | undefined = edges.get(drafted.edges.find((edge) => isSpineEdge(edge) && (edge.startNodeId === id || edge.endNodeId === id))?.edgeId ?? "")
      ?? drafted.edges.find((edge) => isSpineEdge(edge) && (edge.startNodeId === id || edge.endNodeId === id));
    if (!span?.curve) continue;
    const side = span.startNodeId === id ? "start" : "end";
    // A free straight-ramp end within reach: the spine runs straight on from it, at its height.
    const joint = endJointNear(snapshot, topologies, after.get(id)!, { accept: adoptsEnds });
    if (joint) {
      joined.set(id, joint);
      nodes.set(id, { id, position: joint.mid });
      const { geometry: _pinned, ...curve } = span.curve;
      edges.set(span.edgeId, { ...span, curve: { ...curve, [side]: leaving(span.curve[side], joint.out), mode: "aligned" } });
      continue;
    }
    const landing = floorLandingNear(released.filter((floor) => !heldBy.has(floor.surfaceKey.join("\u0000"))), after.get(id)!);
    if (!landing) continue;
    // Where the end sits so its cross-section's two ends stand on the edge -- on a curved edge, the chord's middle.
    const band = (side === "end" ? span.curve.endBandOffsets : undefined) ?? span.curve.bandOffsets;
    const seat = landingSeat(landing, band.length > 1 ? Math.max(...band) - Math.min(...band) : 0);
    if (!seat) continue;
    landed.set(id, landing);
    heldBy.add(landing.topology.surfaceKey.join("\u0000"));
    nodes.set(id, { id, position: seat });
    // A span pinned straight or circular cannot also leave square: it is freed to curve.
    const { geometry: _pinned, ...curve } = span.curve;
    // Square to the edge, on the side the spine goes: off the floor, or up over it.
    const handle = span.curve[side];
    const way = handle[0] * landing.out.x + handle[2] * landing.out.z >= 0 ? landing.out : { x: -landing.out.x, z: -landing.out.z };
    edges.set(span.edgeId, { ...span, curve: { ...curve, [side]: leaving(handle, way), mode: "aligned" } });
  }
  return { graphPatch: { ...graphPatch, nodes: [...nodes.values()], edges: [...edges.values()] }, shifted, landed, joined };
}

/** The free ends of spans `graphPatch` deletes that no span is left on. */
function vanishedEnds(snapshot: ConstructionGraphSnapshot, graphPatch: ConstructionGraphPatch): readonly string[] {
  const removed = new Set(graphPatch.removedEdgeIds ?? []);
  if (removed.size === 0) return [];
  const touched = snapshot.edges.filter((edge) => removed.has(edge.edgeId)).flatMap((edge) => [edge.startNodeId, edge.endNodeId]);
  const standing = new Set(prospectiveGraph(snapshot, graphPatch).edges.filter(isSpineEdge).flatMap((edge) => [edge.startNodeId, edge.endNodeId]));
  return spineChainEnds(snapshot, touched).filter((id) => !standing.has(id));
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
export function regenerateWithEndWelds(
  generation: SpineGeneration,
  input: SpineRegenerationInput,
  /** The ends' floors are carried along with them: their welds stay as they are. */
  options: { readonly keepsWelds?: boolean } = {},
): SpineRegeneration | undefined {
  if (!generation.endRung || options.keepsWelds) return generation.regenerate(input);
  const endRung = generation.endRung;
  const { graphPatch, shifted, landed, joined } = landEnds(input.snapshot, input.graphPatch, generation, input.topologies);
  const regenerated = generation.regenerate({ ...input, graphPatch });
  // Ends whose spans the edit deletes come off their floors too.
  const leaving = [...shifted, ...vanishedEnds(input.snapshot, graphPatch).filter((id) => !shifted.includes(id))];
  if (!regenerated || leaving.length === 0) return regenerated;
  const { request } = regenerated;
  const positions = new Map(request.patch.nodes.map((node) => [node.id, node.position]));
  // Each structure an end now joins takes the end's cross-section over; it is rebuilt here, not released.
  const adopters = [...joined].flatMap(([id, joint]) => adoptJointEnd(input.topologies, joint, endRung(id), positions) ?? []);
  const adopting = new Set(adopters.map(({ face }) => faceKey(face)));
  // Leaving an end gives back its nodes to floors, the ground, and a structure it had joined.
  const releasable = (face: ConstructionRegionTopology) => !adopting.has(faceKey(face)) && (releasableFace(face) || adoptsEnds(face));
  const welds = reweldFloors(input.topologies, {
    detach: leaving.map((id) => endRung(id)),
    attach: [...landed].map(([id, landing]) => ({ rung: endRung(id), floor: landing.topology.surfaceKey })),
  }, positions, input.operationId, releasable);
  if (welds.sourceSurfaceKeys.length === 0 && adopters.length === 0) return regenerated;
  const rewelded: ApplyPatchReplacementRequest = {
    ...request,
    sourceSurfaceKeys: [...request.sourceSurfaceKeys, ...welds.sourceSurfaceKeys, ...adopters.map(({ face }) => face.surfaceKey)],
    patch: {
      nodes: [...request.patch.nodes, ...welds.nodes, ...adopters.flatMap(({ rebuilt }) => rebuilt.patch.nodes)],
      edges: [...request.patch.edges, ...welds.edges, ...adopters.flatMap(({ rebuilt }) => rebuilt.patch.edges)],
      regions: [...request.patch.regions, ...welds.regions, ...adopters.flatMap(({ rebuilt }) => rebuilt.patch.regions)],
    },
  };
  return { ...regenerated, request: rewelded };
}
