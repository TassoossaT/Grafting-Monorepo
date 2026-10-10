import type {
  ApplyPatchReplacementRequest,
  ConstructionNodeId,
  ConstructionOrientedEdgeUse,
  ConstructionPatchOutcome,
  ConstructionPatchRegion,
  ConstructionPosition,
  ConstructionRegionTopology,
} from "@/ports";
import type { AtomicEditOp } from "@/features/edit-construction";

// Relative, not `@/...`: the test runner resolves no aliases.
import { createBoundaryEdges, sharedEdgeId, structureTypeFor } from "../../../features/edit-construction/index.ts";
import { SHORTEST_USEFUL_FRACTION, adoptContourNodes, type ContourAdoption } from "./terrain-constraints.ts";

/**
 * Ground laid again on the surface goes into the graph here -- whichever
 * engine laid it: a volume edit (`edit_surface`) or a repair on the surface
 * (`regenerate_surface`). Nothing here reads a plane: every distance is in
 * three dimensions, every corner where the engine put it.
 *
 * - A corner that already was a node stays that node.
 * - A new corner lying on a side somebody holds -- the ground beyond the
 *   ring, a structure the ground goes round -- splits that side there, so the
 *   two share the node; near an end of the side it is that end instead. A
 *   sealed structure's side is met, never split: the corner stays the
 *   ground's own, on the side.
 * - An edge the ground beyond or a structure already holds is reused by id;
 *   one only the replaced faces held (the map's border) is declared again.
 */

/** What committing ground needs of the runtime. */
export interface GroundCommitRuntime {
  applyRegionEdit(ops: readonly AtomicEditOp[], origin: "local", causeId: string): unknown;
  applyPatchReplacement(request: ApplyPatchReplacementRequest, origin: "local", causeId: string): ConstructionPatchOutcome;
  getSnapshot(): { readonly map: { readonly nodePositions: ReadonlyMap<ConstructionNodeId, { readonly position: ConstructionPosition }> } };
}

/** Ground laid by an engine, in the faces' own indexing. */
export interface LaidGround {
  readonly vertices: readonly (readonly [number, number, number])[];
  readonly faces: readonly (readonly number[])[];
  /** The node a corner already is, or `undefined` for a new corner. */
  readonly nodeOf: (vertex: number) => ConstructionNodeId | undefined;
  /** New corners lying on a side between two standing nodes. */
  readonly landed?: readonly { readonly vertex: number; readonly from: ConstructionNodeId; readonly to: ConstructionNodeId }[];
}

export interface GroundCommit {
  readonly operationId: string;
  readonly tableId: string;
  /** The faces taken away. */
  readonly replaced: readonly ConstructionRegionTopology[];
  /** Faces standing round them -- ground beyond, structures met -- whose edges the new ground reuses. */
  readonly around: readonly ConstructionRegionTopology[];
  readonly surfaceType: string;
  /** How wide a face is, for how near an end a landed corner snaps to it. */
  readonly faceSide: number;
  readonly laid: LaidGround;
}

export interface GroundCommitOutcome {
  readonly built: number;
  readonly refused: number;
  /** New corners on a side that could not split it: one T-junction each. */
  readonly unadopted: number;
}

const pairKey = (a: ConstructionNodeId, b: ConstructionNodeId) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

