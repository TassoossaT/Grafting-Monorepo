import type { PathBrushEffect } from "../../modes/surface-edit-contract.ts";
import type {
  ApplyPatchReplacementRequest,
  ConstructionCoveredRegion,
  ConstructionGraphPatch,
  ConstructionGraphSnapshot,
  ConstructionPosition,
  ConstructionRegionTopology,
} from "@/ports";

// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time. A type-only
// `@/` import is fine -- those are erased.
import {
  firstRefusal,
  resolveCoverage,
  resolveCutRepair,
} from "../index.ts";
import { chainsOf, parseSpineControlNodeId, spineControlNodeId, spineGraphFromSnapshot } from "./spine-graph/index.ts";
import { pathRidesTerrain } from "./path-recipe.ts";
import { pathSpineDraftFor } from "./path-spine-draft.ts";

import { fitPath, type FittedEdge } from "../../topology/index.ts";
import {
  offsetBands,
  planSpineContour,
  sampleCatmullRom,
  unionBandLayer,
  type SpineChainInput,
} from "./contour/index.ts";

/**
 * How finely the committed curve follows the true Catmull-Rom shape, in
 * world units (XZ). The spine's own control points stay few -- `groundTrack`
 * keeps one per real corner, never one per flattening step -- and this is
 * what turns that handful of points into a smooth curve for the contour
 * union and the footprint/coverage outline, the same Catmull-Rom-through-
 * few-anchors model this whole spine is styled on (no attempt to prove any
 * one span is a literal circle; a smooth spline through the right corners
 * already looks right).
 */
const CURVE_FLATTENING_TOLERANCE = 0.05;

interface MaterializedSpine {
  readonly graphPatch: ConstructionGraphPatch;
  readonly controlPoints: readonly ConstructionPosition[];
}

interface SpineEdgeCandidate {
  readonly edge: ConstructionGraphPatch["edges"][number];
  readonly from: ConstructionPosition & { readonly id: string };
  readonly to: ConstructionPosition & { readonly id: string };
}

interface SpineEdgeCut {
  readonly nodeId: string;
  readonly position: ConstructionPosition;
  readonly t: number;
}

interface SpineIntersection {
  readonly t: number;
  readonly u: number;
}

const SPINE_INTERSECTION_EPSILON = 1e-6;

/** The proper crossing of two XZ line segments, with both segment parameters. */
function segmentIntersection(
  from: ConstructionPosition,
  to: ConstructionPosition,
  otherFrom: ConstructionPosition,
  otherTo: ConstructionPosition,
): SpineIntersection | undefined {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const otherDx = otherTo.x - otherFrom.x;
  const otherDz = otherTo.z - otherFrom.z;
  const determinant = dx * otherDz - dz * otherDx;
  if (Math.abs(determinant) < SPINE_INTERSECTION_EPSILON) return undefined;
  const betweenX = otherFrom.x - from.x;
  const betweenZ = otherFrom.z - from.z;
  const t = (betweenX * otherDz - betweenZ * otherDx) / determinant;
  const u = (betweenX * dz - betweenZ * dx) / determinant;
  if (
    t <= SPINE_INTERSECTION_EPSILON ||
    t >= 1 - SPINE_INTERSECTION_EPSILON ||
    u < -SPINE_INTERSECTION_EPSILON ||
    u > 1 + SPINE_INTERSECTION_EPSILON
  ) {
    return undefined;
  }
  return { t, u: Math.max(0, Math.min(1, u)) };
}

