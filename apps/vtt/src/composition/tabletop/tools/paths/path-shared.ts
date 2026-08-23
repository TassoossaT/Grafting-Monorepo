import type { AtomicEditOp, BrushShape, PathBrushParams, PathRun } from "@/features/edit-construction";
import type {
  ConstructionCoveredRegion,
  ConstructionNodeId,
  ConstructionPosition,
  ConstructionSweepPlan,
} from "@/ports";

// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time. A type-only
// `@/` import is fine -- those are erased.
import {
  createPathBrushEffect,
  firstRefusal,
  parseStationNodeId,
  pathCorridorId,
  pathFormationFor,
  pathHalfWidth,
  pathRidesTerrain,
  pathRunsIn,
  pathSpineSlot,
  resolveCoverage,
  stationNodeId,
} from "../../../../features/edit-construction/index.ts";

import { scopedToolId, type ToolContext } from "../core/tool-context.ts";
import { fitPath, type FittedEdge } from "../core/stroke-fitting.ts";
import { pointInPolygonXZ, projectOntoLineXZ, segmentCrossingXZ } from "../shapes/geometry-2d.ts";
import { contourFusionsAgainst, footprintOf } from "../core/contour-fusion.ts";
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
 * How close (world units, XZ) a crossing may fall to a station already on the
 * run before the two are treated as one.
 *
 * A quarter of the station step. Closer than this and keeping both would
 * declare a band of almost no length -- the sliver faces that ran along the
 * contour when crossings were first spliced in blindly.
 */
const STATION_MERGE_DISTANCE = TERRAIN_FOLLOW_STEP / 4;

/**
 * How far this run reaches from its own spine, measured on the run itself.
 *
 * A road ending *on* another road is a junction, and "on" means inside that
 * road's surface. Measured rather than assumed, because every run carries its
 * own width and the run being drawn need not share it.
 */
function reachOf(run: PathRun): number {
  let widest = 0;
  for (const rib of run.ribs) {
    const spine = rib.nodes.find((node) => node.across === 0);
    if (spine === undefined) continue;
    for (const node of rib.nodes) {
      widest = Math.max(
        widest,
        Math.hypot(node.position.x - spine.position.x, node.position.z - spine.position.z),
      );
    }
  }
  return widest;
}

/**
 * Every place the run being drawn meets a spine already standing.
 *
 * Two ways to meet, and only the first existed before: a stroke drawn
 * **across** another run crosses its spine, and a stroke that **ends on**
 * another run touches it without ever crossing anything. The second is the
 * ordinary T -- one road arriving at another -- and is far more common than
 * the first. Segment intersection cannot see it at all, because there is no
 * intersection: the drawn line simply stops.
 *
 * So an endpoint is handled by projection instead. If either end of the
 * stroke lands within the standing run's own reach of its spine -- which is
 * to say, on that road -- it is moved onto the spine and joined there.
 *
 * Either way the join is *made*, not found: a meeting point almost never
 * lands on an existing station, so the crossed spine's edge is split and the
 * node minted, which is `insertedColumnAt` for paths. The node is numbered on
 * the crossed run's own station scale, fractionally, so it stays part of that
 * spine's chain and in the right order.
 */
