import type { PathBrushEffect } from "@/features/edit-construction";
import type { ConstructionGraphPatch, ConstructionGraphSnapshot, ConstructionPosition, ConstructionRegionTopology } from "@/ports";

// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time. A type-only
// `@/` import is fine -- those are erased.
import {
  firstRefusal,
  chainsOf,
  pathRidesTerrain,
  pathSpineDraftFor,
  spineGraphFromSnapshot,
  spineControlNodeId,
  resolveCoverage,
} from "../../../features/edit-construction/index.ts";

import type { ToolContext } from "../tools/core/tool-context.ts";
import { fitPath, type FittedEdge } from "../tools/core/stroke-fitting.ts";
import type { SweptArc } from "../tools/core/sweep-formation.ts";
import { inStage, reportToolFailure, reportToolWarning } from "../tools/core/tool-diagnostics.ts";
import {
  applySpineContour,
  offsetBands,
  planSpineContour,
  sampleCatmullRom,
  unionBandLayer,
  type SpineChainInput,
} from "./contour/spine-contour/index.ts";

export const PATH_COLOR = 0xc084fc;

/** What this tool calls itself on the console when a stage fails. */
const TOOL = "path-brush";


/**
 * How far a flattened arc may sit from the true circle, in world units.
 *
 * This is a smoothness knob, not a fidelity one: the fit has already decided
 * where the road goes, and this only controls how finely that decision is
 * spelled out before it becomes Catmull-Rom control points. It disappears
 * the moment the fitter takes contour geometry directly.
 */
const ARC_FLATTENING_TOLERANCE = 0.05;

/**
 * How finely the committed curve follows the true Catmull-Rom shape, in
 * world units (XZ) -- the spine-contour engine's own equivalent of
 * `ARC_FLATTENING_TOLERANCE` above, generalised from a circular arc to a
 * free curve through the drawn control points.
 */
const CURVE_FLATTENING_TOLERANCE = 0.05;

interface MaterializedSpine {
  readonly graphPatch: ConstructionGraphPatch;
  readonly controlPoints: readonly ConstructionPosition[];
}

