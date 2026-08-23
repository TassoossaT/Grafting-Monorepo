import type { AtomicEditOp, BrushShape, PathBrushParams } from "@/features/edit-construction";
import type { ConstructionNodeId, ConstructionPosition } from "@/ports";

// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time. A type-only
// `@/` import is fine -- those are erased.
import {
  createPathBrushEffect,
  firstRefusal,
  parseStationNodeId,
  pathCorridorId,
  pathFormationFor,
  pathRidesTerrain,
  pathRunsIn,
  pathSpineSlot,
  resolveCoverage,
  stationNodeId,
} from "../../../../features/edit-construction/index.ts";

import { scopedToolId, type ToolContext } from "../core/tool-context.ts";
import { fitPath, type FittedEdge } from "../core/stroke-fitting.ts";
import { pathPatch } from "./path-patch.ts";

export const PATH_COLOR = 0xc084fc;


/**
 * How far a flattened arc may sit from the true circle, in world units.
 *
 * This is a smoothness knob, not a fidelity one: the fit has already decided
 * where the road goes, and this only controls how finely that decision is
 * spelled out for a sweep planner that cannot yet read an arc. It disappears
 * the moment the planner takes contour geometry directly.
 */
const ARC_FLATTENING_TOLERANCE = 0.05;

/**
 * Longest horizontal gap between stations, in world units.
 *
 * A road rides the ground it was drawn over, and the only record of that
 * ground is the stroke itself -- every pointer sample carries the height the
 * renderer picked there. Fitting deliberately throws most of those samples
 * away, so a straight run over a hill would be left with height readings at
 * its two ends and a chord tunnelling through everything between. Stations
 * at this spacing are what keep the road on the terrain instead of merely
 * starting and ending on it.
 *
 * This is the one place face count is legitimately bought: unlike the blind
 * subdivision it replaced, each station here exists because the ground under
 * it might differ from its neighbours.
 */
const TERRAIN_FOLLOW_STEP = 2;

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
 * One point of the flattened track, and whether the run genuinely turns
 * there. A corner has to become a station whatever the walk decides, or the
 * road cuts straight across it; an arc sample is only sampling, and the walk
 * is free to place stations wherever it likes along it.
 */
interface TrackPoint {
  readonly x: number;
  readonly z: number;
  readonly corner: boolean;
}

/** The fitted contour as ground positions, arcs sampled by angle. */
function groundTrack(fitted: readonly FittedEdge[]): readonly TrackPoint[] {
  const first = fitted[0];
  if (first === undefined) return [];

  const track: TrackPoint[] = [{ x: first.start.x, z: first.start.z, corner: true }];
  for (const edge of fitted) {
    if (edge.geometry.kind === "arc") {
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
        });
      }
    }
    track.push({ x: edge.end.x, z: edge.end.z, corner: true });
  }
  return track;
}

/**
 * The reference line to sweep along: where the fit decided the road goes,
 * at the height the ground was actually picked at.
 *
 * Arc flattening here is temporary and deliberately kept in one place so it
 * is obvious what to delete -- `plan_sweep_formation` only samples a
 * polyline, so a true arc has no way to reach it intact. Until it accepts
 * contour geometry, a curve is handed over as chords close enough that the
 * difference is invisible, which is still a world apart from handing over
 * the raw hand.
 */
export function referenceLineFrom(
  fitted: readonly FittedEdge[],
  stroke: readonly ConstructionPosition[],
  ridesTerrain: boolean,
): readonly ConstructionPosition[] {
  const track = groundTrack(fitted);
  const first = track[0];
  const last = track[track.length - 1];
  if (first === undefined || last === undefined) return [];

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
    // Two stations at one spot would be dropped by the sweep, sliding every
    // later station's index and breaking the weld bookkeeping below.
    if (Math.hypot(x - previous.x, z - previous.z) < 1e-4) return;
    line.push({ x, y: heightAt(x, z), z });
  };

  let sinceStation = 0;
  for (let index = 0; index + 1 < track.length; index += 1) {
    const from = track[index]!;
    const to = track[index + 1]!;
    const span = Math.hypot(to.x - from.x, to.z - from.z);
    if (span < 1e-9) continue;
    let cursor = 0;
    while (sinceStation + (span - cursor) >= TERRAIN_FOLLOW_STEP) {
      cursor += TERRAIN_FOLLOW_STEP - sinceStation;
      const ratio = cursor / span;
      travelled += TERRAIN_FOLLOW_STEP - sinceStation;
      sinceStation = 0;
      push(from.x + (to.x - from.x) * ratio, from.z + (to.z - from.z) * ratio);
    }
    travelled += span - cursor;
    sinceStation += span - cursor;
    if (to.corner) {
      push(to.x, to.z);
      sinceStation = 0;
    }
  }
  // The run has to end where it was drawn, corner or not.
  push(last.x, last.z);
  return line;
}

