import type { ApplyPatchReplacementRequest, BezierPort, ConstructionGraphPatch, ConstructionGraphSnapshot, ConstructionPatch, ConstructionPosition, ConstructionRegionTopology, CurvePoint } from "@/ports";
import { curvePick, planSpineEditPatch, type SpineEditInput, chainsOf, spineGraphFromSnapshot, prospectiveGraph } from "../../spine/index.ts";
import { curvePoint, curvePosition } from "../../topology/bezier-curve.ts";
import { muroStructureType } from "./muro-structure.ts";
import type { SpineRegenerationInput } from "../structure-type.ts";

/** Durable ownership is encoded in graph IDs, never in an additional recipe store. */
export function muroOwner(edgeId: string): string | undefined {
  return /^spine-edge:muro:([^:]+):/.exec(edgeId)?.[1];
}

export function muroOwnerForTarget(snapshot: ConstructionGraphSnapshot, targetId: string): string | undefined {
  const pick = curvePick(targetId);
  const edge = snapshot.edges.find((e) => pick ? e.edgeId === pick.edgeId : e.startNodeId === targetId || e.endNodeId === targetId);
  return edge && muroOwner(edge.edgeId);
}

function ownedGraph(snapshot: ConstructionGraphSnapshot, owner: string): ConstructionGraphSnapshot {
  const edges = snapshot.edges.filter((e) => muroOwner(e.edgeId) === owner);
  const ids = new Set(edges.flatMap((e) => [e.startNodeId, e.endNodeId]));
  return { edges, nodes: snapshot.nodes.filter((n) => ids.has(n.id)) };
}

/** Product selection only; polygon triangulation and ground projection run in Rust. */
function supportingGround(topologies: readonly ConstructionRegionTopology[]) {
  return topologies.filter((t) => muroStructureType.conformsTo!(t.surfaceType)).flatMap((t) => {
    const nodes = new Map(t.nodes.map((n) => [n.id, curvePoint(n.position)]));
    const ring = (loop: ConstructionRegionTopology["outerLoops"][number]) => loop.map((e) => nodes.get(e.startNodeId)!);
    return t.outerLoops.map((outer) => [ring(outer), ...t.holes.map(ring)]);
  });
}

function regenerate(input: {
  snapshot: ConstructionGraphSnapshot; graphPatch: ConstructionGraphPatch; topologies: readonly ConstructionRegionTopology[];
  owner: string; operationId: string; height: number; port: BezierPort; selectedId: string;
}) {
  if (!Number.isFinite(input.height) || input.height <= 0) throw Error("Informe uma altura positiva para o muro.");
  const source = ownedGraph(input.snapshot, input.owner);
  const graph = prospectiveGraph(source, input.graphPatch);
  const chains = chainsOf(spineGraphFromSnapshot(graph));
  const ground = supportingGround(input.topologies);
  const commands = chains.filter((c) => c.nodes.length > 1).map((chain) => {
    const segments = chain.nodes.slice(1).map((b, i) => {
      const a = chain.nodes[i]!;
      const edge = graph.edges.find((e) => (e.startNodeId === a.nodeId && e.endNodeId === b.nodeId) || (e.startNodeId === b.nodeId && e.endNodeId === a.nodeId))!;
      const reversed = edge.startNodeId !== a.nodeId;
      const handles = edge.curve!;
      const start = handles.bandOffsets;
      const end = handles.endBandOffsets ?? start;
      const curve = input.port.curveBatch({ tolerance: 0.025, commands: [{ kind: "resolve", handles: reversed ? { ...handles, start: handles.end, end: handles.start } : handles, start: curvePoint(a.position), end: curvePoint(b.position) }] })[0]!.curves[0]!;
      // Reversing traversal reverses the lateral axis too.
      return { curve, offsets: (reversed ? [-end[1]!, -end[0]!] : [start[0]!, start[1]!]) as [number, number], endOffsets: (reversed ? [-start[1]!, -start[0]!] : [end[0]!, end[1]!]) as [number, number] };
    });
    return { kind: "extrudeRibbon" as const, segments, height: input.height, ground };
  });
  const generated = input.port.curveBatch({ tolerance: 0.025, commands });
  const patch: { nodes: ConstructionPatch["nodes"][number][]; edges: ConstructionPatch["edges"][number][]; regions: ConstructionPatch["regions"][number][] } = { nodes: [], edges: [], regions: [] };
  const preview: number[] = [];
  generated.forEach((result, chain) => {
    const mesh = result.extrusion;
    if (!mesh) throw Error("A geração do muro não retornou uma extrusão.");
    const prefix = `muro:${input.owner}:${input.height}:${encodeURIComponent(input.operationId)}:${chain}`;
    const id = (index: number) => `${prefix}:vertex:${index}`;
    mesh.vertices.forEach((p, i) => patch.nodes.push({ id: id(i), position: curvePosition(p) }));
    mesh.edges.forEach(([a,b], i) => {
      patch.edges.push({ edgeId: `${prefix}:edge:${i}`, startNodeId: id(a), endNodeId: id(b) });
      preview.push(...mesh.vertices[a]!, ...mesh.vertices[b]!);
    });
    mesh.boundaries.forEach((boundary, i) => patch.regions.push({ regionId: `${prefix}:face:${i}`, surfaceType: "muro", physical: true, boundary: boundary.map(([edgeIndex, reversed]) => ({ edgeId: `${prefix}:edge:${edgeIndex}`, reversed })) }));
  });
  const request: ApplyPatchReplacementRequest = {
    operationId: input.operationId, graphPatch: input.graphPatch, patch,
    sourceSurfaceKeys: input.topologies.filter((t) => t.surfaceType === "muro" && t.surfaceKey[1]?.startsWith(`muro:${input.owner}:`)).map((t) => t.surfaceKey),
  };
  return { request, preview: new Float32Array(preview), selectedId: input.selectedId };
}

