import type {
  AtomicEditOp,
  BrushShape,
  PathBrushParams,
  PathRun,
  PathRunChain,
} from "@/features/edit-construction";
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
import { sharedEdgeId } from "../core/boundary-edges.ts";
import { fitPath, type FittedEdge } from "../core/stroke-fitting.ts";
import { sweepFormation, type SweptArc } from "../core/sweep-formation.ts";
import {
  distanceToSegmentXZ,
  pointInPolygonXZ,
  projectOntoLineXZ,
  segmentCrossingXZ,
} from "../shapes/geometry-2d.ts";
import {
  contourCrossingsAgainst,
  contourFusionsAgainst,
  footprintOf,
  mitrePoint,
  sideOf,
} from "../core/contour-fusion.ts";
import { pathPatch } from "./path-patch.ts";
import {
  spineSplitOps,
  throughCrossings,
  withStationsAt,
  type SpineSplit,
} from "./path-crossing.ts";
import { junctionRemovals, junctionWedges, patchRestoring } from "./path-junction.ts";
import { inStage, reportToolFailure, reportToolWarning } from "../core/tool-diagnostics.ts";

export const PATH_COLOR = 0xc084fc;

/** What this tool calls itself on the console when a stage fails. */
const TOOL = "path-brush";


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
 * A corner has to become a station whatever the walk decides, or the road
 * cuts straight across it; an arc sample is only sampling, and the walk is
 * free to place stations wherever it likes along it.
 *
 * `arc` is the curve the run is *on* as it leaves this point. It is what
 * makes a curved road curved rather than finely chopped: sampling decides
 * where the stations go, and the arc says what runs between them, so the
 * graph stores the curve the fit actually found instead of the chords that
 * happened to approximate it.
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
 * The reference line to sweep along: where the fit decided the road goes,
 * at the height the ground was actually picked at.
 *
 * Arc flattening here is temporary and deliberately kept in one place so it
 * is obvious what to delete -- `sweepFormation` only samples a polyline, so a
 * true arc has no way to reach it intact. Until it accepts contour geometry,
 * a curve is handed over as chords close enough that the difference is
 * invisible, which is still a world apart from handing over the raw hand.
 * Now that the sweep is on this side, teaching it arcs is a local change.
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
    // Two stations at one spot would be dropped by the sweep, sliding every
    // later station's index and breaking the weld bookkeeping below.
    if (Math.hypot(x - previous.x, z - previous.z) < 1e-4) return;
    line.push({ x, y: heightAt(x, z), z });
    arcs.push(arc);
  };

  // Every point the fit itself produced is a station: a corner because the
  // run genuinely turns there, an arc sample because the outline handed to
  // the coverage query is a polygon and has to follow the curve even though
  // the edges between these points are true arcs.
  //
  // What is *not* automatic any more is anything between them. A stretch gets
  // extra stations only where the ground under it strays from the straight
  // line the stretch would otherwise be -- so a straight road over flat
  // ground is two stations, and a straight road over a ridge is exactly as
  // many as the ridge needs.
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
 * How close to an end of a spine edge counts as *being* that end.
 *
 * Expressed as a fraction of the edge, because what matters is whether the
 * meeting point is distinguishable from the station already standing there.
 * Below this it is not, and splitting would mint a second node on top of the
 * first -- with an id derived from the same station, so the same id.
 */
const END_OF_EDGE = 1e-4;

/**
 * How close (world units, XZ) a crossing may fall to a station already on the
 * run before the two are treated as one.
 *
 * A quarter of the station step. Closer than this and keeping both would
 * declare a band of almost no length -- the sliver faces that ran along the
 * contour when crossings were first spliced in blindly.
 */
const STATION_MERGE_DISTANCE = 0.5;

/**
 * How near a station a crossing must fall to be treated as being *at* it,
 * as a fraction of the gap between two stations.
 *
 * A pass-through corner is only ever as good as the station under it, and
 * the station is put there on purpose -- so this is a check that the
 * preparation actually happened, not a tolerance to lean on. A crossing
 * further off than this is left unclosed rather than dragging a station
 * sideways across the road.
 */
const CROSSING_STATION_TOLERANCE = 0.05;

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

