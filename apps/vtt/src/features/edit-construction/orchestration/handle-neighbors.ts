import type { ConstructionPatch, ConstructionPosition, ConstructionRegionEdge, ConstructionRegionTopology } from "@/ports";

import type { GlobalHandle } from "../global-handles/index.ts";
import type { LinkPoint, LinkRun } from "../ruler/index.ts";
import { faceKey } from "../topology/plan-geometry.ts";

/**
 * What a handle that edits a vertex edits against: the vertex's neighbours,
 * which stay where they are, and the structure's other sides, which are what
 * its angles are read from. The ruler measures an edited side from a fixed
 * neighbour to where the vertex now stands -- never from where the vertex
 * began, which is gone the moment it moves. Read off the topology alone, for
 * any structure: nothing here asks what it is.
 */

export interface EditNeighbours {
  /** The vertices joined to the one edited, level or not, each at the plan distance that makes it a real neighbour: where the vertex is moved against. */
  readonly fixed: readonly LinkPoint[];
  /** The structure's own level sides that do not touch the vertex: the directions its angles are read against -- parallel to them, square to them. */
  readonly own: readonly LinkRun[];
}

/** Closer than this, in plan, two nodes are one place -- a wall's foot and its top. */
const SAME_PLACE = 1e-4;
/** How far apart in height a side's two ends may stand and still be a level run. */
const LEVEL = 0.05;

/** The vertex a handle edits, or the two ends of the side it edits; `undefined` for one that edits neither. */
function editedNodes(handle: GlobalHandle, topologies: readonly ConstructionRegionTopology[]): readonly string[] {
  const target = handle.target;
  if (target?.kind === "vertex") return [target.nodeId];
  if (target?.kind !== "edge") return [];
  const use = topologies.flatMap((topology) => [...topology.outerLoops, ...topology.holes].flat()).find((candidate) => candidate.edgeId === target.edgeId);
  return use ? [use.startNodeId, use.endNodeId] : [];
}

/** The neighbours and the own sides of what `handle` edits, among `topologies`; empty when it edits no vertex. */
export function editNeighbours(topologies: readonly ConstructionRegionTopology[], handle: GlobalHandle): EditNeighbours {
  const edited = new Set(editedNodes(handle, topologies));
  if (edited.size === 0) return { fixed: [], own: [] };
  const faces = handle.faces ? new Set(handle.faces) : undefined;
  const fixed = new Map<string, LinkPoint>();
  const own = new Map<string, LinkRun>();
  const edgeIsTarget = handle.target?.kind === "edge";
  for (const topology of topologies) {
    if (faces && !faces.has(faceKey(topology))) continue;
    const at = new Map(topology.nodes.map((node) => [node.id, node.position]));
    for (const use of [...topology.outerLoops, ...topology.holes].flat()) {
      const a = at.get(use.startNodeId), b = at.get(use.endNodeId);
      if (!a || !b) continue;
      const touches = edited.has(use.startNodeId) || edited.has(use.endNodeId);
      if (touches) {
        // A side being pushed out has its own ends as the neighbours of the corner pulled from it; a vertex has the far end of every side that leaves it.
        const toward = edgeIsTarget ? [use.startNodeId, use.endNodeId].filter((id) => edited.has(id)) : [edited.has(use.startNodeId) ? use.endNodeId : use.startNodeId];
        for (const id of toward) {
          const position = at.get(id)!;
          const origin = edited.has(use.startNodeId) ? a : b;
          if (!edgeIsTarget && Math.hypot(position.x - origin.x, position.z - origin.z) < SAME_PLACE) continue;
          fixed.set(id, { id, position });
        }
        continue;
      }
      if (use.geometry.kind !== "line" || Math.abs(a.y - b.y) > LEVEL || Math.hypot(b.x - a.x, b.z - a.z) < SAME_PLACE) continue;
      const key = use.startNodeId < use.endNodeId ? `${use.startNodeId}|${use.endNodeId}` : `${use.endNodeId}|${use.startNodeId}`;
      if (!own.has(key)) own.set(key, { a: { id: use.startNodeId, position: a }, b: { id: use.endNodeId, position: b } });
    }
  }
  return { fixed: [...fixed.values()], own: [...own.values()] };
}


/** The keys of the faces any of `nodeIds` belongs to: the whole structure a handle without faces edits, so it never links to itself. */
export function facesOfNodes(topologies: readonly ConstructionRegionTopology[], nodeIds: readonly string[]): ReadonlySet<string> {
  const wanted = new Set(nodeIds);
  return new Set(topologies.filter((topology) => topology.nodes.some((node) => wanted.has(node.id))).map(faceKey));
}

/** A side next to the one edited: its far end stays, its near end is the edited side's end, which moves with it. */
export interface AdjacentSide {
  readonly far: LinkPoint;
  readonly near: ConstructionPosition;
}