/** Materializes and locally snaps the type-owned spine against its own network. */
function graphPatchForSpine(
  snapshot: ConstructionGraphSnapshot,
  spine: NonNullable<ReturnType<typeof pathSpineDraftFor>>,
  snapTolerance: number,
): MaterializedSpine {
  const spineNodes = snapshot.nodes.filter((node) => node.id.startsWith("spine:"));
  const nearest = (point: ConstructionPosition) => spineNodes
    .map((node) => ({ node, distance: Math.hypot(node.position.x - point.x, node.position.z - point.z) }))
    .filter((candidate) => candidate.distance <= snapTolerance)
    .sort((left, right) => left.distance - right.distance)[0]?.node;
  const nodeById = new Map(spineNodes.map((node) => [node.id, node]));
  const edges = snapshot.edges
    .flatMap((edge): SpineEdgeCandidate[] => {
      const from = nodeById.get(edge.startNodeId);
      const to = nodeById.get(edge.endNodeId);
      return from === undefined || to === undefined ? [] : [{ edge, from: { ...from.position, id: from.id }, to: { ...to.position, id: to.id } }];
    });
  const nearestEdge = (point: ConstructionPosition) => edges
    .map((candidate) => {
      const dx = candidate.to.x - candidate.from.x;
      const dz = candidate.to.z - candidate.from.z;
      const lengthSquared = dx * dx + dz * dz;
      const t = lengthSquared < 1e-9 ? 0 : Math.max(0, Math.min(1, ((point.x - candidate.from.x) * dx + (point.z - candidate.from.z) * dz) / lengthSquared));
      return {
        ...candidate,
        t,
        position: {
          x: candidate.from.x + dx * t,
          y: candidate.from.y + (candidate.to.y - candidate.from.y) * t,
          z: candidate.from.z + dz * t,
        },
        distance: Math.hypot(point.x - (candidate.from.x + dx * t), point.z - (candidate.from.z + dz * t)),
      };
    })
    .filter((candidate) => candidate.distance <= snapTolerance)
    .sort((left, right) => left.distance - right.distance)[0];
  const cutsByEdge = new Map<string, SpineEdgeCut[]>();
  const cutsByPosition: SpineEdgeCut[] = [];
  let nextMintedIndex = spine.controlPoints.length;
  const mint = (): string => spineControlNodeId(spine.corridorId, nextMintedIndex++);
  const samePosition = (left: ConstructionPosition, right: ConstructionPosition): boolean =>
    Math.hypot(left.x - right.x, left.z - right.z) <= SPINE_INTERSECTION_EPSILON;
  const cutFor = (candidate: SpineEdgeCandidate, position: ConstructionPosition, t: number): SpineEdgeCut => {
    if (t <= SPINE_INTERSECTION_EPSILON) return { nodeId: candidate.from.id, position: candidate.from, t: 0 };
    if (t >= 1 - SPINE_INTERSECTION_EPSILON) return { nodeId: candidate.to.id, position: candidate.to, t: 1 };
    const existing = cutsByPosition.find((cut) => samePosition(cut.position, position));
    const cut = { nodeId: existing?.nodeId ?? mint(), position: existing?.position ?? position, t };
    if (existing === undefined) cutsByPosition.push(cut);
    const edgeCuts = cutsByEdge.get(candidate.edge.edgeId) ?? [];
    if (!edgeCuts.some((other) => other.nodeId === cut.nodeId)) {
      cutsByEdge.set(candidate.edge.edgeId, [...edgeCuts, cut]);
    }
    return cut;
  };
  const resolved = spine.controlPoints.map((point, index) => {
    const minted = spineControlNodeId(spine.corridorId, index);
    const node = nearest(point);
    if (node !== undefined) {
      return { nodeId: node.id, position: node.position };
    }
    const edge = nearestEdge(point);
    if (edge === undefined) {
      return { nodeId: minted, position: point };
    }
    const cut = cutFor(edge, edge.position, edge.t);
    return { nodeId: cut.nodeId, position: cut.position };
  });

  const expanded = resolved.flatMap((point, index) => {
    if (index === 0) return [point];
    const previous = resolved[index - 1]!;
    const crossings = edges
      .flatMap((edge) => {
        const intersection = segmentIntersection(previous.position, point.position, edge.from, edge.to);
        if (intersection === undefined) return [];
        const position = {
          x: previous.position.x + (point.position.x - previous.position.x) * intersection.t,
          y: edge.from.y + (edge.to.y - edge.from.y) * intersection.u,
          z: previous.position.z + (point.position.z - previous.position.z) * intersection.t,
        };
        const cut = cutFor(edge, position, intersection.u);
        return [{ t: intersection.t, nodeId: cut.nodeId, position: cut.position }];
      })
      .sort((left, right) => left.t - right.t)
      .filter((crossing, crossingIndex, all) => crossingIndex === 0 || crossing.nodeId !== all[crossingIndex - 1]!.nodeId);
    return [...crossings, point];
  });

  const splitEdges = [...cutsByEdge.entries()].flatMap(([edgeId, cuts]) => {
    const edge = edges.find((candidate) => candidate.edge.edgeId === edgeId)!;
    const nodes = [
      { nodeId: edge.from.id, position: edge.from, t: 0 },
      ...cuts.sort((left, right) => left.t - right.t),
      { nodeId: edge.to.id, position: edge.to, t: 1 },
    ];
    return nodes.slice(0, -1).flatMap((from, index) => {
      const to = nodes[index + 1]!;
      return from.nodeId === to.nodeId
        ? []
        : [{ edgeId: `spine-split:${edgeId}:${index}`, startNodeId: from.nodeId, endNodeId: to.nodeId }];
    });
  });
  const nodes = new Map(expanded.map((point) => [point.nodeId, point.position]));
  return {
    controlPoints: expanded.map((point) => point.position),
    graphPatch: {
      nodes: [...nodes].map(([id, position]) => ({ id, position })),
      removedEdgeIds: [...cutsByEdge.keys()],
      edges: [
        ...expanded.slice(0, -1).map((from, index) => ({
          edgeId: `spine-edge:${spine.corridorId}:${index}`,
          startNodeId: from.nodeId,
          endNodeId: expanded[index + 1]!.nodeId,
        })).filter((edge) => edge.startNodeId !== edge.endNodeId),
        ...splitEdges,
      ],
    },
  };
}

