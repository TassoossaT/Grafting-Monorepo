// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time. A type-only
// `@/` import is fine -- those are erased.
import type {
  ApplyPatchReplacementRequest,
  ConstructionPatch,
  ConstructionPatchEdge,
  ConstructionPatchOutcome,
  ConstructionPosition,
  ConstructionRegionEdge,
  ConstructionRegionTopology,
  ConstructionSurfaceKey,
} from "@/ports";
import type { ShapeChange } from "@/features/edit-construction";
import { reverseGeometry } from "../../../features/edit-construction/index.ts";

/** What reading a change's faces needs of the runtime. */
export interface ShapeChangeRuntime {
  getRegionTopology?(surfaceKey: ConstructionSurfaceKey): ConstructionRegionTopology | undefined;
  getSnapshot(): { readonly map: { readonly nodePositions: ReadonlyMap<string, { readonly position: ConstructionPosition }> } };
}

/** The faces behind `keys` that still exist. A stale key is skipped, not fatal. */
export function topologiesOf(runtime: ShapeChangeRuntime, keys: readonly ConstructionSurfaceKey[]): ConstructionRegionTopology[] {
  if (typeof runtime.getRegionTopology !== "function") return [];
  return keys.flatMap((key) => {
    try {
      const topology = runtime.getRegionTopology!(key);
      return topology == null ? [] : [topology];
    } catch {
      return [];
    }
  });
}

function edgeUsesOf(
  uses: readonly { readonly edgeId: string; readonly reversed: boolean }[],
  edgeById: ReadonlyMap<string, ConstructionPatchEdge>,
  nodeAt: (id: string) => ConstructionPosition | undefined,
  nodes: Map<string, ConstructionPosition>,
): ConstructionRegionEdge[] {
  return uses.map((use) => {
    const edge = edgeById.get(use.edgeId);
    const startNodeId = edge ? (use.reversed ? edge.endNodeId : edge.startNodeId) : "";
    const endNodeId = edge ? (use.reversed ? edge.startNodeId : edge.endNodeId) : "";
    for (const id of [startNodeId, endNodeId]) {
      const position = id ? nodeAt(id) : undefined;
      if (position) nodes.set(id, position);
    }
    const own = edge?.geometry ?? { kind: "line" as const };
    return { edgeId: use.edgeId, reversed: use.reversed, startNodeId, endNodeId, geometry: use.reversed ? reverseGeometry(own) : own };
  });
}

/** A patch's regions as topologies, for when the engine cannot yet be asked for them. */
export function topologiesFromPatch(patch: ConstructionPatch, runtime: ShapeChangeRuntime): readonly ConstructionRegionTopology[] {
  const edgeById = new Map<string, ConstructionPatchEdge>();
  for (const edge of patch.edges) edgeById.set(edge.edgeId ?? (edge as unknown as { id: string }).id, edge);
  const declared = new Map(patch.nodes.map((node) => [node.id, node.position]));
  const liveNodes = runtime.getSnapshot().map.nodePositions;
  const nodeAt = (id: string) => declared.get(id) ?? liveNodes.get(id)?.position;
  return patch.regions.map((region) => {
    const nodes = new Map<string, ConstructionPosition>();
    const outer = edgeUsesOf(region.boundary, edgeById, nodeAt, nodes);
    const holes = (region.holes ?? []).map((hole) => edgeUsesOf(hole, edgeById, nodeAt, nodes));
    return {
      surfaceKey: ["@region", region.regionId],
      surfaceType: region.surfaceType,
      physical: region.physical,
      nodes: [...nodes].map(([id, position]) => ({ id, position })),
      outerLoops: [outer],
      holes,
    };
  });
}

/**
 * What a patch replacement changed, for effects to carry: the faces it
 * replaced as they were, the faces it produced as they are, and what it
 * claimed or destroyed along the way.
 *
 * `before` must be read before the replacement runs; everything else after.
 */
export function shapeChangeOfReplacement(
  runtime: ShapeChangeRuntime,
  request: ApplyPatchReplacementRequest,
  before: readonly ConstructionRegionTopology[],
  outcome: ConstructionPatchOutcome | undefined,
  subtype?: string,
): ShapeChange | undefined {
  const surfaceType = request.patch.regions[0]?.surfaceType ?? before[0]?.surfaceType;
  if (surfaceType === undefined) return undefined;
  let after = topologiesOf(runtime, outcome?.createdSurfaceKeys ?? []).filter((topology) => topology.surfaceType === surfaceType);
  if (after.length === 0 && request.patch.regions.length > 0) after = [...topologiesFromPatch(request.patch, runtime)];
  return {
    surfaceType,
    subtype,
    before,
    after,
    footprintOutline: request.footprintOutline,
    removedNodeIds: outcome?.removedNodeIds ?? [],
    declaredPositions: [
      ...request.patch.nodes.map((node) => node.position),
      ...(request.graphPatch?.nodes ?? []).map((node) => node.position),
    ],
  };
}

/** What adding a patch changed: nothing replaced, the faces it registered produced. */
export function shapeChangeOfAddition(
  runtime: ShapeChangeRuntime,
  patch: ConstructionPatch,
  outcome: ConstructionPatchOutcome,
): ShapeChange | undefined {
  const surfaceType = patch.regions[0]?.surfaceType;
  if (surfaceType === undefined) return undefined;
  let after = topologiesOf(runtime, outcome.createdSurfaceKeys);
  if (after.length === 0) after = [...topologiesFromPatch(patch, runtime)];
  return { surfaceType, before: [], after, removedNodeIds: outcome.removedNodeIds, declaredPositions: patch.nodes.map((node) => node.position) };
}

/** What deleting faces changed: all of them gone, nothing produced. */
export function shapeChangeOfRemoval(removed: readonly ConstructionRegionTopology[], removedNodeIds: readonly string[]): ShapeChange | undefined {
  const surfaceType = removed[0]?.surfaceType;
  if (surfaceType === undefined) return undefined;
  return { surfaceType, before: removed, after: [], removedNodeIds, declaredPositions: [] };
}
