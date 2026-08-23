import type {
  ConstructionPosition,
  ConstructionRegionTopology,
  ConstructionSurfaceKey,
} from "@/ports";

import type { CloudTopology } from "./construction-cloud.ts";
import { pathSubtypeOf } from "./path-corridor.ts";
import { parseStationNodeId } from "./station-node-id.ts";
import type { PathKind } from "./tool-types.ts";

/**
 * One committed run of path, read back as the three parts it is built from:
 * the spine, the outer contour running parallel to it, and the rib linking
 * them.
 *
 * **A run is not a cloud.** `ADR-0022`'s cloud is the connected component of
 * one surface type, so two roads that meet are one cloud with two runs in it
 * -- which is exactly what a junction is. The cloud stays the unit editing
 * dispatches on; a run is what that unit is *made of*, and the pair is read
 * through `pathRunsOf`.
 *
 * **Derived, never stored.** Every fact here is already in the graph -- the
 * spine is the chain at slot 0, a contour is a chain at an extreme slot, a
 * rib is the transverse run of one station -- and keeping a second copy
 * alongside would only give the two something to disagree about. The whole
 * point of putting the travel line in the graph as a real seam was that it
 * stops being a number some generator remembered.
 *
 * This is what junction work reads: to cut two contours against each other
 * and relink them, you first have to be able to *name* a contour, which
 * scanning for the largest `|across|` on demand does not give you.
 */

/** One node of a run, with the address its id carries. */
export interface PathRunNode {
  readonly nodeId: string;
  readonly station: number;
  /** Signed slot across the cross-section; `0` is the spine. */
  readonly across: number;
  readonly position: ConstructionPosition;
}

/** A chain running **along** the run: the spine, or one side of the contour. */
export interface PathRunChain {
  readonly across: number;
  /** Ordered by station. */
  readonly nodes: readonly PathRunNode[];
  /** The edge between consecutive nodes; one shorter than `nodes`. */
  readonly edgeIds: readonly string[];
}

/** A chain running **across** the run: one station, contour to contour. */
export interface PathRunRib {
  readonly station: number;
  /** Ordered by `across`, so from one contour through the spine to the other. */
  readonly nodes: readonly PathRunNode[];
  readonly edgeIds: readonly string[];
  /** The faces this rib bounds. */
  readonly bands: readonly ConstructionSurfaceKey[];
}

export interface PathRun {
  readonly corridorId: string;
  readonly subtype: PathKind | undefined;
  readonly spine: PathRunChain | undefined;
  /** One per side, outermost slot first. */
  readonly contours: readonly PathRunChain[];
  readonly ribs: readonly PathRunRib[];
  readonly bands: readonly ConstructionSurfaceKey[];
  /**
   * Stations whose spine node belongs to a **different** corridor -- this run
   * welded onto one already standing there. A junction, seen from this side.
   */
  readonly junctionStations: readonly number[];
}

interface EdgeEnds {
  readonly startNodeId: string;
  readonly endNodeId: string;
}

function edgesOf(topologies: readonly ConstructionRegionTopology[]): ReadonlyMap<string, EdgeEnds> {
  const edges = new Map<string, EdgeEnds>();
  for (const topology of topologies) {
    for (const loop of [...topology.outerLoops, ...topology.holes]) {
      for (const use of loop) {
        if (edges.has(use.edgeId)) continue;
        edges.set(use.edgeId, { startNodeId: use.startNodeId, endNodeId: use.endNodeId });
      }
    }
  }
  return edges;
}

/** The edge joining exactly these two nodes, in either direction. */
function edgeBetween(
  edges: ReadonlyMap<string, EdgeEnds>,
  left: string,
  right: string,
): string | undefined {
  for (const [edgeId, ends] of edges) {
    if (
      (ends.startNodeId === left && ends.endNodeId === right) ||
      (ends.startNodeId === right && ends.endNodeId === left)
    ) {
      return edgeId;
    }
  }
  return undefined;
}

function chainAt(
  across: number,
  byStation: ReadonlyMap<number, ReadonlyMap<number, PathRunNode>>,
  stations: readonly number[],
  edges: ReadonlyMap<string, EdgeEnds>,
): PathRunChain | undefined {
  const nodes = stations
    .map((station) => byStation.get(station)?.get(across))
    .filter((node): node is PathRunNode => node !== undefined);
  if (nodes.length === 0) return undefined;
  const edgeIds: string[] = [];
  for (let index = 0; index + 1 < nodes.length; index += 1) {
    const edgeId = edgeBetween(edges, nodes[index]!.nodeId, nodes[index + 1]!.nodeId);
    if (edgeId !== undefined) edgeIds.push(edgeId);
  }
  return { across, nodes, edgeIds };
}

/**
 * The node a welded station shares with the run it joined: not this
 * corridor's own, so it is found by what it connects to rather than by its
 * id -- the one node adjacent to both of this station's inner nodes.
 */
