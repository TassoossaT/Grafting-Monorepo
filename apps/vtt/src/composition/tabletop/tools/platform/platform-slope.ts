import { helixControlPoints, reverseGeometry, sampleStripStations, stripNodeId, stripPatch, stripRungEdgeId } from "../../../../features/edit-construction/index.ts";
import type { StripSide, StripStation, ToolParamsByTool } from "../../../../features/edit-construction/index.ts";
import type { ConstructionOrientedEdgeUse, ConstructionPatchEdge, ConstructionPosition, ConstructionRegionEdge, ConstructionRegionTopology } from "../../../../ports/index.ts";
import { scopedToolId, type PointerSample, type ToolContext } from "../core/tool-context.ts";

type Params = ToolParamsByTool["platform-contour"];
/** Same weld reach the flat platform contour uses. */
const WELD_TOLERANCE = 0.25;

/** A control point's height comes from what the pointer actually touched: a node's own height, else the picked surface. */
export function slopeControlPoint(ctx: ToolContext, sample: PointerSample): ConstructionPosition {
  const node = sample.nodeId ? ctx.runtime.getGraphSnapshot().nodes.find((n) => n.id === sample.nodeId) : undefined;
  return { ...sample.point, y: node?.position.y ?? sample.point.y };
}

export function spiralControlPoints(center: ConstructionPosition, params: Params): readonly ConstructionPosition[] {
  return helixControlPoints(center, params.radius ?? 2.5, params.turns ?? 1, params.rise ?? 3);
}

interface EndWeld {
  readonly end: number;
  readonly topology: ConstructionRegionTopology;
  readonly use: ConstructionRegionEdge;
  readonly ids: Readonly<Record<StripSide, string>>;
  readonly positions: Readonly<Record<StripSide, ConstructionPosition>>;
  /** Which side the platform's own walk reaches first along the welded edge. */
  readonly first: StripSide;
}

/**
 * Where a strip end lands on the straight boundary edge of a flat platform at
 * its own height: both station nodes projected onto that edge, reusing a
 * corner wherever one is within reach. The strip then shares real nodes and
 * its end rung with the floor, which is the whole connection -- a floor that
 * moves carries the end of the ramp standing on it.
 */
function endWeld(topologies: readonly ConstructionRegionTopology[], station: StripStation, end: number, stripId: string): EndWeld | undefined {
  const center = { x: (station.l.x + station.r.x) / 2, y: station.l.y, z: (station.l.z + station.r.z) / 2 };
  let best: { topology: ConstructionRegionTopology; use: ConstructionRegionEdge; distance: number } | undefined;
  for (const topology of topologies) {
    if (topology.surfaceType !== "platform" || Math.abs((topology.nodes[0]?.position.y ?? NaN) - center.y) > 1e-3) continue;
    const positions = new Map(topology.nodes.map((n) => [n.id, n.position]));
    for (const use of topology.outerLoops.flat()) {
      if (use.geometry.kind !== "line") continue;
      const a = positions.get(use.startNodeId)!, b = positions.get(use.endNodeId)!;
      const projected = project(a, b, center);
      if (projected.t < 0 || projected.t > 1 || projected.distance > WELD_TOLERANCE) continue;
      if (!best || projected.distance < best.distance) best = { topology, use, distance: projected.distance };
    }
  }
  if (!best) return undefined;
  const positions = new Map(best.topology.nodes.map((n) => [n.id, n.position]));
  const a = positions.get(best.use.startNodeId)!, b = positions.get(best.use.endNodeId)!;
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  const place = (side: StripSide) => {
    const t = Math.min(1, Math.max(0, project(a, b, station[side]).t));
    const position = { x: a.x + (b.x - a.x) * t, y: a.y, z: a.z + (b.z - a.z) * t };
    const id = t * length <= WELD_TOLERANCE ? best!.use.startNodeId : (1 - t) * length <= WELD_TOLERANCE ? best!.use.endNodeId : stripNodeId(stripId, end, side);
    return { t, id, position: id === best!.use.startNodeId ? a : id === best!.use.endNodeId ? b : position };
  };
  const l = place("l"), r = place("r");
  if (l.id === r.id) return undefined;
  return { end, topology: best.topology, use: best.use, ids: { l: l.id, r: r.id }, positions: { l: l.position, r: r.position }, first: l.t <= r.t ? "l" : "r" };
}

function project(a: ConstructionPosition, b: ConstructionPosition, p: ConstructionPosition): { t: number; distance: number } {
  const dx = b.x - a.x, dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq < 1e-12) return { t: -1, distance: Infinity };
  const t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSq;
  return { t, distance: Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz)) };
}