/** The connected spine component changed by this stroke, after its graph patch, and every node id in it. */
interface ChangedSpineCloud {
  readonly chains: readonly (readonly ConstructionPosition[])[];
  /**
   * Every spine control point position in the touched component -- used to
   * decide which standing contour faces this edit replaces.
   */
  readonly positions: readonly ConstructionPosition[];
  /** Every corridor/operation id participating in this connected spine cluster. */
  readonly corridorIds: ReadonlySet<string>;
}

function changedSpineCloud(snapshot: ConstructionGraphSnapshot, patch: ConstructionGraphPatch): ChangedSpineCloud {
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  for (const node of patch.nodes) nodes.set(node.id, node);
  const edges = new Map(snapshot.edges.map((edge) => [edge.edgeId, edge]));
  for (const edgeId of patch.removedEdgeIds ?? []) edges.delete(edgeId);
  for (const edge of patch.edges) edges.set(edge.edgeId, edge);
  const graph = spineGraphFromSnapshot({ nodes: [...nodes.values()], edges: [...edges.values()] });
  const adjacent = new Map<string, string[]>();
  for (const edge of graph.edges) {
    adjacent.set(edge.fromNodeId, [...(adjacent.get(edge.fromNodeId) ?? []), edge.toNodeId]);
    adjacent.set(edge.toNodeId, [...(adjacent.get(edge.toNodeId) ?? []), edge.fromNodeId]);
  }
  const connected = new Set(patch.nodes.map((node) => node.id));
  const pending = [...connected];
  while (pending.length > 0) {
    const nodeId = pending.pop()!;
    for (const neighbor of adjacent.get(nodeId) ?? []) {
      if (connected.has(neighbor)) continue;
      connected.add(neighbor);
      pending.push(neighbor);
    }
  }
  const clusterNodes = graph.nodes.filter((node) => connected.has(node.nodeId));
  const chains = chainsOf({
    nodes: clusterNodes,
    edges: graph.edges.filter((edge) => connected.has(edge.fromNodeId) && connected.has(edge.toNodeId)),
  }).map((chain) => chain.nodes.map((node) => node.position));

  const corridorIds = new Set<string>();
  for (const node of clusterNodes) {
    const address = parseSpineControlNodeId(node.nodeId);
    if (address !== undefined) {
      corridorIds.add(address.operationId);
      const at = address.operationId.lastIndexOf("#");
      if (at >= 0) corridorIds.add(address.operationId.slice(0, at));
    }
  }

  return { chains, positions: clusterNodes.map((node) => node.position), corridorIds };
}

/**
 * Every standing "path" face that belongs to the touched spine cloud.
 * Matched by corridor/operation identity first, node identity second, and
 * geometric proximity as a fallback.
 */