export function junctionsWithStandingSpines(
  ctx: ToolContext,
  line: readonly ConstructionPosition[],
  /**
   * How far the run being drawn reaches from its own spine. Added to the
   * standing run's reach, so two roads join when their **surfaces** touch
   * rather than when one centre line reaches the other. Nobody draws up to
   * another road's centre line -- they stop when the two look like they meet,
   * which is exactly where the two surfaces first overlap.
   */
  ownReach = 0,
): {
  readonly line: readonly ConstructionPosition[];
  readonly welds: ReadonlyMap<number, ConstructionNodeId>;
  readonly inserts: readonly AtomicEditOp[];
  /**
   * The standing runs this one is now joined to, by spine.
   *
   * Reported rather than looked up again because it is the answer to the
   * question contour fusion asks next -- rule two of the junction spec is
   * that two runs sharing a spine node must share their contours as well, so
   * the runs listed here are exactly the ones whose rims are in play. A run
   * that merely overlaps is not one of them.
   */
  readonly joined: readonly PathRun[];
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
  /** Splits to issue against standing spines, in the order they were found. */
  const inserts: { readonly nodeId: ConstructionNodeId; readonly position: ConstructionPosition; readonly edgeId: string }[] = [];

  /**
   * Where an end of the stroke was moved onto a spine, by its own index in
   * the line. Kept apart from the splices below because an arrival *replaces*
   * that station rather than standing beside it -- the end has to land on the
   * spine, and leaving the drawn one in place would put a station up to a
   * road-width away and join nothing.
   */
  const arrivals = new Map<number, { readonly position: ConstructionPosition; readonly nodeId: ConstructionNodeId }>();

  /** Records one meeting point, minting the node the crossed spine gains. */
  /** Corridors this run welded a spine node onto. */
  const joinedCorridors = new Set<string>();

  const record = (
    run: PathRun,
    step: number,
    edgeId: string,
    along: number,
    at: number,
    arrivalIndex?: number,
  ): void => {
    const spine = run.spine!;
    const fromA = spine.nodes[step]!;
    const toA = spine.nodes[step + 1]!;
    const position: ConstructionPosition = {
      x: fromA.position.x + (toA.position.x - fromA.position.x) * along,
      y: fromA.position.y + (toA.position.y - fromA.position.y) * along,
      z: fromA.position.z + (toA.position.z - fromA.position.z) * along,
    };
    const station = Number((fromA.station + (toA.station - fromA.station) * along).toFixed(3));
    const nodeId = stationNodeId(run.corridorId, station, 0);
    usedEdges.add(edgeId);
    joinedCorridors.add(run.corridorId);
    if (arrivalIndex !== undefined) {
      arrivals.set(arrivalIndex, { position, nodeId });
      inserts.push({ nodeId, position, edgeId });
      return;
    }
    found.push({ at, position, nodeId, edgeId });
    inserts.push({ nodeId, position, edgeId });
  };

  // An end of the stroke that lands on a standing run joins it there. Done
  // first, so an endpoint that also happens to cross claims its edge as the
  // arrival it is rather than as a pass-through.
  const endpoints = line.length < 2 ? [] : [0, line.length - 1];
  for (const index of endpoints) {
    const end = line[index]!;
    let best:
      | { readonly run: PathRun; readonly step: number; readonly edgeId: string; readonly along: number; readonly perp: number }
      | undefined;
    for (const run of standing) {
      const spine = run.spine;
      if (spine === undefined) continue;
      const reach = reachOf(run) + ownReach;
      if (reach <= 0) continue;
      for (let step = 0; step + 1 < spine.nodes.length; step += 1) {
        const edgeId = spine.edgeIds[step];
        if (edgeId === undefined || usedEdges.has(edgeId)) continue;
        const { t, perp } = projectOntoLineXZ(end, spine.nodes[step]!.position, spine.nodes[step + 1]!.position);
        if (perp > reach || t < 0 || t > 1) continue;
        if (best === undefined || perp < best.perp) best = { run, step, edgeId, along: t, perp };
      }
    }
    if (best !== undefined) record(best.run, best.step, best.edgeId, best.along, index, index);
  }

  for (const run of standing) {
    const spine = run.spine;
    if (spine === undefined) continue;
    for (let step = 0; step + 1 < spine.nodes.length; step += 1) {
      const edgeId = spine.edgeIds[step];
      if (edgeId === undefined || usedEdges.has(edgeId)) continue;
      const fromA = spine.nodes[step]!;
      const toA = spine.nodes[step + 1]!;
      for (let index = 0; index + 1 < line.length; index += 1) {
        const crossing = segmentCrossingXZ(fromA.position, toA.position, line[index]!, line[index + 1]!);
        if (crossing === undefined) continue;
        record(run, step, edgeId, crossing.along, index + crossing.across);
        break;
      }
    }
  }
  if (found.length === 0 && arrivals.size === 0) {
    return { line, welds: new Map(), inserts: [], joined: [] };
  }

  const ordered = [...found].sort((left, right) => left.at - right.at);
  const spliced: ConstructionPosition[] = [];
  const welds = new Map<number, ConstructionNodeId>();

  const near = (left: ConstructionPosition, right: ConstructionPosition): boolean =>
    Math.hypot(left.x - right.x, left.z - right.z) < STATION_MERGE_DISTANCE;

  /**
   * A crossing becomes a station -- but moves the neighbouring one onto
   * itself when that one is close enough, rather than standing beside it.
   *
   * Two stations a few centimetres apart make a band of almost no length,
   * which is a sliver face running along the contour. The crossing is the
   * station that matters, so it wins the position and the neighbour gives way.
   */
  const pushCrossing = (crossing: { readonly position: ConstructionPosition; readonly nodeId: ConstructionNodeId }): void => {
    const previous = spliced[spliced.length - 1];
    if (previous !== undefined && near(previous, crossing.position)) {
      spliced[spliced.length - 1] = crossing.position;
      welds.set(spliced.length - 1, crossing.nodeId);
      return;
    }
    welds.set(spliced.length, crossing.nodeId);
    spliced.push(crossing.position);
  };

  /** A drawn station, unless a crossing has already claimed that spot. */
  const pushStation = (station: ConstructionPosition): void => {
    const previous = spliced[spliced.length - 1];
    if (previous !== undefined && welds.has(spliced.length - 1) && near(previous, station)) return;
    spliced.push(station);
  };

  let next = 0;
  for (let index = 0; index < line.length; index += 1) {
    while (next < ordered.length && ordered[next]!.at < index) {
      pushCrossing(ordered[next]!);
      next += 1;
    }
    // An arrival replaces the drawn end: the road has to reach the spine it
    // joins, so the station moves onto it rather than one being added beside.
    const arrival = arrivals.get(index);
    if (arrival !== undefined) pushCrossing(arrival);
    else pushStation(line[index]!);
  }
  while (next < ordered.length) {
    pushCrossing(ordered[next]!);
    next += 1;
  }

  const ops: AtomicEditOp[] = inserts.map((insert) => ({
    kind: "insert-vertex",
    edgeId: insert.edgeId,
    nodeId: insert.nodeId,
    position: insert.position,
    firstEdgeId: `${insert.edgeId}|${insert.nodeId}|0`,
    secondEdgeId: `${insert.edgeId}|${insert.nodeId}|1`,
  }));
  const touched = new Set(joinedCorridors);
  return {
    line: spliced,
    welds,
    inserts: ops,
    joined: standing.filter((run) => touched.has(run.corridorId)),
  };
}