/** One arrival that welded onto a station already standing. */
export interface SpineJoin {
  readonly run: PathRun;
  /** Index into the committed reference line where the two meet. */
  readonly at: number;
  readonly nodeId: ConstructionNodeId;
  readonly position: ConstructionPosition;
  /** Which station of the standing run that was. */
  readonly standingIndex: number;
  /** Whether that station is an end of the standing run rather than a middle. */
  readonly terminal: boolean;
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
   * The same cuts as `inserts`, before they were turned into edits.
   *
   * Reported as well as applied because a crossing adds cuts of its own to
   * the very same spine edges, and several cuts of one edge only work when
   * they are ordered together -- the second cut is a cut of a half the first
   * one made. An edit already built cannot be reordered; the fact it was
   * built from can.
   */
  readonly splits: readonly SpineSplit[];
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
  /**
   * Arrivals that landed on a station already standing.
   *
   * Kept apart from the rest because they are the only ones whose rims can be
   * mitred: a run meeting another *at a station* shares that station's whole
   * cross-section, so the two terminal ribs can become one. An arrival that
   * split an edge mid-run is a T, and a T needs a face this does not build.
   */
  readonly terminals: readonly SpineJoin[];
  /**
   * Where each station of the committed line came from in the drawn one, or
   * `-1` for a station this made up.
   *
   * A junction splices stations in and slides others onto meeting points, so
   * afterwards nothing can be matched to the drawn line by position in it.
   * Anything that was derived per drawn station -- which curve a stretch
   * runs on, above all -- needs this to survive the splice, and comparing
   * array identity does not work: every step here rebuilds the array whether
   * or not it changed anything.
   */
  readonly origins: readonly number[];
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
  const inserts: SpineSplit[] = [];

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
  /** Arrivals that welded to a station already standing, rather than splitting. */
  const terminals: SpineJoin[] = [];

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
    // Landing on an end of the edge is not a split; it is arriving at the
    // station that is already there. Minting one anyway asks for a node id
    // that already exists, and names one half of the "split" after the very
    // edge being split -- which the graph refuses, taking the stroke with it.
    const atEnd =
      along <= END_OF_EDGE ? fromA : along >= 1 - END_OF_EDGE ? toA : undefined;
    const station = Number((fromA.station + (toA.station - fromA.station) * along).toFixed(3));
    const nodeId = atEnd?.nodeId ?? stationNodeId(run.corridorId, station, 0);
    usedEdges.add(edgeId);
    joinedCorridors.add(run.corridorId);
    if (atEnd !== undefined) {
      const met = { position: atEnd.position, nodeId: atEnd.nodeId };
      if (arrivalIndex !== undefined) arrivals.set(arrivalIndex, met);
      else found.push({ at, ...met, edgeId });
      terminals.push({
        run,
        at: arrivalIndex ?? Math.round(at),
        nodeId: atEnd.nodeId,
        position: atEnd.position,
        standingIndex: atEnd === fromA ? step : step + 1,
        terminal:
          (atEnd === fromA && step === 0) || (atEnd === toA && step + 2 === spine.nodes.length),
      });
      return;
    }
    if (arrivalIndex !== undefined) {
      arrivals.set(arrivalIndex, { position, nodeId });
      inserts.push({ nodeId, position, edgeId, along, startNodeId: fromA.nodeId, endNodeId: toA.nodeId });
      return;
    }
    found.push({ at, position, nodeId, edgeId });
    inserts.push({ nodeId, position, edgeId, along, startNodeId: fromA.nodeId, endNodeId: toA.nodeId });
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
        const from = spine.nodes[step]!.position;
        const to = spine.nodes[step + 1]!.position;
        const { t } = projectOntoLineXZ(end, from, to);
        // Clamped, not rejected. An end drawn a little *past* another run's
        // last station is the commonest way an L is drawn, and measuring
        // against the infinite line threw it away for overshooting by
        // centimetres -- which is most of why two runs would not bend into
        // one another at all.
        const along = Math.min(1, Math.max(0, t));
        const distance = distanceToSegmentXZ(end, from, to);
        if (distance > reach) continue;
        if (best === undefined || distance < best.perp) best = { run, step, edgeId, along, perp: distance };
      }
    }
    if (best === undefined) continue;
    // Landing on a station that already exists welds to it rather than
    // splitting the edge beside it. This is `resolveColumn`'s first case, and
    // without it an L minted a second node a few centimetres from the one it
    // meant to meet, leaving a hair-thin edge and two runs that only looked
    // joined.
    const spine = best.run.spine!;
    const nearIndex = best.along <= 0.5 ? best.step : best.step + 1;
    const near = spine.nodes[nearIndex]!;
    // Where the stroke actually meets the run, which is the clamped point --
    // an end drawn past the run meets it *at its end*. Measuring the
    // unclamped projection instead reported a distance the run does not
    // have, so an overshoot fell through to a split at `along` exactly 1.
    const from = spine.nodes[best.step]!.position;
    const to = spine.nodes[best.step + 1]!.position;
    const landing = {
      x: from.x + (to.x - from.x) * best.along,
      z: from.z + (to.z - from.z) * best.along,
    };
    const toNear = Math.hypot(landing.x - near.position.x, landing.z - near.position.z);
    if (toNear < STATION_MERGE_DISTANCE) {
      usedEdges.add(best.edgeId);
      joinedCorridors.add(best.run.corridorId);
      arrivals.set(index, { position: near.position, nodeId: near.nodeId });
      terminals.push({
        run: best.run,
        at: index,
        nodeId: near.nodeId,
        position: near.position,
        standingIndex: nearIndex,
        terminal: nearIndex === 0 || nearIndex === spine.nodes.length - 1,
      });
      continue;
    }
    record(best.run, best.step, best.edgeId, best.along, index, index);
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
    return {
      line,
      welds: new Map(),
      inserts: [],
      splits: [],
      joined: [],
      terminals,
      origins: line.map((_station, index) => index),
    };
  }

  const ordered = [...found].sort((left, right) => left.at - right.at);
  const spliced: ConstructionPosition[] = [];
  /** The drawn station each spliced one came from; `-1` for a minted one. */
  const origins: number[] = [];
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
      origins[origins.length - 1] = -1;
      welds.set(spliced.length - 1, crossing.nodeId);
      return;
    }
    welds.set(spliced.length, crossing.nodeId);
    spliced.push(crossing.position);
    origins.push(-1);
  };

  /** A drawn station, unless a crossing has already claimed that spot. */
  const pushStation = (station: ConstructionPosition, from: number): void => {
    const previous = spliced[spliced.length - 1];
    if (previous !== undefined && welds.has(spliced.length - 1) && near(previous, station)) return;
    spliced.push(station);
    origins.push(from);
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
    else pushStation(line[index]!, index);
  }
  while (next < ordered.length) {
    pushCrossing(ordered[next]!);
    next += 1;
  }

  // The halves are named after the pairs of nodes they run between, exactly
  // as a declared edge is. A face built later over one of those pairs then
  // finds the edge already standing instead of laying a second one beside it,
  // which is the whole reason a junction can share a spine seam at all.
  const ops = spineSplitOps(ctx.tableId, inserts);
  const touched = new Set(joinedCorridors);
  return {
    line: spliced,
    welds,
    inserts: ops,
    splits: inserts,
    joined: standing.filter((run) => touched.has(run.corridorId)),
    terminals,
    origins,
  };
}

