import type { ConstructionNodeId, ConstructionPosition, ConstructionRegionEdge, ConstructionRegionTopology, ConstructionTopologyBoundsQuery } from "@/ports";
import type { PlanarArea, PlanarPolygon } from "@/features/edit-construction";
import {
  faceRings,
  GROUND_CONTACT_CELL,
  GROUND_CONTACT_CLEARANCE,
  GROUND_SIDE_REST_ROOM,
  groundContactOf,
  groundSurfaceOf,
  insideRing,
  isGroundType,
  nearestOnSegment,
  planarDifference,
  planarUnion,
  resolveCreationInteraction,
  structureTypeFor,
  surfaceHeightOf,
} from "../../../features/edit-construction/index.ts";

import { anchoredConstraints } from "./constraint-rings.ts";
import type { ConstraintTable } from "./terrain-constraints.ts";
import type { TerrainCutRuntime } from "./terrain-neighborhood.ts";
import { paintedFalloutOf } from "../interference/painted-topologies.ts";
import { timePhase } from "../commit-timing.ts";

/**
 * How the ground laid again in a repair meets the structures standing in it
 * -- every one that cuts the ground there, not only the one that changed, so
 * the ground laid round one never runs over another standing beside it.
 *
 * - **Where:** the part of each face resting on the ground
 *   (`topology/ground-contact.ts`), which the ground goes round; the ground
 *   runs on under the rest.
 * - **At which nodes:** a structure's corners the ground may take as its own
 *   -- those resting on it; a sealed structure only where another holds the
 *   node too -- and the sides it may split.
 * - **At what height:** a ground corner on a sealed structure's side takes the
 *   side's height; one on the line the cut ends at under a structure lies on
 *   its underside.
 *
 * Nothing here asks what any structure is: whether it cuts is its type's
 * declared interaction with the ground, whether it is sealed its declared
 * capability.
 */
export interface StructureMeeting {
  /** Where the structures rest on the ground: the area the ground goes round. */
  readonly area: PlanarArea;
  /** The structures, as the fill reads back which edges already have a face on them. */
  readonly seeds: readonly { readonly seed: readonly string[]; readonly surfaceType: string }[];
  /** Whether a node is a structure's -- never a height the ground should take. */
  holds(nodeId: ConstructionNodeId): boolean;
  /**
   * The structures' outlines as constraint rings, numbered after
   * `numberedBefore` -- the nodes another table already numbered from 0. A
   * node among them keeps its number, so the ground's own rim and a structure
   * it shares a corner with name that corner once: numbered twice, two ring
   * corners stand on one spot and the generator refuses the whole ring.
   */
  constraints(numberedBefore: readonly ConstructionNodeId[]): ConstraintTable;
  /** Whether a point lies on a structure's side: where the ground meets it, never snapped away from it. */
  liesOnSide(point: { readonly x: number; readonly z: number }): boolean;
  /**
   * Whether a point lies under a structure in plan -- resting on the ground or
   * standing clear of it. Ground there is either cut or passes under, and a
   * repair widening itself for room never takes it in.
   */
  standsUnder(point: { readonly x: number; readonly z: number }): boolean;
  /** The height the ground must take at a point meeting a structure -- on a sealed side, or on the cut line under a face -- if it meets one. */
  heightAt(point: { readonly x: number; readonly z: number }): number | undefined;
}

/** No structure in the ground: nothing to go round, nothing to meet. */
export const NO_STRUCTURES: StructureMeeting = Object.freeze({
  area: [],
  seeds: [],
  holds: () => false,
  constraints: () => ({ rings: [], sources: [] }),
  liesOnSide: () => false,
  standsUnder: () => false,
  heightAt: () => undefined,
});

type Side = { readonly a: ConstructionPosition; readonly b: ConstructionPosition };

/** How near a point must lie to a line to lie on it. */
const ON = 1e-3;

function polygonOf(topology: ConstructionRegionTopology, positionOf: ReadonlyMap<ConstructionNodeId, { readonly x: number; readonly z: number }>): PlanarPolygon {
  const ringOf = (loop: readonly ConstructionRegionEdge[]) => {
    const ring = loop.map((use) => positionOf.get(use.startNodeId)).filter((p): p is { x: number; z: number } => p !== undefined).map((p) => [p.x, p.z] as [number, number]);
    return ring.length >= 3 ? [...ring, ring[0]!] : undefined;
  };
  const outer = topology.outerLoops[0] && ringOf(topology.outerLoops[0]);
  if (!outer) return [];
  return [outer, ...topology.holes.map(ringOf).filter((ring): ring is [number, number][] => ring !== undefined)];
}