/**
 * How close (world units, XZ) a new station may sit to a standing spine node
 * and still be treated as that same node.
 *
 * Deliberately near-exact for now. Two runs meet because they reference one
 * spine node, never because they crossed at the same coordinate -- but the
 * half of the wall's model that makes that *happen* at a crossing is
 * `insertedColumnAt`, which splits the crossed run and mints the node the
 * junction needs. Without it, a generous tolerance only drags a station
 * sideways onto whichever node happened to be near, kinking the run for no
 * gain: stations sit two metres apart, so a crossing lands within a wide
 * tolerance of one perhaps two times in five, and does nothing visible even
 * then. Kept as an exact-coincidence rule until the insert lands with the
 * junction geometry it belongs to.
 */
const SPINE_WELD_TOLERANCE = 1e-3;

/**
 * Where two XZ segments cross, as the parameter along each -- `undefined`
 * for parallel segments, or for a crossing that falls outside either one.
 */
function segmentCrossing(
  fromA: ConstructionPosition,
  toA: ConstructionPosition,
  fromB: ConstructionPosition,
  toB: ConstructionPosition,
): { readonly along: number; readonly across: number } | undefined {
  const ax = toA.x - fromA.x;
  const az = toA.z - fromA.z;
  const bx = toB.x - fromB.x;
  const bz = toB.z - fromB.z;
  const denominator = ax * bz - az * bx;
  if (Math.abs(denominator) < 1e-12) return undefined;
  const dx = fromB.x - fromA.x;
  const dz = fromB.z - fromA.z;
  const along = (dx * bz - dz * bx) / denominator;
  const across = (dx * az - dz * ax) / denominator;
  if (along < 0 || along > 1 || across < 0 || across > 1) return undefined;
  return { along, across };
}

/**
 * Every crossing between the run being drawn and a spine already standing.
 *
 * This is the half of the wall's junction model that was missing: a crossing
 * almost never lands on an existing station, so there is nothing to weld
 * onto until one is *made*. `insertedColumnAt` splits the crossed panel and
 * mints the column; this splits the crossed spine's own edge and mints the
 * node, and the run being drawn gains a station at the very same place.
 *
 * The inserted node is numbered on the crossed run's own station scale --
 * fractionally, because it sits between two of its stations -- so it stays
 * part of that spine's chain and in the right order.
 */