/**
 * The direction a curve runs at one of its points, pointed the way `towards`
 * already goes.
 *
 * A tangent has two directions and the geometry does not say which one is
 * "onwards"; the chord to the next station does, and it is never more than
 * half a station's worth of angle away from the right one.
 */
function tangentAt(
  at: ConstructionPosition,
  arc: SweptArc,
  towards: { readonly x: number; readonly z: number },
): { readonly x: number; readonly z: number } {
  const dx = at.x - arc.center[0];
  const dz = at.z - arc.center[1];
  const radius = Math.hypot(dx, dz);
  if (radius < 1e-9) return towards;
  const tangent = { x: -dz / radius, z: dx / radius };
  const forward = tangent.x * towards.x + tangent.z * towards.z >= 0;
  return forward ? tangent : { x: -tangent.x, z: -tangent.z };
}

/**
 * Mitres this run's end rib into the end rib of a run it met at a station.
 *
 * The L, and the only junction shape that needs no junction face at all.
 * Both runs stop at the same station, so their cross-sections there are the
 * same cut of the road, and the two ribs are not two ribs: they are one,
 * running between the two places the outer rims meet. Each rim keeps the
 * direction its own spine gave it until it reaches its opposite number, and
 * that meeting point is the corner -- the outside of the bend meets ahead,
 * the inside behind, and both are the same intersection.
 *
 * The join is made by *identity*, as everything else here is. The standing
 * run's rim node is moved onto the corner and the run being committed welds
 * its own rim node to it, so the rib edge between corner and spine is named
 * from the same pair of nodes on both sides and is therefore literally the
 * same edge. Two faces to an edge is exactly what `refuse-when-full` allows,
 * and it is how a wall shares a column.
 *
 * Pairing the sides needs no case analysis either. One run's direction points
 * out of the joint and the other's points into it, so two rims lie on the
 * same hand of a traveller passing through precisely when `sideOf` gives them
 * opposite signs.
 */
export function mitreTerminalRibs(
  plan: ConstructionSweepPlan,
  profileLength: number,
  spineSlot: number,
  joins: readonly SpineJoin[],
  /** The curve each span of this run follows, so a curved end mitres on its
   * true tangent rather than on the chord to its neighbouring station. */
  arcs: readonly (SweptArc | undefined)[] = [],
): {
  readonly vertices: readonly ConstructionPosition[];
  readonly welds: ReadonlyMap<string, ConstructionNodeId>;
  readonly moves: readonly AtomicEditOp[];
} {
  const vertices = [...plan.vertices];
  const welds = new Map<string, ConstructionNodeId>();
  const moves: AtomicEditOp[] = [];
  if (joins.length === 0 || profileLength < 3) return { vertices, welds, moves };

  const stationCount = Math.floor(vertices.length / profileLength);
  const at = (station: number, across: number): number =>
    station * profileLength + across + spineSlot;
  const outerSlots = [...new Set([-spineSlot, profileLength - 1 - spineSlot])].filter(
    (across) => across !== 0,
  );
  const direction = (from: ConstructionPosition, to: ConstructionPosition) => {
    const length = Math.hypot(to.x - from.x, to.z - from.z);
    if (length < 1e-9) return undefined;
    return { x: (to.x - from.x) / length, z: (to.z - from.z) / length };
  };
  /** The node a chain carries at one end of its run. */
  const endOf = (chain: PathRunChain, first: boolean) =>
    first ? chain.nodes[0] : chain.nodes[chain.nodes.length - 1];

  for (const join of joins) {
    // Only an end of *this* run can be mitred: a rib in the middle of a run
    // has road on both sides of it and cannot be rotated onto anything.
    if (!join.terminal || (join.at !== 0 && join.at !== stationCount - 1)) continue;
    const inward = join.at === 0 ? 1 : stationCount - 2;
    if (inward < 0 || inward >= stationCount) continue;

    const spine = join.run.spine;
    if (spine === undefined || spine.nodes.length < 2 || join.run.contours.length < 2) continue;
    const standingFirst = join.standingIndex === 0;
    const standingNext = standingFirst ? spine.nodes[1] : spine.nodes[spine.nodes.length - 2];
    if (standingNext === undefined) continue;

    // Leaving the joint along the road, which on a curve is the tangent
    // there. A chord to the next station leans into the bend by half the
    // angle it subtends, and the corner would be built on that lean.
    const endArc = join.at === 0 ? arcs[0] : arcs[stationCount - 2];
    const chord = direction(vertices[at(join.at, 0)]!, vertices[at(inward, 0)]!);
    const outward =
      chord === undefined || endArc === undefined
        ? chord
        : tangentAt(vertices[at(join.at, 0)]!, endArc, chord);
    const standingOut = direction(join.position, standingNext.position);
    if (outward === undefined || standingOut === undefined) continue;

    for (const across of outerSlots) {
      const ownRim = vertices[at(join.at, across)]!;
      const ownSide = sideOf(join.position, outward, ownRim);
      const paired = join.run.contours
        .map((chain) => endOf(chain, standingFirst))
        .find(
          (node) =>
            node !== undefined && sideOf(join.position, standingOut, node.position) === -ownSide,
        );
      if (paired === undefined) continue;

      const halfWidth = Math.max(
        Math.hypot(ownRim.x - join.position.x, ownRim.z - join.position.z),
        Math.hypot(paired.position.x - join.position.x, paired.position.z - join.position.z),
      );
      const corner = mitrePoint(
        join.position,
        ownRim,
        outward,
        paired.position,
        standingOut,
        halfWidth,
      );
      vertices[at(join.at, across)] = corner;
      welds.set(`${join.at}:${across}`, paired.nodeId);
      moves.push({ kind: "move-vertex", nodeId: paired.nodeId, position: corner });
    }
  }
  return { vertices, welds, moves };
}