export function planMuroCreation(input: {
  snapshot: ConstructionGraphSnapshot; topologies: readonly ConstructionRegionTopology[]; port: BezierPort;
  stroke: readonly ConstructionPosition[]; operationId: string; height: number; thickness: number; tolerance: number;
}) {
  if (!Number.isFinite(input.thickness) || input.thickness <= 0) throw Error("Informe uma espessura positiva para o muro.");
  if (input.stroke.length < 2) return undefined;
  const fitted = input.port.curveBatch({ tolerance: Math.max(0.025, input.tolerance), commands: [{ kind: "fit", points: input.stroke.map(curvePoint) }] })[0]!;
  if (!fitted.curves.length) return undefined;
  const owner = encodeURIComponent(input.operationId);
  const anchors: CurvePoint[] = [...fitted.curves.map((c) => c.points[0]), fitted.curves.at(-1)!.points[3]];
  const nodes = anchors.map((p,i) => ({ id: `spine:muro:${owner}:${i}`, position: curvePosition(p) }));
  const graphPatch: ConstructionGraphPatch = { nodes, edges: fitted.handles.map((h,i) => ({ edgeId: `spine-edge:muro:${owner}:${i}`, startNodeId: nodes[i]!.id, endNodeId: nodes[i+1]!.id, curve: { ...h, surfaceType: "muro", bandOffsets: [-input.thickness/2, input.thickness/2] } })) };
  return regenerate({ ...input, owner, graphPatch, selectedId: nodes[0]!.id });
}

export function planMuroEdit(input: SpineEditInput & { readonly topologies: readonly ConstructionRegionTopology[]; readonly tableId: string; readonly height?: number; readonly setHeight?: boolean }) {
  const owner = muroOwnerForTarget(input.snapshot, input.targetId);
  if (!owner) return undefined;
  const face = input.topologies.find((t) => t.surfaceType === "muro" && t.surfaceKey[1]?.startsWith(`muro:${owner}:`));
  if (!face) throw Error("Não foi possível identificar a altura do muro.");
  const height = input.setHeight ? input.height! : Number(face.surfaceKey[1]!.split(":")[2]);
  const source = ownedGraph(input.snapshot, owner);
  const edit = input.setHeight ? { graphPatch: { nodes: [], edges: [] }, selectedId: input.targetId } : planSpineEditPatch({ ...input, snapshot: source, operationId: `muro:${owner}:edit:${encodeURIComponent(input.operationId)}` });
  if (!edit) return undefined;
  return regenerate({ ...input, owner, height, graphPatch: edit.graphPatch, selectedId: edit.selectedId });
}

/** Registry entry for the shared spine editor, including callers outside the pointer tool. */
export function regenerateMuroSpine(input: SpineRegenerationInput) {
  const seeds = new Set(input.graphPatch.nodes.map((n) => n.id));
  const removed = new Set(input.graphPatch.removedEdgeIds ?? []);
  const edge = input.snapshot.edges.find((e) => muroOwner(e.edgeId) && (removed.has(e.edgeId) || seeds.has(e.startNodeId) || seeds.has(e.endNodeId)));
  const owner = edge && muroOwner(edge.edgeId);
  if (!owner) return undefined;
  const face = input.topologies.find((t) => t.surfaceType === "muro" && t.surfaceKey[1]?.startsWith(`muro:${owner}:`));
  if (!face) return undefined;
  const height = Number(face.surfaceKey[1]!.split(":")[2]);
  // A newly closed span is minted by the shared editor; retain this muro's instance identity.
  const graphPatch = { ...input.graphPatch, edges: input.graphPatch.edges.map((e) => muroOwner(e.edgeId) ? e : { ...e, edgeId: `spine-edge:muro:${owner}:${encodeURIComponent(e.edgeId)}` }) };
  return regenerate({ ...input, owner, height, graphPatch, selectedId: "" });
}