function standingRegionsForCloud(
  topologies: readonly ConstructionRegionTopology[],
  cloudPositions: readonly ConstructionPosition[],
  corridorIds: ReadonlySet<string> = new Set(),
): readonly ConstructionRegionTopology[] {
  if (corridorIds.size === 0) return [];
  return topologies.filter((topology) => {
    if (topology.surfaceType !== "path") return false;
    const regionId = topology.surfaceKey[1] ?? "";
    for (const corridorId of corridorIds) {
      if (
        regionId === corridorId ||
        regionId.startsWith(`${corridorId}:`) ||
        regionId.startsWith(`${corridorId}#`)
      ) {
        return true;
      }
    }
    for (const node of topology.nodes) {
      for (const corridorId of corridorIds) {
        if (
          node.id.startsWith(`contour:${corridorId}:`) ||
          node.id.startsWith(`contour:${corridorId}#`) ||
          node.id.startsWith(`along:${corridorId}:`) ||
          node.id.startsWith(`across:${corridorId}:`) ||
          node.id.startsWith(`${corridorId}:`)
        ) {
          return true;
        }
      }
    }
    return false;
  });
}

/**
 * How far the road may float above or below the ground before a station is
 * spent to bring it back down, in world units.
 *
 * A road rides the ground it was drawn over, and the only record of that
 * ground is the stroke itself -- every pointer sample carries the height the
 * renderer picked there. Fitting deliberately throws most of those samples
 * away, so a run over a hill would be left with height readings at its two
 * ends and a chord tunnelling through everything between.
 *
 * The answer used to be a station every two metres, everywhere. That buys a
 * hundred stations for a hundred-metre road across a car park, all of them
 * saying the same thing, and it is the wall pattern abandoned: a wall commits
 * the straightest thing that still fits, and so should this. A station now
 * has to earn its place by the ground under it actually differing from what
 * the stretch either side of it already says.
 */
const TERRAIN_HEIGHT_TOLERANCE = 0.15;

/** How finely the ground is read while deciding whether it needs a station. */
const TERRAIN_PROBE_STEP = 0.5;

/** The height the stroke recorded nearest this ground position. */
function groundHeightNear(
  stroke: readonly ConstructionPosition[],
  x: number,
  z: number,
): number {
  let closest: ConstructionPosition | undefined;
  let closestDistance = Infinity;
  for (const sample of stroke) {
    const distance = (sample.x - x) ** 2 + (sample.z - z) ** 2;
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = sample;
    }
  }
  return closest?.y ?? 0;
}

/** One point of the sampled track: where it sits, and whether the run genuinely turns there. */
interface TrackPoint {
  readonly x: number;
  readonly z: number;
  readonly corner: boolean;
}

/**
 * The fitted contour as ground positions -- one control point per fitted
 * corner. Kept few on purpose: `planSpineContour`'s own Catmull-Rom already
 * turns a handful of well-placed corners into a smooth curve (the same
 * few-anchors-plus-a-spline model a wall's own fit uses), so subdividing a
 * corner-to-corner run further here would only add points the curve never
 * needed.
 */
function groundTrack(fitted: readonly FittedEdge[]): readonly TrackPoint[] {
  const first = fitted[0];
  if (first === undefined) return [];
  const track: TrackPoint[] = [{ x: first.start.x, z: first.start.z, corner: true }];
  for (const edge of fitted) {
    track.push({ x: edge.end.x, z: edge.end.z, corner: true });
  }
  return track;
}

/**
 * The reference line to build the spine from: where the fit decided the
 * road goes, at the height the ground was actually picked at.
 *
 * These points become the spine's own Catmull-Rom control points --
 * `planSpineContour` samples a smooth curve through them, so a corner this
 * function keeps as one point still reads as a genuine bend, and a run of
 * points along a straight, flat stretch still flattens back to the straight
 * chord it was drawn as (`sampleCatmullRom`'s own collinear case).
 */