/** Registers `commit.laid` in place of `commit.replaced`. Throws where the engine refuses a face; run it in a transaction. */
export function commitGround(runtime: GroundCommitRuntime, commit: GroundCommit): GroundCommitOutcome {
  const { operationId, tableId, laid } = commit;
  const live = runtime.getSnapshot().map.nodePositions;

  // Every standing edge by the pair it joins, with the end it is stored from.
  const standing = new Map<string, { readonly edgeId: string; readonly start: ConstructionNodeId }>();
  const replacedKeys = new Set(commit.replaced.map((face) => face.surfaceKey.join("\u0000")));
  const heldBeyond = new Set<string>();
  // How many faces beyond the ones laid again hold each standing edge.
  const usesBeyond = new Map<string, number>();
  const sealedEdges = new Set<string>();
  for (const face of [...commit.replaced, ...commit.around]) {
    const beyond = !replacedKeys.has(face.surfaceKey.join("\u0000"));
    const sealed = structureTypeFor(face.surfaceType)?.sealedOutline === true;
    for (const use of [...face.outerLoops, ...face.holes].flat()) {
      standing.set(pairKey(use.startNodeId, use.endNodeId), { edgeId: use.edgeId, start: use.reversed ? use.endNodeId : use.startNodeId });
      if (beyond) {
        heldBeyond.add(use.edgeId);
        usesBeyond.set(use.edgeId, (usesBeyond.get(use.edgeId) ?? 0) + 1);
      }
      if (sealed) sealedEdges.add(use.edgeId);
    }
  }
  const positionOfNode = (id: ConstructionNodeId) => live.get(id)?.position;

  // Which node each corner is: standing, snapped onto an end, or new.
  const minted = (vertex: number): ConstructionNodeId => `${operationId}:v${vertex}`;
  const resolved = new Map<number, ConstructionNodeId>();
  const claimed = new Set<ConstructionNodeId>();
  laid.vertices.forEach((_, vertex) => {
    const id = laid.nodeOf(vertex);
    if (id !== undefined) {
      resolved.set(vertex, id);
      claimed.add(id);
    }
  });
  const positions = new Map<number, ConstructionPosition>();
  const adoptions: ContourAdoption[] = [];
  const snapLength = commit.faceSide * SHORTEST_USEFUL_FRACTION;
  for (const landing of laid.landed ?? []) {
    const from = positionOfNode(landing.from), to = positionOfNode(landing.to);
    const edge = standing.get(pairKey(landing.from, landing.to));
    if (from === undefined || to === undefined || edge === undefined) continue;
    // A side two faces beyond already hold is ground beyond, not the rim: a
    // chord across a notch of the rim runs between the same two corners.
    // Split for the new corner, it would be held three times.
    if ((usesBeyond.get(edge.edgeId) ?? 0) > 1) continue;
    const [x, y, z] = laid.vertices[landing.vertex]!;
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const length = Math.hypot(dx, dy, dz);
    if (length <= 0) continue;
    const along = Math.min(1, Math.max(0, ((x - from.x) * dx + (y - from.y) * dy + (z - from.z) * dz) / (length * length)));
    // Near an end, the corner is that end -- never an edge shorter than a fraction of a face.
    const end = along * length < snapLength ? landing.from : (1 - along) * length < snapLength ? landing.to : undefined;
    if (end !== undefined && !claimed.has(end)) {
      resolved.set(landing.vertex, end);
      claimed.add(end);
      continue;
    }
    const position = { x: from.x + dx * along, y: from.y + dy * along, z: from.z + dz * along };
    positions.set(landing.vertex, position);
    if (sealedEdges.has(edge.edgeId)) continue;
    const storedEnd = edge.start === landing.from ? landing.to : landing.from;
    const alongStored = edge.start === landing.from ? along : 1 - along;
    adoptions.push({
      vertex: landing.vertex,
      edge: { edgeId: edge.edgeId, startNodeId: edge.start, endNodeId: storedEnd, reversed: false, geometry: { kind: "line" } },
      along: alongStored,
      edgeLength: length,
    });
  }

  const adoption = adoptContourNodes(runtime, tableId, operationId, adoptions, minted, (vertex) => positions.get(vertex));
  // The fragments a split leaves are named by their pairs; they are standing
  // now, held by whoever held the edge split.
  const perEdge = new Map<string, ContourAdoption[]>();
  for (const candidate of adoptions) {
    if (!adoption.adopted.has(candidate.vertex)) continue;
    perEdge.set(candidate.edge.edgeId, [...(perEdge.get(candidate.edge.edgeId) ?? []), candidate]);
  }
  // The corners each split side now runs through, from its stored start to its end.
  const splitThrough = new Map<string, { readonly start: ConstructionNodeId; readonly corners: readonly ConstructionNodeId[] }>();
  for (const [edgeId, group] of perEdge) {
    const { startNodeId: start, endNodeId: end } = group[0]!.edge;
    splitThrough.set(pairKey(start, end), { start, corners: [...group].sort((a, b) => a.along - b.along).map((candidate) => minted(candidate.vertex)) });
    const beyond = heldBeyond.has(edgeId);
    let from = start;
    for (const candidate of [...group].sort((a, b) => a.along - b.along)) {
      const node = minted(candidate.vertex);
      const first = sharedEdgeId(tableId, from, node);
      standing.set(pairKey(from, node), { edgeId: first, start: from });
      if (beyond) heldBeyond.add(first);
      from = node;
    }
    const last = sharedEdgeId(tableId, from, end);
    standing.set(pairKey(from, end), { edgeId: last, start: from });
    if (beyond) heldBeyond.add(last);
  }

  const nodeIdOf = (vertex: number): ConstructionNodeId => resolved.get(vertex) ?? minted(vertex);
  const nodes = laid.vertices.flatMap(([x, y, z], vertex) =>
    resolved.has(vertex) || adoption.adopted.has(vertex) ? [] : [{ id: minted(vertex), position: positions.get(vertex) ?? { x, y, z } }],
  );

  const redeclared = new Map<string, { readonly edgeId: string; readonly startNodeId: ConstructionNodeId; readonly endNodeId: ConstructionNodeId }>();
  const builder = createBoundaryEdges(tableId, { kind: "private-when-full", runPrefix: operationId, existingUses: new Map() });
  const useOf = (a: ConstructionNodeId, b: ConstructionNodeId): ConstructionOrientedEdgeUse => {
    const existing = standing.get(pairKey(a, b));
    if (!existing) return builder.use(a, b);
    // An edge only the faces laid again held -- the map's own border -- goes
    // with them when they are replaced, so it is declared again here.
    if (!heldBeyond.has(existing.edgeId)) {
      redeclared.set(existing.edgeId, { edgeId: existing.edgeId, startNodeId: existing.start, endNodeId: existing.start === a ? b : a });
    }
    return { edgeId: existing.edgeId, reversed: existing.start !== a };
  };
  // A corner snapped onto its neighbour's node folds the two into one. A face
  // running a whole side that corners laid beside it split runs through those
  // corners too: the side itself is gone once split.
  const rings = laid.faces.map((face) => face.map(nodeIdOf).filter((id, k, all) => id !== all[(k + 1) % all.length]).flatMap((id, k, all) => {
    const next = all[(k + 1) % all.length]!;
    const through = splitThrough.get(pairKey(id, next));
    if (through === undefined) return [id];
    const corners = through.start === id ? through.corners : [...through.corners].reverse();
    return [id, ...corners.filter((corner) => corner !== id && corner !== next && !all.includes(corner))];
  }));
  // A side the new ground runs between two standing nodes that the ground
  // beyond already joins -- a chord across a notch of the rim, with the
  // ground outside the notch holding its own side between the same two --
  // is one edge to the graph, held three times. It is split at its middle.
  const newUses = new Map<string, number>();
  for (const ring of rings) ring.forEach((id, k) => {
    const key = pairKey(id, ring[(k + 1) % ring.length]!);
    newUses.set(key, (newUses.get(key) ?? 0) + 1);
  });
  const middles = new Map<string, ConstructionNodeId>();
  const middleNodes: { readonly id: ConstructionNodeId; readonly position: ConstructionPosition }[] = [];
  const middleOf = (a: ConstructionNodeId, b: ConstructionNodeId): ConstructionNodeId | undefined => {
    const key = pairKey(a, b);
    const edge = standing.get(key);
    if (edge === undefined || (usesBeyond.get(edge.edgeId) ?? 0) + (newUses.get(key) ?? 0) <= 2) return undefined;
    const known = middles.get(key);
    if (known !== undefined) return known;
    const p = positionOfNode(a), q = positionOfNode(b);
    if (p === undefined || q === undefined) return undefined;
    const id = `${operationId}:m${middles.size}`;
    middles.set(key, id);
    middleNodes.push({ id, position: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, z: (p.z + q.z) / 2 } });
    return id;
  };
  const split = rings.map((ring) => ring.flatMap((id, k) => {
    const middle = middleOf(id, ring[(k + 1) % ring.length]!);
    return middle === undefined ? [id] : [id, middle];
  }));
  const regions: ConstructionPatchRegion[] = split.flatMap((ring, f) => {
    // A ring through one node twice is the loops it walks, each a face --
    // dropped, it would leave a hole in the ground.
    return loopsOf(ring).map((loop, k) => ({
      regionId: `${operationId}:f${f}${k > 0 ? `.${k}` : ""}`,
      boundary: loop.map((id, i) => useOf(id, loop[(i + 1) % loop.length]!)),
      holes: [],
      surfaceType: commit.surfaceType,
      physical: true,
    }));
  });

  const outcome = runtime.applyPatchReplacement({
    operationId,
    sourceSurfaceKeys: commit.replaced.map((face) => face.surfaceKey),
    patch: { nodes: [...nodes, ...middleNodes], edges: [...builder.all(), ...redeclared.values()], regions },
  }, "local", operationId);
  if (outcome.skippedRegionIds.length > 0) throw new Error(`${outcome.skippedRegionIds.length} faces recusadas pelo motor: ${outcome.skippedRegionReasons?.slice(0, 3).join("; ")}`);
  return { built: regions.length, refused: outcome.skippedRegionIds.length, unadopted: adoption.refused.length };
}