/**
 * Where the run being committed opens into a run already standing.
 *
 * A T, seen from the arriving side. The arriving run stops at a spine node in
 * the middle of the standing run, so its end rib cannot be mitred -- that rib
 * has road on both sides of it and cannot be rotated onto anything. What can
 * be said is where its two rims cross the standing rim, and those two points
 * are the **mouth**: the opening the arriving road makes in the flank of the
 * standing one.
 *
 * Reported rather than acted on, because closing a mouth is not an edit to
 * this run at all -- it is a rebuild of the standing run's faces around the
 * hole, which `junctionWedges` does.
 */
export interface PathMouthSide {
  /** This run's own slot, so its corner node can be named. */
  readonly across: number;
  /**
   * This run's own station the corner belongs to.
   *
   * Per side rather than per mouth because the two sides need not meet the
   * standing rim at the same station: a road ending in a T meets it with one
   * cross-section, but a road crossing clean through meets each rim at
   * whatever station its own rim happens to reach it, and the two are only
   * equal when the crossing is square.
   */
  readonly station: number;
  readonly position: ConstructionPosition;
  /**
   * The node on the standing spine this side's bend closes on.
   *
   * Per side rather than per mouth. A road that ends on another closes both
   * its bends on the one node its spine welded at; a road running clean
   * through closes each bend where its own rim crosses the standing spine,
   * and those are two nodes with the whole crossing between them.
   */
  readonly pivotNodeId: ConstructionNodeId;
  /**
   * Roughly where the corner falls on the standing run's station scale.
   *
   * For ordering the two corners along the rim, and nothing else. Anything
   * that has to *find* something on the standing run locates it by position
   * instead: a station number is not a coordinate system a later junction
   * leaves alone, since splitting a spine mints fractional ones.
   */
  readonly standingStation: number;
}

export interface PathMouth {
  readonly run: PathRun;
  /** The slot of the standing rim the mouth opens through. */
  readonly through: number;
  /** This run's end station, the one whose rib became the mouth. */
  readonly station: number;
  readonly sides: readonly PathMouthSide[];
}

/**
 * Cuts this run's end rib back onto the rim of the run it arrived at, and
 * reports the mouth that leaves.
 *
 * The rim keeps the direction its own spine gave it until it reaches the
 * standing rim, which is the same rule the mitre follows -- an arrival is
 * still two L bends, one per side. What differs is only that a T bends into
 * the *middle* of a rim rather than into its end, so the two corners are not
 * nodes the standing run already has, and the faces behind them have to be
 * rebuilt rather than nudged.
 */