export function referenceLineFrom(
  fitted: readonly FittedEdge[],
  stroke: readonly ConstructionPosition[],
  ridesTerrain: boolean,
): { readonly line: readonly ConstructionPosition[] } {
  const track = groundTrack(fitted);
  const first = track[0];
  const last = track[track.length - 1];
  if (first === undefined || last === undefined) return { line: [] };

  // A deck spans: its height comes from its own two ends, so the middle stays
  // level instead of sagging onto whatever it crosses. Everything else reads
  // the ground the stroke was drawn over, station by station.
  const startY = groundHeightNear(stroke, first.x, first.z);
  const endY = groundHeightNear(stroke, last.x, last.z);
  let total = 0;
  for (let index = 0; index + 1 < track.length; index += 1) {
    total += Math.hypot(track[index + 1]!.x - track[index]!.x, track[index + 1]!.z - track[index]!.z);
  }
  let travelled = 0;
  const heightAt = (x: number, z: number): number => {
    if (ridesTerrain) return groundHeightNear(stroke, x, z);
    return total < 1e-6 ? startY : startY + (endY - startY) * (travelled / total);
  };

  // Walked as one continuous arc length rather than segment by segment.
  // Subdividing each fitted segment on its own recomputed the step from
  // scratch every time, so a 2.0 m segment got one station and a 2.1 m
  // segment got two -- neighbouring ribs differing by a factor of two, and
  // far worse beside the short segments a corner produces. The step is now
  // uniform along the whole run, and only a genuine corner interrupts it.
  const line: ConstructionPosition[] = [
    { x: first.x, y: heightAt(first.x, first.z), z: first.z },
  ];
  const push = (x: number, z: number): void => {
    const previous = line[line.length - 1]!;
    // Two stations at one spot would collapse into a zero-length curve
    // segment.
    if (Math.hypot(x - previous.x, z - previous.z) < 1e-4) return;
    line.push({ x, y: heightAt(x, z), z });
  };

  // Every point the fit itself produced is a control point: a corner because
  // the run genuinely turns there. What is *not* automatic any more is
  // anything between them. A stretch gets extra control points only where
  // the ground under it strays from the straight line the stretch would
  // otherwise be -- so a straight road over flat ground is two control
  // points, and a straight road over a ridge is exactly as many as the
  // ridge needs.
  for (let index = 0; index + 1 < track.length; index += 1) {
    const from = track[index]!;
    const to = track[index + 1]!;
    const span = Math.hypot(to.x - from.x, to.z - from.z);
    if (span < 1e-9) continue;

    if (ridesTerrain && span > TERRAIN_PROBE_STEP) {
      const anchor = line[line.length - 1]!;
      let anchored = travelled;
      let lastProbe = 0;
      for (let probe = TERRAIN_PROBE_STEP; probe < span; probe += TERRAIN_PROBE_STEP) {
        const ratio = probe / span;
        const x = from.x + (to.x - from.x) * ratio;
        const z = from.z + (to.z - from.z) * ratio;
        const ground = groundHeightNear(stroke, x, z);
        // What the road would be doing here if the last station were the
        // only thing holding it up.
        const reach = Math.hypot(x - anchor.x, z - anchor.z);
        const run = Math.hypot(to.x - anchor.x, to.z - anchor.z);
        const carried =
          run < 1e-9
            ? anchor.y
            : anchor.y + (groundHeightNear(stroke, to.x, to.z) - anchor.y) * (reach / run);
        if (Math.abs(ground - carried) <= TERRAIN_HEIGHT_TOLERANCE) continue;
        // It strays here, so the stretch buys a station at the last place it
        // did not -- the road stays on the ground either side of the fault
        // rather than being dragged through it.
        const backRatio = Math.max(lastProbe, 0) / span;
        travelled = anchored + span * backRatio;
        push(from.x + (to.x - from.x) * backRatio, from.z + (to.z - from.z) * backRatio);
        anchored = travelled;
        lastProbe = probe;
      }
    }

    travelled += span;
    push(to.x, to.z);
  }
  // The run has to end where it was drawn, corner or not.
  push(last.x, last.z);
  return { line };
}

/** The table facts supplied to the PathCloud before it plans a mutation. */
export interface PathCloudMutationInput {
  readonly tableId: string;
  readonly snapToGrid: boolean;
  readonly graphSnapshot: ConstructionGraphSnapshot;
  readonly regionTopologies: readonly ConstructionRegionTopology[];
  readonly coverageFor: (outline: readonly (readonly [number, number])[]) => readonly ConstructionCoveredRegion[];
  readonly effect: PathBrushEffect;
  readonly tolerance: number;
}

/** The PathCloud's decision; the runtime only executes the ready request. */
export type PathCloudMutationPlan =
  | { readonly kind: "noop"; readonly message: string }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "ready"; readonly request: ApplyPatchReplacementRequest; readonly plannedRegionCount: number };

