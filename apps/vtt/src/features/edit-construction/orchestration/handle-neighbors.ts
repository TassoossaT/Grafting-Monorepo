import type { ConstructionRegionTopology } from "@/ports";

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