export function pathMouthsInto(
  plan: ConstructionSweepPlan,
  profileLength: number,
  spineSlot: number,
  joined: readonly PathRun[],
  /**
   * The nodes this run has already welded onto runs already standing, keyed
   * `${station}:${across}` -- the same addressing `pathPatch` welds by.
   *
   * A mouth is only half a junction without them: a piece of rebuilt flank
   * has to close on a node the two runs share, and which node that is, is a
   * fact about what was welded rather than anything a position can answer.
   */
  welds: ReadonlyMap<string, ConstructionNodeId> = new Map(),
): {
  readonly vertices: readonly ConstructionPosition[];
  readonly mouths: readonly PathMouth[];
} {
  const vertices = [...plan.vertices];
  if (joined.length === 0 || profileLength < 3) return { vertices, mouths: [] };

  const stationCount = Math.floor(vertices.length / profileLength);
  const at = (station: number, across: number): number =>
    station * profileLength + across + spineSlot;
  const outerSlots = [...new Set([-spineSlot, profileLength - 1 - spineSlot])].filter(
    (across) => across !== 0,
  );
  const mouths: PathMouth[] = [];

  for (const run of joined) {
    if (run.contours.length < 2) continue;
    const spine = run.spine;
    const footprint = footprintOf(
      run.contours[0]!.nodes.map((node) => node.position),
      run.contours[1]!.nodes.map((node) => node.position),
    );
    for (const chain of run.contours) {
      const standing = {
        points: chain.nodes.map((node) => node.position),
        edgeIds: chain.edgeIds,
      };
      /** Where a point of the standing chain falls on its own station scale. */
      const standingStationAt = (index: number, along: number): number => {
        const from = chain.nodes[index]!;
        const to = chain.nodes[index + 1]!;
        return from.station + (to.station - from.station) * along;
      };
      const sides: PathMouthSide[] = [];
      for (const across of outerSlots) {
        const own = {
          points: Array.from(
            { length: stationCount },
            (_unused, index) => vertices[at(index, across)]!,
          ),
          edgeIds: [],
        };

        // An arrival: this run stops inside the standing one, so its rim has
        // a loose end to pull onto the meeting point. Both bends of it close
        // on the single spine node the two runs welded at.
        const [fusion] = contourFusionsAgainst(own, standing, footprint);
        if (fusion !== undefined) {
          const pivotNodeId = welds.get(`${fusion.ownIndex}:0`);
          if (pivotNodeId === undefined) continue;
          vertices[at(fusion.ownIndex, across)] = fusion.position;
          sides.push({
            across,
            station: fusion.ownIndex,
            position: fusion.position,
            standingStation: standingStationAt(fusion.standingIndex, fusion.along),
            pivotNodeId,
          });
          continue;
        }

        // A pass-through: the rim runs clean across, so there is no end to
        // move and the corner has to be a station of this run's own -- put
        // there before the sweep, by `throughCrossingStations`. Without one
        // the crossing is left alone, which is what happened to every
        // crossing before this: two rims through each other and no junction.
        if (spine === undefined) continue;
        const crossing = contourCrossingsAgainst(own, standing)[0];
        if (crossing === undefined) continue;
        const station = Math.round(crossing.at);
        if (Math.abs(crossing.at - station) > CROSSING_STATION_TOLERANCE) continue;

        // The bend closes where this same rim crosses the standing *spine*,
        // not where the other rim does: the piece being rebuilt runs along
        // this rim, and a contour never reaches across the road to the far
        // one. That node is shared with the standing spine, which is why it
        // has to have been welded rather than merely computed.
        const onSpine = contourCrossingsAgainst(own, {
          points: spine.nodes.map((node) => node.position),
          edgeIds: spine.edgeIds,
        })
          .map((candidate) => ({ candidate, distance: Math.abs(candidate.at - crossing.at) }))
          .sort((left, right) => left.distance - right.distance)[0]?.candidate;
        if (onSpine === undefined) continue;
        const pivotStation = Math.round(onSpine.at);
        if (Math.abs(onSpine.at - pivotStation) > CROSSING_STATION_TOLERANCE) continue;
        const pivotNodeId = welds.get(`${pivotStation}:${across}`);
        if (pivotNodeId === undefined) continue;

        // Snapped onto the rim it crosses. The station was put here for this
        // and is a hair away already, so the road keeps its shape and the
        // corner lands exactly on the standing rim instead of near it.
        vertices[at(station, across)] = crossing.position;
        sides.push({
          across,
          station,
          position: crossing.position,
          standingStation: standingStationAt(crossing.standingIndex, crossing.along),
          pivotNodeId,
        });
      }
      // One side alone is a graze, not a mouth: an opening needs two corners,
      // and rebuilding the flank around half of one would leave it open.
      if (sides.length < 2) continue;
      mouths.push({
        run,
        through: chain.across,
        station: Math.min(...sides.map((side) => side.station)),
        sides: [...sides].sort((left, right) => left.standingStation - right.standingStation),
      });
    }
  }
  return { vertices, mouths };
}

/**
 * Which covered faces this run *joins* rather than replaces.
 *
 * Joined faces are left out of the overlay's sources, so they are not
 * consumed -- which is the whole point. A path replacing a path is what made
 * one carriageway erase another instead of the two meeting.
 *
 * **Asked by identity first.** A run that welded a node onto another run's
 * spine has joined that run, and every face of it, full stop; whether the
 * new footprint happens to swallow one of its spine nodes is beside the
 * point. Geometry was the only question available before junctions were
 * built, and it stopped being safe the moment a junction started cutting the
 * arriving road back at the rim: the footprint no longer reaches the other
 * road's travel line, so the purely geometric answer became "cut" for the
 * very runs this one had just joined -- and consuming those bands takes the
 * crossed run's spine with them.
 *
 * The geometric rule stays for the case identity cannot see: a footprint
 * laid over a run's travel line without any junction having been made.
 */