/**
 * Fuses this run's outer contours into the contours of the runs it joined.
 *
 * The spine join already made the two runs one graph -- they share a node on
 * the travel line -- but their rims still passed straight through each other,
 * each leaving a loose end sitting inside the other road bounding nothing.
 * That is the mess: a contour crossing a contour without fusing.
 *
 * The rule, and it is the same rule in every case the owner set out:
 *
 * - **L.** Two runs meeting end to end. Each rim runs on in the direction its
 *   own spine gave it until it reaches the other rim, and there they fuse.
 * - **T.** A run arriving in the flank of another. The arrival necessarily
 *   overlaps outside, and that overlap is where the rims fuse; the two ends
 *   left loose inside the other road are cut. Only the crossings fuse, so the
 *   mouth of the T stays open and the junction never closes into a triangle.
 * - **X.** The same rule, at each place the rims actually cross.
 *
 * All three are one operation, because the loose end and the meeting point
 * are the same event seen twice: the rim's last point moves onto the crossing
 * and takes the standing rim's newly split node as its own. Cutting the stub
 * and joining the rims is a single move, and nothing has to decide which
 * shape a junction "is".
 *
 * Positions come back as a fresh vertex list rather than as an edit, because
 * this run has not been committed yet -- the sweep proposed where its rim
 * went, and the junction is what disposes.
 */
export function fuseContoursWithStandingRuns(
  plan: ConstructionSweepPlan,
  profileLength: number,
  spineSlot: number,
  joined: readonly PathRun[],
): {
  readonly vertices: readonly ConstructionPosition[];
  /** Nodes this run must reuse, keyed `${station}:${across}`. */
  readonly welds: ReadonlyMap<string, ConstructionNodeId>;
  readonly inserts: readonly AtomicEditOp[];
} {
  const vertices = [...plan.vertices];
  const welds = new Map<string, ConstructionNodeId>();
  const inserts: AtomicEditOp[] = [];
  if (joined.length === 0 || profileLength < 3) return { vertices, welds, inserts };

  const stationCount = Math.floor(vertices.length / profileLength);
  const at = (station: number, across: number): number =>
    station * profileLength + across + spineSlot;
  const outerSlots = [...new Set([-spineSlot, profileLength - 1 - spineSlot])].filter(
    (across) => across !== 0,
  );
  // One split per standing edge per commit, exactly as a spine crossing is
  // capped: the second would name an edge the first has already replaced.
  const splitEdges = new Set<string>();

  for (const across of outerSlots) {
    for (const run of joined) {
      if (run.contours.length < 2) continue;
      const footprint = footprintOf(
        run.contours[0]!.nodes.map((node) => node.position),
        run.contours[1]!.nodes.map((node) => node.position),
      );
      for (const chain of run.contours) {
        const own = {
          points: Array.from({ length: stationCount }, (_unused, station) => vertices[at(station, across)]!),
          edgeIds: [],
        };
        const standing = {
          points: chain.nodes.map((node) => node.position),
          edgeIds: chain.edgeIds,
        };
        for (const fusion of contourFusionsAgainst(own, standing, footprint)) {
          const key = `${fusion.ownIndex}:${across}`;
          if (splitEdges.has(fusion.edgeId) || welds.has(key)) continue;
          const from = chain.nodes[fusion.standingIndex]!;
          const to = chain.nodes[fusion.standingIndex + 1]!;
          const station = Number(
            (from.station + (to.station - from.station) * fusion.along).toFixed(3),
          );
          const nodeId = stationNodeId(run.corridorId, station, chain.across);
          splitEdges.add(fusion.edgeId);
          welds.set(key, nodeId);
          vertices[at(fusion.ownIndex, across)] = fusion.position;
          inserts.push({
            kind: "insert-vertex",
            edgeId: fusion.edgeId,
            nodeId,
            position: fusion.position,
            firstEdgeId: `${fusion.edgeId}|${nodeId}|0`,
            secondEdgeId: `${fusion.edgeId}|${nodeId}|1`,
          });
        }
      }
    }
  }
  return { vertices, welds, inserts };
}