/**
 * Turns a draw intent into the next state of the entire touched PathCloud.
 * Junction resolution, spine splitting, face ownership and contour rebuild
 * all live here; callers merely provide snapshots and apply the result.
 *
 * This is the only path a path is ever built by. A free stroke, and any
 * straight drag or preset that comes later, differ in nothing but the
 * reference line they hand over: they all resolve to the same spine, go
 * through the same whole-cloud contour engine, and declare the same faces.
 *
 * **What changed from the station-sweep engine this replaces.** There is no
 * mouth, no wedge, no mitre, no crossing-preparation sweep here any more. A
 * T, an X, and an L are not cases this function distinguishes -- they are
 * whatever `planSpineContour`'s per-band union happens to produce once this
 * stroke's own ribbons are unioned against an explicitly selected standing
 * continuation. `pathCorridorId`/`pathFormationFor` still decide the
 * subtype's profile; everything past that is derived, not hand-closed.
 *
 * **What this stage deliberately did not carry over**, flagged rather than
 * silently dropped:
 * - Dragging an already-committed road's own nodes still resolves roles
 *   through `station-node-id.ts`'s address scheme (`path-structure.ts`),
 *   which a contour node minted by this engine does not carry. A newly
 *   drawn road commits correctly; editing it interactively afterwards is a
 *   follow-up, not something this function attempts.
 * - A terrain face the footprint only clips (`coverage: "overlap"`) is left
 *   standing rather than cut to the road's exact contour -- the old engine's
 *   partial-overlap precision (`applyRegionOverlay`'s overlap-planning) is
 *   not reproduced here. Only a face the footprint covers whole
 *   (`coverage: "centroid"`) is consumed, the same fidelity trade-off
 *   `terrain-restack.ts` already accepts for raising. A visible seam of
 *   terrain quads just outside the road's smooth curve is the known
 *   consequence; closing it needs the covered face's own boundary
 *   regenerated pinned to the road's contour, which `resolveCutRepair`
 *   already declares terrain capable of (`"regenerate"`) but nothing
 *   executes yet -- this stage only deletes.
 * - `graphPatchForSpine`'s own welding and crossing checks read a real arc
 *   span by its chord (`spine.controlPoints` no longer carries intermediate
 *   samples along one -- see `groundTrack`), the same way every other span
 *   here always has. A gentle curve's chord and its true arc barely differ;
 *   a very tight, wide-swinging one could weld or cross slightly off from
 *   where the curve itself actually runs. Not a case this stage resolves,
 *   only one it accepts in exchange for never chopping a real arc into
 *   graph nodes it does not need.
 */