export function junctionsWithStandingSpines(
  ctx: ToolContext,
  line: readonly ConstructionPosition[],
): {
  readonly line: readonly ConstructionPosition[];
  readonly welds: ReadonlyMap<number, ConstructionNodeId>;
  readonly inserts: readonly AtomicEditOp[];
} {
  const standing = pathRunsIn(ctx.runtime.getAllRegionTopologies());
  const found: {
    readonly at: number;
    readonly position: ConstructionPosition;
    readonly nodeId: ConstructionNodeId;
    readonly edgeId: string;
  }[] = [];
  // One insert per crossed edge per commit: the second would name an edge the
  // first has already split out of existence.
  const usedEdges = new Set<string>();

  for (const run of standing) {
    const spine = run.spine;
    if (spine === undefined) continue;
    for (let step = 0; step + 1 < spine.nodes.length; step += 1) {
      const edgeId = spine.edgeIds[step];
      if (edgeId === undefined || usedEdges.has(edgeId)) continue;
      const fromA = spine.nodes[step]!;
      const toA = spine.nodes[step + 1]!;
      for (let index = 0; index + 1 < line.length; index += 1) {
        const crossing = segmentCrossing(fromA.position, toA.position, line[index]!, line[index + 1]!);
        if (crossing === undefined) continue;
        const position: ConstructionPosition = {
          x: fromA.position.x + (toA.position.x - fromA.position.x) * crossing.along,
          y: fromA.position.y + (toA.position.y - fromA.position.y) * crossing.along,
          z: fromA.position.z + (toA.position.z - fromA.position.z) * crossing.along,
        };
        const station = Number((fromA.station + (toA.station - fromA.station) * crossing.along).toFixed(3));
        const nodeId = stationNodeId(run.corridorId, station, 0);
        usedEdges.add(edgeId);
        found.push({ at: index + crossing.across, position, nodeId, edgeId });
        break;
      }
    }
  }
  if (found.length === 0) return { line, welds: new Map(), inserts: [] };

  const ordered = [...found].sort((left, right) => left.at - right.at);
  const spliced: ConstructionPosition[] = [];
  const welds = new Map<number, ConstructionNodeId>();
  let next = 0;
  for (let index = 0; index < line.length; index += 1) {
    while (next < ordered.length && ordered[next]!.at < index) {
      welds.set(spliced.length, ordered[next]!.nodeId);
      spliced.push(ordered[next]!.position);
      next += 1;
    }
    spliced.push(line[index]!);
  }
  while (next < ordered.length) {
    welds.set(spliced.length, ordered[next]!.nodeId);
    spliced.push(ordered[next]!.position);
    next += 1;
  }

  const inserts: AtomicEditOp[] = ordered.map((crossing) => ({
    kind: "insert-vertex",
    edgeId: crossing.edgeId,
    nodeId: crossing.nodeId,
    position: crossing.position,
    firstEdgeId: `${crossing.edgeId}|${crossing.nodeId}|0`,
    secondEdgeId: `${crossing.edgeId}|${crossing.nodeId}|1`,
  }));
  return { line: spliced, welds, inserts };
}

/** Every spine node standing on the table, with the position it stands at. */
function standingSpineNodes(
  ctx: ToolContext,
): readonly { readonly id: ConstructionNodeId; readonly position: ConstructionPosition }[] {
  const seen = new Map<ConstructionNodeId, ConstructionPosition>();
  for (const topology of ctx.runtime.getAllRegionTopologies()) {
    for (const node of topology.nodes) {
      if (seen.has(node.id) || parseStationNodeId(node.id)?.across !== 0) continue;
      seen.set(node.id, node.position);
    }
  }
  return [...seen].map(([id, position]) => ({ id, position }));
}

/**
 * The reference line with every station landing on a standing spine snapped
 * exactly onto it, plus the node ids those stations must reuse.
 *
 * Resolved *before* the sweep, never after -- the same order
 * `commitWallContour` resolves its columns in, and for the same reason: a
 * station that will share a node has to be built at that node's position
 * rather than dragged onto it afterwards.
 */
function weldedToStandingSpines(
  ctx: ToolContext,
  line: readonly ConstructionPosition[],
  tolerance: number,
): {
  readonly line: readonly ConstructionPosition[];
  readonly welds: ReadonlyMap<number, ConstructionNodeId>;
} {
  const standing = standingSpineNodes(ctx);
  if (standing.length === 0) return { line, welds: new Map() };

  const welds = new Map<number, ConstructionNodeId>();
  const taken = new Set<ConstructionNodeId>();
  const snapped = line.map((station, index) => {
    let best:
      | { readonly id: ConstructionNodeId; readonly position: ConstructionPosition; readonly distance: number }
      | undefined;
    for (const candidate of standing) {
      if (taken.has(candidate.id)) continue;
      const distance = Math.hypot(candidate.position.x - station.x, candidate.position.z - station.z);
      if (distance > tolerance) continue;
      if (best === undefined || distance < best.distance) {
        best = { id: candidate.id, position: candidate.position, distance };
      }
    }
    if (best === undefined) return station;
    taken.add(best.id);
    welds.set(index, best.id);
    return best.position;
  });
  return { line: snapped, welds };
}