/** `ring` cut where it walks through one node twice: the loops it walks, three nodes or more each. */
function loopsOf(ring: readonly ConstructionNodeId[]): ConstructionNodeId[][] {
  const done: ConstructionNodeId[][] = [];
  const open = [[...ring]];
  while (open.length > 0) {
    const loop = open.pop()!;
    const i = loop.findIndex((id, k) => loop.indexOf(id, k + 1) >= 0);
    if (i < 0) {
      if (loop.length >= 3) done.push(loop);
      continue;
    }
    const j = loop.indexOf(loop[i]!, i + 1);
    open.push(loop.slice(i, j), [...loop.slice(j), ...loop.slice(0, i)]);
  }
  return done;
}

/** Faces as indexed rings, each list with its own vertices, and the node each vertex is. */
export function indexedFaces(faces: readonly ConstructionRegionTopology[]): {
  readonly ids: readonly ConstructionNodeId[];
  readonly vertices: readonly (readonly [number, number, number])[];
  readonly faces: readonly (readonly number[])[];
} {
  const index = new Map<ConstructionNodeId, number>();
  const ids: ConstructionNodeId[] = [];
  const vertices: [number, number, number][] = [];
  // In the order of their keys, never the order the session happened to hand
  // them over in: the engines number corners as they meet them, and the same
  // ground has to be the same request every time.
  const ordered = [...faces].sort((a, b) => {
    const ka = a.surfaceKey.join("\u0000"), kb = b.surfaceKey.join("\u0000");
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  const rings = ordered.map((face) => {
    const at = new Map(face.nodes.map((node) => [node.id, node.position]));
    return (face.outerLoops[0] ?? []).map((use) => {
      let i = index.get(use.startNodeId);
      if (i === undefined) {
        const p = at.get(use.startNodeId)!;
        i = vertices.length;
        index.set(use.startNodeId, i);
        ids.push(use.startNodeId);
        vertices.push([p.x, p.y, p.z]);
      }
      return i;
    });
  });
  return { ids, vertices, faces: rings };
}
