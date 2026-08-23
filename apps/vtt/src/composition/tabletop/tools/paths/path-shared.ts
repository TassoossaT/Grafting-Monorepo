import {
  createPathBrushEffect,
  firstRefusal,
  parseStationNodeId,
  pathCorridorId,
  pathFormationFor,
  pathRidesTerrain,
  pathSpineSlot,
  resolveCoverage,
} from "@/features/edit-construction";
import type { BrushShape, PathBrushParams } from "@/features/edit-construction";
import type { ConstructionNodeId, ConstructionPosition } from "@/ports";

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

/** The fitted contour as ground positions, arcs sampled by angle. */
function groundTrack(fitted: readonly FittedEdge[]): readonly (readonly [number, number])[] {
  const first = fitted[0];
  if (first === undefined) return [];

  const track: (readonly [number, number])[] = [[first.start.x, first.start.z]];
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
        track.push([centerX + radius * Math.cos(angle), centerZ + radius * Math.sin(angle)]);
      }
    }
    track.push([edge.end.x, edge.end.z]);
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
function referenceLineFrom(
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
  const startY = groundHeightNear(stroke, first[0], first[1]);
  const endY = groundHeightNear(stroke, last[0], last[1]);
  let total = 0;
  for (let index = 0; index + 1 < track.length; index += 1) {
    total += Math.hypot(track[index + 1]![0] - track[index]![0], track[index + 1]![1] - track[index]![1]);
  }
  let travelled = 0;
  const heightAt = (x: number, z: number): number => {
    if (ridesTerrain) return groundHeightNear(stroke, x, z);
    return total < 1e-6 ? startY : startY + (endY - startY) * (travelled / total);
  };

  const line: ConstructionPosition[] = [
    { x: first[0], y: heightAt(first[0], first[1]), z: first[1] },
  ];
  for (let index = 0; index + 1 < track.length; index += 1) {
    const from = track[index]!;
    const to = track[index + 1]!;
    const span = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const steps = Math.max(1, Math.ceil(span / TERRAIN_FOLLOW_STEP));
    for (let step = 1; step <= steps; step += 1) {
      const ratio = step / steps;
      const x = from[0] + (to[0] - from[0]) * ratio;
      const z = from[1] + (to[1] - from[1]) * ratio;
      travelled += span / steps;
      const previous = line[line.length - 1]!;
      // Two stations at one spot would be dropped by the sweep, sliding every
      // later station's index and breaking the weld bookkeeping below.
      if (Math.hypot(x - previous.x, z - previous.z) < 1e-4) continue;
      line.push({ x, y: heightAt(x, z), z });
    }
  }
  return line;
}

/**
 * How close (world units, XZ) a new station may sit to a standing spine node
 * and still be treated as that same node -- a floor, raised by whatever
 * correction budget the stroke carries, exactly as the wall's own weld
 * tolerance is.
 *
 * This is the whole of a junction's identity. Two runs meet because they
 * reference one spine node, never because they crossed at the same
 * coordinate: coincident is not connected, which is also what leaves an
 * overpass an overpass -- it crosses without ever sharing one.
 */
const SPINE_WELD_TOLERANCE = 0.25;

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
  const { line: referenceLine, welds } = weldedToStandingSpines(
    ctx,
    drawn,
    Math.max(SPINE_WELD_TOLERANCE, tolerance),
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