/**
 * The structures standing in the ground within `bounds`, and how the ground
 * about to be laid there meets them. `terrainStanding` is the ground around,
 * read for the ground's own height.
 */
export function meetStructures(
  runtime: TerrainCutRuntime,
  bounds: ConstructionTopologyBoundsQuery,
  groundType: string,
  terrainStanding: readonly ConstructionRegionTopology[],
): StructureMeeting {
  const standingHere = timePhase("estruturas no lugar", () => runtime.getRegionTopologiesInBounds(bounds));
  const structures = standingHere.filter((topology) => !isGroundType(topology.surfaceType));
  const cutting = structures.filter((topology) => resolveCreationInteraction(topology.surfaceType, groundType).kind === "cut");
  const positions = new Map<ConstructionNodeId, { x: number; z: number }>();
  for (const topology of cutting) for (const node of topology.nodes) positions.set(node.id, { x: node.position.x, z: node.position.z });

  // Which types hold each node: a node another type holds too is a join -- a
  // ramp's end welded into a floor -- and the side between two of them has
  // that structure on its far side, so no ground fits under it.
  const holders = new Map<ConstructionNodeId, Set<string>>();
  for (const topology of structures) {
    for (const node of topology.nodes) {
      const types = holders.get(node.id) ?? new Set<string>();
      types.add(topology.surfaceType);
      holders.set(node.id, types);
    }
  }
  const heldByOthers = new Map<string, ReadonlySet<ConstructionNodeId>>();
  const heldFor = (surfaceType: string): ReadonlySet<ConstructionNodeId> => {
    let held = heldByOthers.get(surfaceType);
    if (held === undefined) {
      held = new Set([...holders].filter(([, types]) => [...types].some((type) => type !== surfaceType)).map(([id]) => id));
      heldByOthers.set(surfaceType, held);
    }
    return held;
  };

  // **The area they occupy is a union of their faces, never their perimeter
  // rings** -- a perimeter walk cannot tell a gap inside a road from its
  // outside, and would carve the gap out of the ground too -- and **only
  // where each rests on the ground**, read from the ground alone, never from
  // the structures' nodes it shares.
  const groundAt = groundSurfaceOf(terrainStanding, new Set(positions.keys()));
  // A structure standing clear of the ground all over is no business of the
  // ground's: nothing is cut round it, its outline is no line the ground meets.
  const meeting: ConstructionRegionTopology[] = [];
  const pieces = cutting.flatMap((topology): (PlanarPolygon | PlanarArea)[] => {
    const polygon = polygonOf(topology, positions);
    if (polygon.length === 0) return [];
    const contact = groundContactOf(topology, groundAt, GROUND_CONTACT_CELL, GROUND_CONTACT_CLEARANCE, heldFor(topology.surfaceType));
    if (contact.kind === "none") return [];
    meeting.push(topology);
    if (contact.kind === "whole") return [polygon];
    try {
      const clear = planarUnion(runtime, [contact.clear[0]!.map(([x, z]) => [x, z] as [number, number])], ...contact.clear.slice(1).map((cell) => [cell.map(([x, z]) => [x, z] as [number, number])]));
      return [planarDifference(runtime, polygon, clear)];
    } catch {
      return [polygon];
    }
  }).filter((piece) => piece.length > 0);
  let area: PlanarArea = [];
  if (pieces.length > 0) {
    try {
      area = timePhase(`união das estruturas (${pieces.length} faces)`, () => planarUnion(runtime, pieces[0]!, ...pieces.slice(1)));
    } catch {
      area = [];
    }
  }

  // Their outlines, for identity: what the subtraction's bare-float output is
  // matched back against, so the ground comes back meeting each structure at
  // its actual nodes and edges -- except a sealed one, met only at the nodes
  // it holds with another.
  const byType = new Map<string, ConstructionRegionTopology[]>();
  for (const topology of meeting) byType.set(topology.surfaceType, [...(byType.get(topology.surfaceType) ?? []), topology]);
  const sharedLoops: (readonly ConstructionRegionEdge[])[] = [];
  const sealedLoops: (readonly ConstructionRegionEdge[])[] = [];
  const sealedHeld = new Set<ConstructionNodeId>();
  const sides: Side[] = [];
  const sealedSides: Side[] = [];
  for (const [surfaceType, faces] of byType) {
    const { paintedLoops } = timePhase("perímetro das estruturas", () => paintedFalloutOf(faces));
    const sealed = structureTypeFor(surfaceType)?.sealedOutline === true;
    // The ground meets a sealed structure along its outline: the sides one of
    // its faces holds alone. A side two of its faces share is inside it --
    // the arch over a tunnel's mouth stands right above the floor the ground
    // meets there, and read as a side it gave the ground the arch's height.
    const uses = new Map<string, number>();
    for (const topology of faces) for (const use of [...topology.outerLoops, ...topology.holes].flat()) uses.set(use.edgeId, (uses.get(use.edgeId) ?? 0) + 1);
    for (const topology of faces) {
      const at = new Map(topology.nodes.map((node) => [node.id, node.position]));
      for (const use of [...topology.outerLoops, ...topology.holes].flat()) {
        const side = { a: at.get(use.startNodeId)!, b: at.get(use.endNodeId)! };
        sides.push(side);
        if (sealed && uses.get(use.edgeId) === 1) sealedSides.push(side);
      }
    }
    if (!sealed) {
      sharedLoops.push(...paintedLoops);
      continue;
    }
    sealedLoops.push(...paintedLoops);
    for (const id of heldFor(surfaceType)) if (faces.some((face) => face.nodes.some((node) => node.id === id))) sealedHeld.add(id);
  }

  // The nodes the ground may take as its own corners: those resting on it, and
  // those another structure holds too. A node standing clear of the ground --
  // a floor's corner moved out over a valley -- is no corner of the ground's,
  // however near it is in plan.
  const resting = new Set<ConstructionNodeId>();
  for (const topology of cutting) {
    for (const node of topology.nodes) {
      const ground = groundAt(node.position);
      if (ground !== undefined && node.position.y <= ground + GROUND_CONTACT_CLEARANCE + GROUND_SIDE_REST_ROOM) resting.add(node.id);
    }
    for (const id of heldFor(topology.surfaceType)) if (topology.nodes.some((node) => node.id === id)) resting.add(id);
  }

  // The faces' own surfaces, for the line the cut ends at under one.
  const undersides = cutting.flatMap((topology) => {
    const surfaceAt = surfaceHeightOf(topology);
    const ring = faceRings(topology)[0] ?? [];
    return surfaceAt && ring.length >= 3 ? [{ ring, surfaceAt }] : [];
  });
  // Every structure's plan, cutting or not, resting or clear.
  const footprints = structures.flatMap((topology) => {
    const [ring, ...holes] = faceRings(topology);
    return ring !== undefined && ring.length >= 3 ? [{ ring, holes }] : [];
  });
  const cutLine = area.flatMap((piece) => piece.flatMap((ring) => ring.slice(0, -1).map((a, index) => [{ x: a[0], z: a[1] }, { x: ring[index + 1]![0], z: ring[index + 1]![1] }] as const)));

  return {
    area,
    seeds: cutting.map((topology) => ({ seed: topology.surfaceKey, surfaceType: topology.surfaceType })),
    holds: (nodeId) => positions.has(nodeId),
    constraints(numberedBefore) {
      const shared = anchoredConstraints(sharedLoops, positions, 0, resting, numberedBefore, true);
      const sealed = anchoredConstraints(sealedLoops, positions, 0, sealedHeld, [...numberedBefore, ...shared.sources]);
      return { rings: [...shared.rings, ...sealed.rings], sources: [...shared.sources, ...sealed.sources] };
    },
    liesOnSide: (point) => sides.some(({ a, b }) => nearestOnSegment(point, a, b).distance < ON),
    standsUnder: (point) => footprints.some(({ ring, holes }) => insideRing(ring, point) && !holes.some((hole) => insideRing(hole, point))),
    heightAt(point) {
      // On a sealed side resting on the ground: the side's height. Over the
      // ground, clear of it, the ground passes under at its own height; the
      // point where resting gives way is on the line itself, so it has room.
      for (const { a, b } of sealedSides) {
        const nearest = nearestOnSegment(point, a, b);
        if (nearest.distance >= ON) continue;
        const y = a.y + (b.y - a.y) * nearest.t;
        const ground = groundAt(point);
        if (ground === undefined || y <= ground + GROUND_CONTACT_CLEARANCE + GROUND_SIDE_REST_ROOM) return y;
      }
      // On the line the cut ends at under a face: on the face's underside.
      if (undersides.length === 0 || !cutLine.some(([a, b]) => nearestOnSegment(point, a, b).distance < ON)) return undefined;
      const under = undersides.find(({ ring }) => insideRing(ring, point) || ring.some((a, index) => nearestOnSegment(point, a, ring[(index + 1) % ring.length]!).distance < ON));
      return under?.surfaceAt(point);
    },
  };
}