/** Materializes and locally snaps the type-owned spine against its own network. */
function graphPatchForSpine(
  ctx: ToolContext,
  spine: NonNullable<ReturnType<typeof pathSpineDraftFor>>,
  snapTolerance: number,
): MaterializedSpine {
  const snapshot = ctx.runtime.getGraphSnapshot();
  const spineNodes = snapshot.nodes.filter((node) => node.id.startsWith("spine:"));
  const nearest = (point: ConstructionPosition) => spineNodes
    .map((node) => ({ node, distance: Math.hypot(node.position.x - point.x, node.position.z - point.z) }))
    .filter((candidate) => candidate.distance <= snapTolerance)
    .sort((left, right) => left.distance - right.distance)[0]?.node;
  const nodeById = new Map(spineNodes.map((node) => [node.id, node]));
  const nearestEdge = (point: ConstructionPosition) => snapshot.edges
    .flatMap((edge) => {
      const from = nodeById.get(edge.startNodeId);
      const to = nodeById.get(edge.endNodeId);
      return from === undefined || to === undefined ? [] : [{ edge, from, to }];
    })
    .map((candidate) => {
      const dx = candidate.to.position.x - candidate.from.position.x;
      const dz = candidate.to.position.z - candidate.from.position.z;
      const lengthSquared = dx * dx + dz * dz;
      const t = lengthSquared < 1e-9 ? 0 : Math.max(0, Math.min(1, ((point.x - candidate.from.position.x) * dx + (point.z - candidate.from.position.z) * dz) / lengthSquared));
      return {
        ...candidate,
        t,
        position: {
          x: candidate.from.position.x + dx * t,
          y: candidate.from.position.y + (candidate.to.position.y - candidate.from.position.y) * t,
          z: candidate.from.position.z + dz * t,
        },
        distance: Math.hypot(point.x - (candidate.from.position.x + dx * t), point.z - (candidate.from.position.z + dz * t)),
      };
    })
    .filter((candidate) => candidate.distance <= snapTolerance)
    .sort((left, right) => left.distance - right.distance)[0];
  const removedEdgeIds: string[] = [];
  const splitEdges: ConstructionGraphPatch["edges"][number][] = [];
  const resolvedPoints: ConstructionPosition[] = [];
  const ids = spine.controlPoints.map((point, index) => {
    const minted = spineControlNodeId(spine.corridorId, index);
    const node = nearest(point);
    if (node !== undefined) {
      resolvedPoints.push(node.position);
      return node.id;
    }
    const edge = nearestEdge(point);
    if (edge === undefined) {
      resolvedPoints.push(point);
      return minted;
    }
    resolvedPoints.push(edge.position);
    removedEdgeIds.push(edge.edge.edgeId);
    splitEdges.push(
      { edgeId: `spine-split:${edge.edge.edgeId}:${minted}:start`, startNodeId: edge.edge.startNodeId, endNodeId: minted },
      { edgeId: `spine-split:${edge.edge.edgeId}:${minted}:end`, startNodeId: minted, endNodeId: edge.edge.endNodeId },
    );
    return minted;
  });
  return {
    controlPoints: resolvedPoints,
    graphPatch: {
    nodes: resolvedPoints.map((position, index) => ({ id: ids[index]!, position })),
    removedEdgeIds,
    edges: [
      ...ids.slice(0, -1).map((startNodeId, index) => ({
        edgeId: `spine-edge:${spine.corridorId}:${index}`,
        startNodeId,
        endNodeId: ids[index + 1]!,
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
   * Every spine control point position in the touched component -- the one
   * and only signal used to decide which standing contour faces this edit
   * replaces (see {@link standingRegionsForCloud}). Built from the same
   * graph walk that already decides which chains to resample, so cloud
   * membership can never disagree between "what gets rebuilt" and "what
   * gets replaced" the way two independently-guessed answers could.
   */
  readonly positions: readonly ConstructionPosition[];
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
  return { chains, positions: clusterNodes.map((node) => node.position) };
}

/**
 * Every standing "path" face that belongs to the touched spine cloud --
 * every profile puts a point at `PATH_SPINE_OFFSET` on purpose, so the seam
 * between any two adjacent bands sits exactly on top of the real spine's own
 * control point, at every control point, including every junction. A
 * contour face therefore always has a vertex sitting exactly where some
 * spine control point of its own chain does, and cloud membership can be
 * read off that directly instead of guessed from brush geometry.
 *
 * **By position, not by node id.** A contour vertex welded onto a spine
 * control point still mints its *own* `contour:...` id -- nothing today
 * ever seeds a spine node into a contour weld's own candidate set, so a
 * band's seam vertex never actually carries its spine node's id, only its
 * exact position. Matching id-for-id would therefore match nothing at all;
 * matching by XZ position is what the profile's own `PATH_SPINE_OFFSET`
 * point guarantees instead -- every control point of a chain has a band
 * vertex sitting exactly there, on both sides of the seam.
 *
 * **This replaces geometric proximity as the selection signal entirely.**
 * A brush stroke or an observed pointer hit is evidence of where the user
 * touched the *screen*; `cloudPositions` is the graph's own, exact answer to
 * what is topologically the same road -- the two used to disagree whenever
 * a stroke touched a face far from any of its own sparse nodes (a long
 * straight has only two), which is what made a join sometimes duplicate a
 * face instead of replacing it.
 */
function standingRegionsForCloud(
  topologies: readonly ConstructionRegionTopology[],
  cloudPositions: readonly ConstructionPosition[],
): readonly ConstructionRegionTopology[] {
  const near = (a: ConstructionPosition, b: ConstructionPosition) => Math.hypot(a.x - b.x, a.z - b.z) <= 1e-3;
  return topologies.filter(
    (topology) =>
      topology.surfaceType === "path" &&
      topology.nodes.some((node) => cloudPositions.some((position) => near(node.position, position))),
  );
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

/**
 * One point of the sampled track, and whether the run genuinely turns there.
 *
 * A corner has to become a control point whatever the walk decides, or the
 * road cuts straight across it; an arc sample is only sampling, and the walk
 * is free to place control points wherever it likes along it.
 *
 * `arc` is the curve the run is *on* as it leaves this point -- carried
 * through fitting and flattening, but no longer read once the point becomes
 * a Catmull-Rom control point: the spine-contour engine re-derives its own
 * curvature from the control points themselves, rather than being handed a
 * circular arc it would have to approximate anyway.
 */
interface TrackPoint {
  readonly x: number;
  readonly z: number;
  readonly corner: boolean;
  readonly arc: SweptArc | undefined;
}

/** The fitted contour as ground positions, arcs sampled by angle. */
function groundTrack(fitted: readonly FittedEdge[]): readonly TrackPoint[] {
  const first = fitted[0];
  if (first === undefined) return [];

  const track: TrackPoint[] = [
    { x: first.start.x, z: first.start.z, corner: true, arc: undefined },
  ];
  const carry = (arc: SweptArc | undefined): void => {
    const last = track[track.length - 1]!;
    track[track.length - 1] = { ...last, arc };
  };
  for (const edge of fitted) {
    if (edge.geometry.kind === "arc") {
      carry({ center: edge.geometry.center, clockwise: edge.geometry.clockwise });
      const [centerX, centerZ] = edge.geometry.center;
      const radius = Math.hypot(edge.start.x - centerX, edge.start.z - centerZ);
      const startAngle = Math.atan2(edge.start.z - centerZ, edge.start.x - centerX);
      const endAngle = Math.atan2(edge.end.z - centerZ, edge.end.x - centerX);
      const counterClockwise = (endAngle - startAngle + Math.PI * 2) % (Math.PI * 2);
      const swept = edge.geometry.clockwise ? Math.PI * 2 - counterClockwise : counterClockwise;

      // Sagitta: a chord deviating by `t` from a circle of radius `r`
      // subtends 2*acos(1 - t/r). A radius under the tolerance has no
      // meaningful arc left to sample, so one chord is the whole of it.
      const maxStep =
        radius > ARC_FLATTENING_TOLERANCE
          ? 2 * Math.acos(1 - ARC_FLATTENING_TOLERANCE / radius)
          : Math.PI;
      const steps = Math.max(1, Math.ceil(swept / maxStep));
      for (let step = 1; step < steps; step += 1) {
        const angle = edge.geometry.clockwise
          ? startAngle - (swept * step) / steps
          : startAngle + (swept * step) / steps;
        track.push({
          x: centerX + radius * Math.cos(angle),
          z: centerZ + radius * Math.sin(angle),
          corner: false,
          arc: { center: edge.geometry.center, clockwise: edge.geometry.clockwise },
        });
      }
    }
    track.push({ x: edge.end.x, z: edge.end.z, corner: true, arc: undefined });
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
): { readonly line: readonly ConstructionPosition[]; readonly arcs: readonly (SweptArc | undefined)[] } {
  const track = groundTrack(fitted);
  const first = track[0];
  const last = track[track.length - 1];
  if (first === undefined || last === undefined) return { line: [], arcs: [] };

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
  /** The curve each span runs on; one shorter than `line`. */
  const arcs: (SweptArc | undefined)[] = [];
  const push = (x: number, z: number, arc: SweptArc | undefined): void => {
    const previous = line[line.length - 1]!;
    // Two stations at one spot would collapse into a zero-length curve
    // segment.
    if (Math.hypot(x - previous.x, z - previous.z) < 1e-4) return;
    line.push({ x, y: heightAt(x, z), z });
    arcs.push(arc);
  };

  // Every point the fit itself produced is a control point: a corner because
  // the run genuinely turns there, an arc sample because the outline handed
  // to the coverage query is a polygon and has to follow the curve even
  // though the edges between these points are true arcs.
  //
  // What is *not* automatic any more is anything between them. A stretch gets
  // extra control points only where the ground under it strays from the
  // straight line the stretch would otherwise be -- so a straight road over
  // flat ground is two control points, and a straight road over a ridge is
  // exactly as many as the ridge needs.
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
        push(
          from.x + (to.x - from.x) * backRatio,
          from.z + (to.z - from.z) * backRatio,
          from.arc,
        );
        anchored = travelled;
        lastProbe = probe;
      }
    }

    travelled += span;
    push(to.x, to.z, from.arc);
  }
  // The run has to end where it was drawn, corner or not.
  push(last.x, last.z, track[track.length - 2]?.arc);
  // One span per gap: a station pushed at the very start has no span behind
  // it, and the walk above records a span only when it lands somewhere new.
  return { line, arcs: arcs.slice(0, Math.max(0, line.length - 1)) };
}

/**
 * Applies one immutable path-brush effect, in one transaction.
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
 * **Two things this stage deliberately did not carry over**, both flagged
 * rather than silently dropped:
 * - Dragging an already-committed road's own nodes still resolves roles
 *   through `station-node-id.ts`'s address scheme (`path-structure.ts`),
 *   which a contour node minted by this engine does not carry. A newly
 *   drawn road commits correctly; editing it interactively afterwards is a
 *   follow-up, not something this function attempts.
 * - The old engine cut the exact remainder of any terrain patch a road's
 *   footprint partially overlapped (`applyRegionOverlay`'s own
 *   overlap-planning). This function only refuses a stroke that overlaps
 *   something it must not touch; it does not cut or consume terrain underneath
 *   it. Drawing a road over terrain leaves that terrain standing rather than
 *   risking an imprecise cut.
 */
export function applyPathBrushEffect(
  ctx: ToolContext,
  effect: PathBrushEffect,
  tolerance: number,
): void {
  const stroke = effect.brushRegion.samples;
  if (stroke.length === 0) return;
  const operationId = effect.operationId;

  const fitted = fitPath(stroke, tolerance, { arcs: !ctx.snapToGrid });
  const swept =
    fitted.length === 0
      ? { line: stroke, arcs: [] as readonly (SweptArc | undefined)[] }
      : referenceLineFrom(fitted, stroke, pathRidesTerrain(effect.parameters.kind));
  const spine = pathSpineDraftFor(effect, swept.line);
  // A tap is not a road: one control point has no span to sample a curve.
  if (spine === undefined) return;

  try {
    const parameters = effect.parameters;
    // The full painted brush area is the local repair window. A hit only
    // helps identify the neighbourhood; snapping is a geometric decision
    // made against the PathCloud's spine, never an endpoint permission.
    const correctionReach = effect.brushShape.kind === "square" ? effect.brushShape.size / 2 : effect.brushShape.radius;
    const materialized = graphPatchForSpine(ctx, spine, Math.max(correctionReach, tolerance, 1e-4));
    const correctedSpine = { ...spine, controlPoints: materialized.controlPoints };

    const chain: SpineChainInput = {
      chainId: correctedSpine.corridorId,
      controlPoints: correctedSpine.controlPoints,
      bandOffsets: correctedSpine.bandOffsets,
      miterLimit: correctedSpine.miterLimit,
      tolerance: CURVE_FLATTENING_TOLERANCE,
    };
    const graphPatch = materialized.graphPatch;
    const touchedCloud = changedSpineCloud(ctx.runtime.getGraphSnapshot(), graphPatch);
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
    const outerOffset = correctedSpine.bandOffsets[0]!;
    const innerOffset = correctedSpine.bandOffsets[correctedSpine.bandOffsets.length - 1]!;
    const footprintShapes = unionBandLayer(offsetBands(flatPolyline, [outerOffset, innerOffset], correctedSpine.miterLimit));
    const outline = (footprintShapes[0]?.[0] ?? []).map(([x, z]) => [x, z] as const);

    const resolved = resolveCoverage(
      "path",
      inStage(TOOL, "read the footprint coverage", { operationId, outline: outline.length }, () =>
        ctx.runtime.getFootprintCoverage(outline),
      ),
      parameters.kind,
    );
    const refusal = firstRefusal(resolved);
    if (refusal !== undefined) {
      reportToolWarning(TOOL, "the footprint was refused", {
        operationId,
        refusal,
        covered: resolved.map((entry) => ({
          surface: entry.covered.surfaceKey.join(":"),
          type: entry.covered.surfaceType,
          interaction: entry.interaction.kind,
        })),
      });
      ctx.reportFeedback({ tone: "error", message: `Caminho não aplicado: ${refusal}` });
      return;
    }

    const topologies = ctx.runtime.getAllRegionTopologies();
    const standingRegions = standingRegionsForCloud(topologies, touchedCloud.positions);
    const existingNodes = topologies.flatMap((topology) => topology.nodes);
    const existingEdgeUses = new Map<string, boolean[]>();
    for (const topology of topologies) {
      for (const loop of [...topology.outerLoops, ...topology.holes]) {
        for (const use of loop) existingEdgeUses.set(use.edgeId, [...(existingEdgeUses.get(use.edgeId) ?? []), use.reversed]);
      }
    }

    const planned = inStage(TOOL, "plan the spine contour", { operationId, controlPoints: correctedSpine.controlPoints.length }, () =>
      planSpineContour({
        tableId: ctx.tableId,
        operationId,
        surfaceType: "path",
        // The changed component is read from the prospective spine graph,
        // not inferred from its old contour faces. A continuation therefore
        // regenerates one continuous road; a branch regenerates its whole
        // junction component.
        editedChains: regeneratedChains.length === 0 ? [chain] : regeneratedChains,
        standingRegions,
        existingNodes,
        existingEdgeUses,
      }),
    );
    if (planned === undefined) return;

    const outcome = inStage(
      TOOL,
      "lay the road",
      { operationId, faces: planned.patch.regions.length },
      () =>
        applySpineContour(ctx, operationId, planned, graphPatch),
    );

    if (outcome.skippedRegionIds.length > 0) {
      // A replacement is atomic, so a refused target preserves its standing
      // faces. This warning remains useful for an add-only stroke.
      reportToolWarning(TOOL, "a band face was refused", {
        operationId,
        skipped: outcome.skippedRegionIds,
      });
    }

    const changedSurfaceCount = outcome.createdSurfaceKeys.length + outcome.affectedSurfaceKeys.length;
    if (changedSurfaceCount === 0 && outcome.removedSurfaceKeys.length === 0) {
      ctx.reportFeedback({ tone: "info", message: "Nenhuma alteração: o traço não cobriu nenhuma área válida." });
      return;
    }
    ctx.history.record({ kind: "path-brush", operationId });
    ctx.reportFeedback({
      tone: "success",
      message: `Caminho aplicado: ${changedSurfaceCount} superfícies alteradas e ${outcome.createdNodeIds.length} nós novos.`,
    });
  } catch (error) {
    // Already named on the console by whichever stage threw; this catches
    // the ones that have no stage of their own.
    reportToolFailure(TOOL, "apply the path effect", { operationId, stroke: stroke.length }, error);
    const message = error instanceof Error ? error.message : String(error);
    ctx.reportFeedback({ tone: "error", message: `Caminho não aplicado: ${message}` });
  }
}