/** The welded floor again, with the edge the strip landed on split around the strip's own end rung. */
function reweldedFloor(stripId: string, topology: ConstructionRegionTopology, welds: readonly EndWeld[]) {
  const edges = new Map<string, ConstructionPatchEdge>();
  const canonical = (use: ConstructionRegionEdge): ConstructionPatchEdge => use.reversed
    ? { edgeId: use.edgeId, startNodeId: use.endNodeId, endNodeId: use.startNodeId, geometry: reverseGeometry(use.geometry) }
    : { edgeId: use.edgeId, startNodeId: use.startNodeId, endNodeId: use.endNodeId, geometry: use.geometry };
  const walk = (loop: readonly ConstructionRegionEdge[]): ConstructionOrientedEdgeUse[] => loop.flatMap((use) => {
    const weld = welds.find((w) => w.use.edgeId === use.edgeId);
    if (!weld) {
      edges.set(use.edgeId, canonical(use));
      return [{ edgeId: use.edgeId, reversed: use.reversed }];
    }
    const second: StripSide = weld.first === "l" ? "r" : "l";
    const uses: ConstructionOrientedEdgeUse[] = [];
    const piece = (suffix: string, from: string, to: string) => {
      if (from === to) return;
      const edgeId = `${stripId}:weld:${weld.end}:${suffix}`;
      edges.set(edgeId, { edgeId, startNodeId: from, endNodeId: to, geometry: { kind: "line" } });
      uses.push({ edgeId, reversed: false });
    };
    piece("before", use.startNodeId, weld.ids[weld.first]);
    uses.push({ edgeId: stripRungEdgeId(stripId, weld.end), reversed: weld.first !== "l" });
    piece("after", weld.ids[second], use.endNodeId);
    return uses;
  });
  const boundary = walk(topology.outerLoops[0] ?? []);
  const holes = topology.holes.map(walk);
  return {
    nodes: topology.nodes.map((n) => ({ id: n.id, position: n.position })),
    edges: [...edges.values()],
    region: { regionId: `${stripId}:floor:${welds[0]!.end}`, boundary, holes, surfaceType: "platform", physical: true },
  };
}

/**
 * Commits one sloped platform along the curve through `controlPoints`. Each
 * end welds onto a flat platform edge at its own height when it lands on one.
 */
export function commitPlatformSlope(ctx: ToolContext, controlPoints: readonly ConstructionPosition[], params: Params): void {
  try {
    const sampled = sampleStripStations(ctx.runtime, controlPoints, params.width ?? 1.5);
    const stripId = scopedToolId(ctx, "platform-slope", ctx.nextSequence());
    const topologies = ctx.runtime.getAllRegionTopologies();
    const last = sampled.length - 1;
    const welds = [endWeld(topologies, sampled[0]!, 0, stripId), endWeld(topologies, sampled[last]!, last, stripId)]
      .filter((weld): weld is EndWeld => weld !== undefined);
    if (welds.length === 2 && welds[0]!.use.edgeId === welds[1]!.use.edgeId) welds.pop();
    const stations = sampled.map((station, i) => welds.find((w) => w.end === i)?.positions ?? station);
    const strip = stripPatch(stripId, stations, "platform-slope", (i, side) => welds.find((w) => w.end === i)?.ids[side] ?? stripNodeId(stripId, i, side));
    const floors = [...new Set(welds.map((w) => w.topology))].map((topology) => ({ topology, ...reweldedFloor(stripId, topology, welds.filter((w) => w.topology === topology)) }));
    const nodes = new Map([...floors.flatMap((f) => f.nodes), ...strip.nodes].map((n) => [n.id, n]));
    ctx.runtime.applyPatchReplacement({
      operationId: stripId,
      sourceSurfaceKeys: floors.map((f) => f.topology.surfaceKey),
      patch: { nodes: [...nodes.values()], edges: [...floors.flatMap((f) => f.edges), ...strip.edges], regions: [...floors.map((f) => f.region), ...strip.regions] },
    }, "local", stripId);
    ctx.history.record({ kind: "path-brush", operationId: stripId });
    ctx.reportFeedback({ tone: "success", message: `Plataforma inclinada: ${strip.regions.length} trecho(s), ${welds.length} ponta(s) soldada(s).` });
  } catch (error) {
    ctx.reportFeedback({ tone: "error", message: error instanceof Error ? error.message : String(error) });
  }
}