/**
 * Which covered faces this run *joins* rather than replaces.
 *
 * The rule the owner set, and it reads off the thing a run is built around:
 * a face is joined when the new footprint reaches the travel line of the run
 * that face belongs to. Overlapping a road's shoulder is not meeting it;
 * reaching its spine is.
 *
 * Joined faces are left out of the overlay's sources, so they are not
 * consumed -- which is the whole point. A path replacing a path is what made
 * one carriageway erase another instead of the two meeting.
 */
function joinedCoveredKeys(
  ctx: ToolContext,
  outline: readonly (readonly [number, number])[],
  covered: readonly ConstructionCoveredRegion[],
): ReadonlySet<string> {
  const joined = new Set<string>();
  if (outline.length < 3) return joined;
  const polygon = outline.map(([x, z]) => ({ x, y: 0, z }));

  const positions = new Map<string, ConstructionPosition>();
  for (const topology of ctx.runtime.getAllRegionTopologies()) {
    for (const node of topology.nodes) positions.set(node.id, node.position);
  }

  for (const region of covered) {
    if (region.surfaceType !== "path") continue;
    const touchesSpine = region.nodeIds.some((nodeId) => {
      if (parseStationNodeId(nodeId)?.across !== 0) return false;
      const position = positions.get(nodeId);
      return position !== undefined && pointInPolygonXZ(position, polygon);
    });
    if (touchesSpine) joined.add(region.surfaceKey.join(":"));
  }
  return joined;
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
  // A crossing is made, not found: the crossed spine is split so a node
  // exists for both runs to reference. Whatever still lands exactly on a
  // standing node is welded to it directly.
  const crossed = junctionsWithStandingSpines(ctx, drawn, pathHalfWidth(params));
  const exact = weldedToStandingSpines(ctx, crossed.line, SPINE_WELD_TOLERANCE);
  const referenceLine = exact.line;
  const welds = new Map([...crossed.welds, ...exact.welds]);

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
    const spineSlot = pathSpineSlot(profile);
    const plan = ctx.runtime.planPathFormation(effect);
    // The sweep drops a station only where two coincide, which the reference
    // line already rules out. Were one dropped anyway the indices would no
    // longer line up, so the run commits unwelded rather than welded to the
    // wrong place.
    const aligned = plan.referenceLine.length === referenceLine.length;
    // Now that the rim exists, fuse it into the rims of the runs this one
    // joined: a shared spine node without shared contour nodes is two roads
    // drawn over each other, not a junction.
    const fused = fuseContoursWithStandingRuns(plan, profile.length, spineSlot, aligned ? crossed.joined : []);
    const spineWelds = new Map<string, ConstructionNodeId>();
    if (aligned) for (const [station, nodeId] of welds) spineWelds.set(`${station}:0`, nodeId);
    const formation = pathPatch(
      ctx.tableId,
      pathCorridorId(effect.operationId, params.pathKind),
      effect.targetType,
      { ...plan, vertices: fused.vertices },
      profile.length,
      spineSlot,
      new Map([...spineWelds, ...fused.welds]),
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
    // A run that reaches another run's spine *meets* it. Leaving those faces
    // out of the sources is what stops one carriageway from erasing the
    // other: they are not consumed, so the crossed run keeps its own bands
    // and, with them, its own travel line.
    const joined = joinedCoveredKeys(
      ctx,
      formation.outline,
      resolved.map((entry) => entry.covered),
    );
    const sourceSurfaceKeys = resolved
      .filter((entry) => entry.interaction.kind === "cut")
      .filter((entry) => !joined.has(entry.covered.surfaceKey.join(":")))
      .map((entry) => entry.covered.surfaceKey);

    // Split only once the commit is going through: both the spine node a
    // crossing needs and the rim nodes a fusion needs are made by cutting
    // edges of runs already standing, and a refusal above would otherwise
    // leave those cuts behind with nothing referencing them.
    const splits = [...crossed.inserts, ...fused.inserts];
    if (splits.length > 0) {
      ctx.runtime.applyRegionEdit(splits, "local", operationId);
    }

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