function weldedSpineAt(
  inner: readonly PathRunNode[],
  edges: ReadonlyMap<string, EdgeEnds>,
  ownIds: ReadonlySet<string>,
): string | undefined {
  const left = inner.find((node) => node.across < 0);
  const right = inner.find((node) => node.across > 0);
  if (left === undefined || right === undefined) return undefined;
  const neighbours = (nodeId: string): Set<string> => {
    const found = new Set<string>();
    for (const ends of edges.values()) {
      if (ends.startNodeId === nodeId) found.add(ends.endNodeId);
      if (ends.endNodeId === nodeId) found.add(ends.startNodeId);
    }
    return found;
  };
  const shared = neighbours(left.nodeId);
  for (const candidate of neighbours(right.nodeId)) {
    if (shared.has(candidate) && !ownIds.has(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Every path run present in `topologies`, one per corridor.
 *
 * Takes a plain set of boundaries rather than a cloud, because the caller
 * that needs *every* standing run -- crossing detection, which is looking
 * for runs it is not yet connected to -- is by definition looking outside
 * any one cloud.
 */
export function pathRunsIn(
  topologies: readonly ConstructionRegionTopology[],
): readonly PathRun[] {
  const edges = edgesOf(topologies);
  /** Every node position on the table, so an adopted junction node can be placed. */
  const nodePositions = new Map<string, ConstructionPosition>();
  for (const topology of topologies) {
    for (const node of topology.nodes) nodePositions.set(node.id, node.position);
  }
  const byCorridor = new Map<string, Map<number, Map<number, PathRunNode>>>();
  const bandsByCorridor = new Map<string, ConstructionSurfaceKey[]>();

  for (const topology of topologies) {
    const corridors = new Set<string>();
    for (const node of topology.nodes) {
      const address = parseStationNodeId(node.id);
      if (address === undefined) continue;
      corridors.add(address.operationId);
      const stations = byCorridor.get(address.operationId) ?? new Map();
      byCorridor.set(address.operationId, stations);
      const slots = stations.get(address.station) ?? new Map();
      stations.set(address.station, slots);
      slots.set(address.across, {
        nodeId: node.id,
        station: address.station,
        across: address.across,
        position: node.position,
      });
    }
    // A band belongs to the corridor that minted most of its nodes, which for
    // a run's own face is all of them, and for a welded face is still the
    // side that declared it.
    let owner: string | undefined;
    let best = 0;
    for (const corridor of corridors) {
      const count = topology.nodes.filter(
        (node) => parseStationNodeId(node.id)?.operationId === corridor,
      ).length;
      if (count > best) {
        best = count;
        owner = corridor;
      }
    }
    if (owner === undefined) continue;
    const bands = bandsByCorridor.get(owner) ?? [];
    bandsByCorridor.set(owner, bands);
    bands.push(topology.surfaceKey);
  }

  return [...byCorridor].map(([corridorId, byStation]) => {
    const stations = [...byStation.keys()].sort((left, right) => left - right);
    const slots = new Set<number>();
    for (const perStation of byStation.values()) {
      for (const across of perStation.keys()) slots.add(across);
    }
    const ordered = [...slots].sort((left, right) => left - right);
    const outermost = ordered.filter(
      (across) => across === ordered[0] || across === ordered[ordered.length - 1],
    );
    const ownIds = new Set<string>();
    for (const perStation of byStation.values()) {
      for (const node of perStation.values()) ownIds.add(node.nodeId);
    }

    // A junction node belongs to the run that was crossed, so this run has no
    // node of its own at that station -- but the node is still *on* this run's
    // travel line, and leaving it out breaks the chain exactly where the two
    // runs meet. Read as a gap it looks like no junction happened at all,
    // which is the opposite of the truth. Adopted into the chain here, so both
    // runs report the shared node and are visibly joined at it.
    const junctionStations: number[] = [];
    for (const station of stations) {
      const perStation = byStation.get(station)!;
      if (perStation.has(0)) continue;
      const across = [...perStation.values()].sort((left, right) => left.across - right.across);
      const welded = weldedSpineAt(across, edges, ownIds);
      const position = welded === undefined ? undefined : nodePositions.get(welded);
      if (welded === undefined || position === undefined) continue;
      junctionStations.push(station);
      (perStation as Map<number, PathRunNode>).set(0, {
        nodeId: welded,
        station,
        across: 0,
        position,
      });
    }

    const ribs: PathRunRib[] = stations.map((station) => {
      const perStation = byStation.get(station)!;
      const nodes = [...perStation.values()].sort((left, right) => left.across - right.across);
      const edgeIds: string[] = [];
      for (let index = 0; index + 1 < nodes.length; index += 1) {
        const edgeId = edgeBetween(edges, nodes[index]!.nodeId, nodes[index + 1]!.nodeId);
        if (edgeId !== undefined) edgeIds.push(edgeId);
      }
      const bands = (bandsByCorridor.get(corridorId) ?? []).filter((key) => {
        const topology = topologies.find(
          (candidate) => candidate.surfaceKey.join(":") === key.join(":"),
        );
        return topology?.nodes.some((node) => nodes.some((rib) => rib.nodeId === node.id)) ?? false;
      });
      return { station, nodes, edgeIds, bands };
    });

    return {
      corridorId,
      subtype: pathSubtypeOf(corridorId),
      spine: chainAt(0, byStation, stations, edges),
      contours: outermost
        .map((across) => chainAt(across, byStation, stations, edges))
        .filter((chain): chain is PathRunChain => chain !== undefined),
      ribs,
      bands: bandsByCorridor.get(corridorId) ?? [],
      junctionStations,
    };
  });
}

/**
 * The runs inside one cloud -- the cloud-owned view, and the one a tool
 * should reach for.
 *
 * Editing dispatches by cloud, so anything asking "what is this road made
 * of" is asking about the cloud under the pointer, not about a face and not
 * about the whole table.
 */
export function pathRunsOf(cloud: CloudTopology): readonly PathRun[] {
  return pathRunsIn(cloud.members);
}

/** One run by its corridor id, or `undefined` if nothing present is from it. */
export function pathRunFor(
  topologies: readonly ConstructionRegionTopology[],
  corridorId: string,
): PathRun | undefined {
  return pathRunsIn(topologies).find((run) => run.corridorId === corridorId);
}