export function joinedCoveredKeys(
  ctx: ToolContext,
  outline: readonly (readonly [number, number])[],
  covered: readonly ConstructionCoveredRegion[],
  joinedCorridors: ReadonlySet<string>,
): ReadonlySet<string> {
  const joined = new Set<string>();
  const polygon = outline.map(([x, z]) => ({ x, y: 0, z }));

  const positions = new Map<string, ConstructionPosition>();
  for (const topology of ctx.runtime.getAllRegionTopologies()) {
    for (const node of topology.nodes) positions.set(node.id, node.position);
  }

  for (const region of covered) {
    if (region.surfaceType !== "path") continue;
    const belongsToJoined = region.nodeIds.some((nodeId) => {
      const corridor = parseStationNodeId(nodeId)?.operationId;
      return corridor !== undefined && joinedCorridors.has(corridor);
    });
    const touchesSpine =
      polygon.length >= 3 &&
      region.nodeIds.some((nodeId) => {
        if (parseStationNodeId(nodeId)?.across !== 0) return false;
        const position = positions.get(nodeId);
        return position !== undefined && pointInPolygonXZ(position, polygon);
      });
    if (belongsToJoined || touchesSpine) joined.add(region.surfaceKey.join(":"));
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
  const swept =
    fitted.length === 0
      ? { line: stroke, arcs: [] as readonly (SweptArc | undefined)[] }
      : referenceLineFrom(fitted, stroke, pathRidesTerrain(params.pathKind));
  const drawn = swept.line;
  if (drawn.length === 0) return;
  // A crossing is made, not found: the crossed spine is split so a node
  // exists for both runs to reference. Whatever still lands exactly on a
  // standing node is welded to it directly.
  const crossed = junctionsWithStandingSpines(ctx, drawn, pathHalfWidth(params));
  const exact = weldedToStandingSpines(ctx, crossed.line, SPINE_WELD_TOLERANCE);
  const referenceLine = exact.line;
  const welds = new Map([...crossed.welds, ...exact.welds]);
  // Which stretches are still on the curve the fit found. A stretch keeps its
  // curve only when both its ends are drawn stations that were consecutive
  // before the junction spliced anything in -- a minted station sits on a
  // chord, not on the circle, and an arc through it would be an arc through
  // the wrong points. The exact weld above is left out of this on purpose:
  // its tolerance is a millimetre, which is coincidence, not movement.
  const committedArcs = referenceLine.slice(0, -1).map((_station, index) => {
    const from = crossed.origins[index];
    const to = crossed.origins[index + 1];
    if (from === undefined || to === undefined || from < 0 || to !== from + 1) return undefined;
    return swept.arcs[from];
  });

  try {
    const parameters = pathFormationFor(params);
    const profile = parameters.profile;
    const spineSlot = pathSpineSlot(profile);
    // Swept here, not in Rust. A sweep decides where every vertex goes, which
    // faces exist and which rim is the outside -- product decisions, and the
    // last of them is what all the contour work is about. Rust validates and
    // registers the patch this produces; it does not get to say what the
    // product is.
    const sweep = (line: readonly ConstructionPosition[], arcs: readonly (SweptArc | undefined)[]) =>
      inStage(TOOL, "plan the sweep", { operationId, stations: line.length }, () =>
        sweepFormation(line, profile, parameters.miterLimit, { arcs }),
      );

    const mitredCorridors = new Set(
      crossed.terminals.filter((join) => join.terminal).map((join) => join.run.corridorId),
    );

    // A crossing is prepared before it is swept for real.
    //
    // Everything that follows works by moving a node onto a meeting point,
    // and a road that runs clean *through* another has no node to move: its
    // rims cross in the middle of a span. So the first sweep is read only to
    // find out where those crossings fall, stations are put there, and the
    // road is swept again -- and from then on a crossing is made of stations
    // like every other junction, and the T's own machinery closes it.
    //
    // Nothing happens here for a road that merely arrives, which is the far
    // commoner case: it has a loose end, and a loose end fuses.
    const first = sweep(referenceLine, committedArcs);
    const crossings = throughCrossings(
      first,
      profile.length,
      spineSlot,
      first.referenceLine.length === referenceLine.length
        ? crossed.joined.filter((run) => !mitredCorridors.has(run.corridorId))
        : [],
    );
    const prepared =
      crossings.stations.length === 0
        ? undefined
        : withStationsAt(referenceLine, committedArcs, crossings.stations);

    // Everything indexed by station has to survive the splice, so it is
    // carried across by where each station came from rather than recomputed.
    const wasAt = new Map<number, number>();
    prepared?.origins.forEach((from, index) => {
      if (from >= 0) wasAt.set(from, index);
    });
    const line = prepared?.line ?? referenceLine;
    const lineArcs = prepared === undefined
      ? committedArcs
      : line.slice(0, -1).map((_station, index) => {
          const from = prepared.origins[index];
          const to = prepared.origins[index + 1];
          if (from === undefined || to === undefined || from < 0 || to !== from + 1) return undefined;
          return committedArcs[from];
        });
    const lineWelds =
      prepared === undefined
        ? welds
        : new Map([...welds].map(([station, nodeId]) => [wasAt.get(station) ?? station, nodeId]));
    const terminals = crossed.terminals.map((join) =>
      prepared === undefined ? join : { ...join, at: wasAt.get(join.at) ?? join.at },
    );

    const effect = createPathBrushEffect(
      { brushShape, brushRegion: { samples: line }, parameters },
      { operationId, tableId: ctx.tableId, initiatedBy: "local" },
    );
    const plan = prepared === undefined ? first : sweep(line, lineArcs);
    // The sweep drops a station only where two coincide, which the reference
    // line already rules out. Were one dropped anyway the indices would no
    // longer line up, so the run commits unwelded rather than welded to the
    // wrong place.
    const aligned = plan.referenceLine.length === line.length;
    // Now that the rim exists, fuse it into the rims of the runs this one
    // joined: a shared spine node without shared contour nodes is two roads
    // drawn over each other, not a junction.
    //
    // Two shapes, and they are answered in order. A run that met another *at
    // a station* shares that station's whole cross-section, so its end rib is
    // mitred into the other's and the two become one rib. Everything else met
    // mid-run, and there the rim is cut back to where it crossed.
    const mitred = mitreTerminalRibs(
      plan,
      profile.length,
      spineSlot,
      aligned ? terminals.filter((join) => join.terminal) : [],
      lineArcs,
    );
    const spineWelds = new Map<string, ConstructionNodeId>();
    if (aligned) for (const [station, nodeId] of lineWelds) spineWelds.set(`${station}:0`, nodeId);
    // Where a rim cut a standing spine, the node that cut it is this run's own
    // rim node at that station: one node, both runs, which is the only thing
    // that makes a crossing a junction rather than an overlap.
    if (aligned && prepared !== undefined) {
      const stationAt = new Map(
        crossings.stations.map((value, index) => [value, prepared.indexOf[index] ?? -1]),
      );
      for (const meeting of crossings.meetings) {
        const station = stationAt.get(meeting.at);
        if (station === undefined || station < 0) continue;
        spineWelds.set(`${station}:${meeting.across}`, meeting.nodeId);
      }
    }
    const welded = new Map([...spineWelds, ...mitred.welds]);
    const fused = pathMouthsInto(
      { ...plan, vertices: mitred.vertices },
      profile.length,
      spineSlot,
      aligned ? crossed.joined.filter((run) => !mitredCorridors.has(run.corridorId)) : [],
      welded,
    );
    const formation = pathPatch(
      ctx.tableId,
      pathCorridorId(effect.operationId, params.pathKind),
      effect.targetType,
      { ...plan, vertices: fused.vertices },
      profile.length,
      spineSlot,
      welded,
    );

    const corridorId = pathCorridorId(effect.operationId, params.pathKind);

    const resolved = resolveCoverage(
      effect.targetType,
      inStage(TOOL, "read the footprint coverage", { operationId, outline: formation.outline.length }, () =>
        ctx.runtime.getFootprintCoverage(formation.outline),
      ),
      params.pathKind,
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
    // A run that reaches another run's spine *meets* it. Leaving those faces
    // out of the sources is what stops one carriageway from erasing the
    // other: they are not consumed, so the crossed run keeps its own bands
    // and, with them, its own travel line.
    const joined = joinedCoveredKeys(
      ctx,
      formation.outline,
      resolved.map((entry) => entry.covered),
      new Set(crossed.joined.map((run) => run.corridorId)),
    );
    const sourceSurfaceKeys = resolved
      .filter((entry) => entry.interaction.kind === "cut")
      .filter((entry) => !joined.has(entry.covered.surfaceKey.join(":")))
      .map((entry) => entry.covered.surfaceKey);

    // Split only once the commit is going through: both the spine node a
    // crossing needs and the rim nodes a fusion needs are made by cutting
    // edges of runs already standing, and a refusal above would otherwise
    // leave those cuts behind with nothing referencing them.
    // Every cut of a standing spine, ordered together. A crossing cuts the
    // same edge the spine join already cut -- the two rims either side of the
    // travel line -- and a second cut naming the original edge asks for one
    // that the first has already replaced.
    const spineCuts =
      aligned && prepared !== undefined
        ? [...crossed.splits, ...crossings.meetings.flatMap((meeting) => meeting.split ?? [])]
        : crossed.splits;
    const splits = [...spineSplitOps(ctx.tableId, spineCuts), ...mitred.moves];
    if (splits.length > 0) {
      inStage(TOOL, "split and mitre the runs already standing", { operationId, ops: splits.map((op) => op.kind) }, () =>
        ctx.runtime.applyRegionEdit(splits, "local", operationId),
      );
    }

    const outcome = inStage(
      TOOL,
      "lay the road",
      {
        operationId,
        consuming: sourceSurfaceKeys.map((key) => key.join(":")),
        faces: formation.patch.regions.length,
      },
      () =>
        ctx.runtime.applyRegionOverlay(
          {
            operationId: effect.operationId,
            sourceSurfaceKeys,
            outline: formation.outline,
            boundary: formation.boundary,
            patch: formation.patch,
          },
          "local",
          effect.operationId,
        ),
    );
    // The junction goes in last and on its own.
    //
    // Last for two reasons. Both wedges bound edges the road itself has only
    // just declared -- the rib between the junction node and each corner --
    // and, less obviously, **which faces the standing run is made of is only
    // known now**. The overlay has just consumed, created and pruned
    // surfaces, so the run read before it ran describes a table that no
    // longer exists, and deleting a band by an id from that reading asks the
    // graph for a region that is not there any more. The run is read again
    // here. The mouth itself survives the re-read untouched: where two rims
    // crossed is a fact about positions, and the overlay moved nothing.
    //
    // On its own, because the road is already standing by now: a junction
    // that cannot be closed is a bad junction on a real road, and throwing
    // here would take the road down with it. So the failure is reported at
    // full detail and the stroke survives.
    // One rebuild per flank, not one per mouth. A stroke can open into the
    // same rim of the same road twice -- an S drawn back into the road it
    // left -- and both mouths cut the same run of bands, so closing them one
    // at a time has the second looking for faces the first already removed.
    const flanks = new Map<string, PathMouth[]>();
    for (const mouth of fused.mouths) {
      const key = `${mouth.run.corridorId}:${mouth.through}`;
      const into = flanks.get(key) ?? [];
      flanks.set(key, into);
      into.push(mouth);
    }

    for (const [flankKey, flank] of flanks) {
      // Read per flank, not once: closing the first one deletes faces and
      // declares others, so the second flank is looking at a table the first
      // has already changed.
      const live = ctx.runtime.getAllRegionTopologies();
      const standingNow = pathRunsIn(live);
      const present = new Map(live.map((topology) => [topology.surfaceKey.join(":"), topology]));
      const run = standingNow.find((candidate) => candidate.corridorId === flank[0]!.run.corridorId);
      if (run === undefined) {
        reportToolWarning(TOOL, "a mouth had no run left to close into", {
          operationId,
          corridor: flank[0]!.run.corridorId,
          mouths: flank.map((mouth) => mouth.station),
        });
        continue;
      }
      const wedge = junctionWedges(
        ctx.tableId,
        // Named per flank: one stroke can open into two roads, or into the
        // same road twice, and every junction would otherwise declare a face
        // called `<operation>:junction-0`.
        `${effect.operationId}:f${flankKey}`,
        corridorId,
        flank.map((mouth) => ({ ...mouth, run })),
      );
      if (wedge === undefined) continue;

      // Verified against the table, not assumed from the reading. Every face
      // the rebuild is about to remove has to still be there: the pieces are
      // shaped to replace exactly that flank, so replacing part of one leaves
      // a gap, and naming a face that has already gone loses the stroke.
      const removing = wedge.removed.map((key) => present.get(key.join(":")));
      if (removing.some((topology) => topology === undefined)) {
        reportToolWarning(TOOL, "the flank a junction meant to rebuild is not there", {
          operationId,
          corridor: flank[0]!.run.corridorId,
          planned: wedge.removed.map((key) => key.join(":")),
          standing: run.bands.map((band) => band.surfaceKey.join(":")),
        });
        ctx.reportFeedback({
          tone: "error",
          message: "Junção não fechada: a rua foi criada, mas o cruzamento não.",
        });
        continue;
      }

      // The swap, made reversible before it is made.
      //
      // Removing the flank and laying the pieces are two edits, and only the
      // first is certain: a piece can be refused for want of room on an edge,
      // or the patch can throw outright. Left alone that reads on the table
      // as faces vanishing when a T is drawn -- the road really does lose its
      // flank, and nothing arrives to take its place. So the faces about to
      // go are captured first, and put back if the pieces do not stand.
      const flankBefore = patchRestoring(removing.filter((topology) => topology !== undefined));
      const putBack = (laidRegionIds: readonly string[]): void => {
        try {
          // Whatever did stand comes out first. A piece and the band it
          // replaced want the same edges, and an edge has room for two faces:
          // restoring on top of a half-laid junction is refused, which would
          // leave the hole this is here to fill.
          const prefix = wedge.removed[0]?.slice(0, -1) ?? [];
          if (laidRegionIds.length > 0) {
            ctx.runtime.applyRegionEdit(
              laidRegionIds.map((regionId) => ({
                kind: "delete-region" as const,
                surfaceKey: [...prefix, regionId],
              })),
              "local",
              `${effect.operationId}:junction-undo`,
            );
          }
          ctx.runtime.addPatch(flankBefore, "local", `${effect.operationId}:junction-undo`);
        } catch (error) {
          reportToolFailure(
            TOOL,
            "put back the flank a junction could not replace",
            { operationId, flank: wedge.removed.map((key) => key.join(":")) },
            error,
          );
        }
      };

      try {
        ctx.runtime.applyRegionEdit(junctionRemovals([wedge]), "local", operationId);
        const laid = ctx.runtime.addPatch(wedge.patch, "local", effect.operationId);
        if (laid.skippedRegionIds.length > 0) {
          const skipped = new Set(laid.skippedRegionIds);
          reportToolWarning(TOOL, "a junction face was refused, so the flank went back", {
            operationId,
            skipped: laid.skippedRegionIds,
            removed: wedge.removed.map((key) => key.join(":")),
          });
          putBack(
            wedge.patch.regions
              .map((region) => region.regionId)
              .filter((regionId) => !skipped.has(regionId)),
          );
          ctx.reportFeedback({
            tone: "error",
            message: "Junção não fechada: a rua foi criada, mas o cruzamento não.",
          });
        }
      } catch (error) {
        reportToolFailure(
          TOOL,
          "close the junction",
          {
            operationId,
            removing: wedge.removed.map((key) => key.join(":")),
            faces: wedge.patch.regions.map((region) => region.regionId),
            edges: wedge.patch.edges.map((edge) => edge.edgeId),
            overlayRemoved: outcome.removedSurfaceKeys.map((key) => key.join(":")),
            overlayCreated: outcome.createdSurfaceKeys.map((key) => key.join(":")),
            standingBands: run.bands.map((band) => band.surfaceKey.join(":")),
          },
          error,
        );
        // The pieces threw, so none of them stands: only the flank goes back.
        putBack([]);
        ctx.reportFeedback({
          tone: "error",
          message: "Junção não fechada: a rua foi criada, mas o cruzamento não.",
        });
      }
    }

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
    // Already named on the console by whichever stage threw; this catches
    // the ones that have no stage of their own.
    reportToolFailure(TOOL, "commit the path", { operationId, stroke: stroke.length }, error);
    const message = error instanceof Error ? error.message : String(error);
    ctx.reportFeedback({ tone: "error", message: `Caminho não aplicado: ${message}` });
  }
}