export function planPathCloudMutation(input: PathCloudMutationInput): PathCloudMutationPlan {
  const { effect, tolerance } = input;
  const stroke = effect.brushRegion.samples;
  if (stroke.length === 0) return { kind: "noop", message: "Nenhuma alteração: o traço está vazio." };
  const operationId = effect.operationId;

  const fitted = fitPath(stroke, tolerance, { arcs: !input.snapToGrid });
  const swept = fitted.length === 0 ? { line: stroke } : referenceLineFrom(fitted, stroke, pathRidesTerrain(effect.parameters.kind));
  const spine = pathSpineDraftFor(effect, swept.line);
  if (spine === undefined) return { kind: "noop", message: "Nenhuma alteração: o traço não teve extensão suficiente." };

  const parameters = effect.parameters;
    // The full painted brush area is the local repair window. A hit only
    // helps identify the neighbourhood; snapping is a geometric decision
    // made against the PathCloud's spine, never an endpoint permission.
    const correctionReach = effect.brushShape.kind === "square" ? effect.brushShape.size / 2 : effect.brushShape.radius;
    const materialized = graphPatchForSpine(input.graphSnapshot, spine, Math.max(correctionReach, tolerance, 1e-4));
    const correctedSpine = { ...spine, controlPoints: materialized.controlPoints };

    const chain: SpineChainInput = {
      chainId: correctedSpine.corridorId,
      controlPoints: correctedSpine.controlPoints,
      bandOffsets: correctedSpine.bandOffsets,
      miterLimit: correctedSpine.miterLimit,
      tolerance: CURVE_FLATTENING_TOLERANCE,
    };
    const graphPatch = materialized.graphPatch;
    const touchedCloud = changedSpineCloud(input.graphSnapshot, graphPatch);
    const regeneratedChains = touchedCloud.chains
      .filter((controlPoints) => controlPoints.length >= 2)
      .map((controlPoints, index): SpineChainInput => ({
        ...chain,
        chainId: `${correctedSpine.corridorId}:component-${index}`,
        controlPoints,
      }));

    // The footprint this stroke alone claims -- full width, one ribbon, no
    // band separation -- is what a terrain coverage query is asked about.
    // It is not the patch: the patch is banded and unioned band by band
    // against whatever standing road it meets, but a query about what lies
    // underneath only cares how far the road reaches in total.
    const flatPolyline = sampleCatmullRom(correctedSpine.controlPoints, CURVE_FLATTENING_TOLERANCE);
    const flatLength = flatPolyline.slice(0, -1).reduce((sum, p, i) => sum + Math.hypot(p.x - flatPolyline[i + 1]!.x, p.z - flatPolyline[i + 1]!.z), 0);
    if (flatLength < 1e-4) {
      return { kind: "noop", message: "Nenhuma alteração: o traço não teve extensão suficiente." };
    }
    const outerOffset = correctedSpine.bandOffsets[0]!;
    const innerOffset = correctedSpine.bandOffsets[correctedSpine.bandOffsets.length - 1]!;
    const footprintShapes = unionBandLayer(offsetBands(flatPolyline, [outerOffset, innerOffset], correctedSpine.miterLimit));
    const outline = (footprintShapes[0]?.[0] ?? []).map(([x, z]) => [x, z] as const);
    // A stroke that survived the earlier tap check can still collapse to a
    // degenerate footprint once its own ends snap onto existing spine
    // geometry -- both landing on the same node in a dense junction, say.
    // Not a road either, for the same reason a tap is not one; bailing out
    // here rather than handing an empty/degenerate polygon to the session's
    // own coverage query, which refuses one outright.
    if (outline.length < 3) {
      return { kind: "noop", message: "Nenhuma alteração: o traço não teve extensão suficiente." };
    }

    const resolved = resolveCoverage(
      "path",
      input.coverageFor(outline),
      parameters.kind,
    );
    const refusal = firstRefusal(resolved);
    if (refusal !== undefined) {
      return { kind: "refused", reason: refusal };
    }

    // `CUT`'s meaning is universal -- consume what is covered -- but only a
    // face the covered type can actually survive losing gets consumed. A
    // face the footprint merely clips is left standing regardless (the same
    // "whole faces only" fidelity `terrain-restack.ts` already accepts), and
    // a covered type that answers `resolveCutRepair` with `"unsupported"` is
    // left standing too: deleting it with no way to repair the leftover
    // would trade a visible overlap for an unrepairable hole, which is worse.
    const cutSurfaceKeys = resolved
      .filter((entry) => entry.interaction.kind === "cut" && entry.covered.coverage === "centroid")
      .filter((entry) => resolveCutRepair(entry.covered.surfaceType).kind === "regenerate")
      .map((entry) => entry.covered.surfaceKey);

    const topologies = input.regionTopologies;
    const standingRegions = standingRegionsForCloud(topologies, touchedCloud.positions, touchedCloud.corridorIds);
    const existingEdgeUses = new Map<string, boolean[]>();
    for (const topology of topologies) {
      for (const loop of [...topology.outerLoops, ...topology.holes]) {
        for (const use of loop) existingEdgeUses.set(use.edgeId, [...(existingEdgeUses.get(use.edgeId) ?? []), use.reversed]);
      }
    }

    const planned = planSpineContour({
        tableId: input.tableId,
        operationId,
        surfaceType: "path",
        // The changed component is read from the prospective spine graph,
        // not inferred from its old contour faces. A continuation therefore
        // regenerates one continuous road; a branch regenerates its whole
        // junction component.
        editedChains: regeneratedChains.length === 0 ? [chain] : regeneratedChains,
        standingRegions,
        existingNodes: [],
        existingEdgeUses,
      });
    if (planned === undefined) return { kind: "noop", message: "Nenhuma alteração: a nuvem não produziu contorno." };
    return {
      kind: "ready",
      request: {
        operationId,
        sourceSurfaceKeys: [...planned.consumedSurfaceKeys, ...cutSurfaceKeys],
        patch: planned.patch,
        graphPatch,
      },
      plannedRegionCount: planned.patch.regions.length,
    };
}