/** The level sides that leave the two ends of the side `handle` edits, other than it -- the ones that grow or shrink as it is pushed. */
export function adjacentSides(topologies: readonly ConstructionRegionTopology[], handle: GlobalHandle): readonly AdjacentSide[] {
  const target = handle.target;
  if (target?.kind !== "edge") return [];
  const ends = new Set(editedNodes(handle, topologies));
  const faces = handle.faces ? new Set(handle.faces) : undefined;
  const found = new Map<string, AdjacentSide>();
  for (const topology of topologies) {
    if (faces && !faces.has(faceKey(topology))) continue;
    const at = new Map(topology.nodes.map((node) => [node.id, node.position]));
    for (const use of [...topology.outerLoops, ...topology.holes].flat()) {
      if (use.edgeId === target.edgeId || use.geometry.kind !== "line") continue;
      const startEdited = ends.has(use.startNodeId), endEdited = ends.has(use.endNodeId);
      if (startEdited === endEdited) continue;
      const nearId = startEdited ? use.startNodeId : use.endNodeId, farId = startEdited ? use.endNodeId : use.startNodeId;
      const near = at.get(nearId), far = at.get(farId);
      if (!near || !far || Math.abs(near.y - far.y) > LEVEL || Math.hypot(far.x - near.x, far.z - near.z) < SAME_PLACE) continue;
      found.set(use.edgeId, { far: { id: farId, position: far }, near });
    }
  }
  return [...found.values()];
}

/** The lowest nodes of what `handle` edits, the nearest to it in plan: the eave a pitch is read from. */
export function eavesOf(topologies: readonly ConstructionRegionTopology[], handle: GlobalHandle): readonly LinkPoint[] {
  const faces = handle.faces ? new Set(handle.faces) : undefined;
  const nodes = topologies.filter((topology) => !faces || faces.has(faceKey(topology))).flatMap((topology) => topology.nodes);
  if (nodes.length === 0) return [];
  const low = Math.min(...nodes.map((node) => node.position.y));
  const eaves = nodes.filter((node) => node.position.y - low < LEVEL);
  const plan = (p: ConstructionPosition) => Math.hypot(p.x - handle.pivot.x, p.z - handle.pivot.z);
  const nearest = eaves.reduce((best, node) => (plan(node.position) < plan(best.position) ? node : best));
  return Math.hypot(nearest.position.x - handle.pivot.x, nearest.position.z - handle.pivot.z) < SAME_PLACE ? [] : [{ id: nearest.id, position: nearest.position }];
}

/**
 * The faces `patch` would make, as topologies: what a handle provider reads a structure from, before the structure exists. Each face's loops are
 * resolved the way a region reports them; a face over a node the patch does not give is left out.
 */
export function topologiesOfPatch(patch: ConstructionPatch, faceProps: ReadonlyMap<string, Readonly<Record<string, unknown>>> | undefined): readonly ConstructionRegionTopology[] {
  const nodes = new Map(patch.nodes.map((node) => [node.id, node.position]));
  const edges = new Map(patch.edges.map((edge) => [edge.edgeId, edge]));
  const resolve = (loop: readonly { readonly edgeId: string; readonly reversed: boolean }[]): ConstructionRegionEdge[] | undefined => {
    const out: ConstructionRegionEdge[] = [];
    for (const use of loop) {
      const edge = edges.get(use.edgeId);
      if (!edge) return undefined;
      out.push({ edgeId: use.edgeId, reversed: use.reversed, startNodeId: use.reversed ? edge.endNodeId : edge.startNodeId, endNodeId: use.reversed ? edge.startNodeId : edge.endNodeId, geometry: edge.geometry ?? { kind: "line" } } as ConstructionRegionEdge);
    }
    return out;
  };
  const faces: ConstructionRegionTopology[] = [];
  for (const region of patch.regions) {
    const outer = resolve(region.boundary);
    const holes = (region.holes ?? []).map(resolve);
    if (!outer || holes.some((hole) => hole === undefined)) continue;
    const ids = new Set([...outer, ...holes.flatMap((hole) => hole!)].flatMap((use) => [use.startNodeId, use.endNodeId]));
    const found = [...ids].flatMap((id) => (nodes.has(id) ? [{ id, position: nodes.get(id)! }] : []));
    if (found.length !== ids.size) continue;
    faces.push({ surfaceKey: [region.regionId] as unknown as ConstructionRegionTopology["surfaceKey"], surfaceType: region.surfaceType, physical: region.physical, outerLoops: [outer], holes: holes as ConstructionRegionEdge[][], nodes: found, ...(faceProps?.get(region.regionId) ? { props: faceProps.get(region.regionId)! } : {}) });
  }
  return faces;
}