/**
 * Commits one path run, in one transaction.
 *
 * This is the only path a path is ever built by, the way
 * `walls/wall-shared.ts`'s `commitWallContour` is the only path a wall is
 * built by. A free stroke, and any straight drag or preset that comes
 * later, differ in nothing but the reference line they hand over: they all
 * resolve their formation the same way, claim their edges the same way, and
 * declare the same faces. Nothing here knows which tool called it.
 *
 * The raw stroke is fitted before anything else, exactly as
 * `commitWallStroke` fits one: `tolerance` is whatever of the brush's reach
 * the road itself does not occupy, so the committed road always lands inside
 * the ghost that was drawn. At zero slack -- a brush no wider than the road
 * -- the stroke is committed literally.
 *
 * What reaches Rust is still a polyline, because the sweep planner cannot
 * read an arc yet. But it is now a polyline of decisions rather than of hand
 * samples, and this is the single place that changes when the planner learns
 * contour geometry.
 */
export function commitPathContour(
  ctx: ToolContext,
  stroke: readonly ConstructionPosition[],
  brushShape: BrushShape,
  tolerance: number,
  params: PathBrushParams,
  domain: string,
): void {
  if (stroke.length === 0) return;
  const sequence = ctx.nextSequence();
  const operationId = scopedToolId(ctx, domain, sequence);

  const fitted = fitPath(stroke, tolerance, { arcs: !ctx.snapToGrid });
  const drawn =
    fitted.length === 0
      ? stroke
      : referenceLineFrom(fitted, stroke, pathRidesTerrain(params.pathKind));
  if (drawn.length === 0) return;
  // Crossing detection is written and tested (`junctionsWithStandingSpines`)
  // but deliberately not wired in yet.
  //
  // Two reasons, and the second is the one that matters. It splices a station
  // into the run at the crossing without checking how close the neighbouring
  // stations are, so a crossing landing a centimetre from one produces a band
  // of almost no length -- a sliver face along the contour. And splitting the
  // crossed spine buys nothing while the overlay still consumes that run's
  // bands at the crossing: the node survives, its chain does not, and the
  // only visible result is malformed geometry.
  //
  // It belongs on the cloud layer that now owns edit dispatch, which is where
  // it will be rebuilt rather than patched here.
  const { line: referenceLine, welds } = weldedToStandingSpines(
    ctx,
    drawn,
    SPINE_WELD_TOLERANCE,
  );

  try {
    const effect = createPathBrushEffect(
      {
        brushShape,
        brushRegion: { samples: referenceLine },
        parameters: pathFormationFor(params),
      },
      { operationId, tableId: ctx.tableId, initiatedBy: "local" },
    );
    const profile = effect.parameters.profile;
    const plan = ctx.runtime.planPathFormation(effect);
    const formation = pathPatch(
      ctx.tableId,
      pathCorridorId(effect.operationId, params.pathKind),
      effect.targetType,
      plan,
      profile.length,
      pathSpineSlot(profile),
      // The sweep drops a station only where two coincide, which the
      // reference line already rules out. Were one dropped anyway the indices
      // would no longer line up, so the run commits unwelded rather than
      // welded to the wrong place.
      plan.referenceLine.length === referenceLine.length ? welds : new Map(),
    );

    const resolved = resolveCoverage(
      effect.targetType,
      ctx.runtime.getFootprintCoverage(formation.outline),
      params.pathKind,
    );
    const refusal = firstRefusal(resolved);
    if (refusal !== undefined) {
      ctx.reportFeedback({ tone: "error", message: `Caminho não aplicado: ${refusal}` });
      return;
    }
    const sourceSurfaceKeys = resolved
      .filter((entry) => entry.interaction.kind === "cut")
      .map((entry) => entry.covered.surfaceKey);

    const outcome = ctx.runtime.applyRegionOverlay(
      {
        operationId: effect.operationId,
        sourceSurfaceKeys,
        outline: formation.outline,
        boundary: formation.boundary,
        patch: formation.patch,
      },
      "local",
      effect.operationId,
    );
    const changedSurfaceCount = outcome.createdSurfaceKeys.length + outcome.affectedSurfaceKeys.length;
    if (changedSurfaceCount === 0 && outcome.removedSurfaceKeys.length === 0) {
      ctx.reportFeedback({ tone: "info", message: "Nenhuma alteração: o traço não cobriu nenhuma área válida." });
      return;
    }
    ctx.history.record({ kind: "path-brush", operationId: effect.operationId });
    ctx.reportFeedback({
      tone: "success",
      message: `Caminho aplicado: ${changedSurfaceCount} superfícies alteradas e ${outcome.createdNodeIds.length} nós novos.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.reportFeedback({ tone: "error", message: `Caminho não aplicado: ${message}` });
  }
}
