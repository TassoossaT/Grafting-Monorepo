import { automaticCurve, controlRungId, controlSectionId, reverseGeometry, SLOPE_SURFACE_TYPE, slopeSurface, spineControlNodeId } from "../../../../features/edit-construction/index.ts";
import type { ToolParamsByTool } from "../../../../features/edit-construction/index.ts";
import type {
  ConstructionEdgeSnapshot,
  ConstructionOrientedEdgeUse,
  ConstructionPatchEdge,
  ConstructionPosition,
  ConstructionRegionEdge,
  ConstructionRegionTopology,
  CurvePoint,
} from "../../../../ports/index.ts";
import { scopedToolId, type PointerSample, type ToolContext } from "../core/tool-context.ts";

type Params = ToolParamsByTool["platform-contour"];
/** Same weld reach the flat platform contour uses. */
const WELD_TOLERANCE = 0.25;

/** A control point's height comes from what the pointer actually touched: a node's own height, else the picked surface. */
export function slopeControlPoint(ctx: ToolContext, sample: PointerSample): ConstructionPosition {
  const node = sample.nodeId ? ctx.runtime.getGraphSnapshot().nodes.find((n) => n.id === sample.nodeId) : undefined;
  return { ...sample.point, y: node?.position.y ?? sample.point.y };
}

/**
 * The spiral preset: control points of a helix around `center`, climbing
 * `rise` over `turns` turns. Eight per turn keeps the automatic curve round.
 * A preset only chooses points -- the result is an ordinary spine.
 */
export function spiralControlPoints(center: ConstructionPosition, params: Params): readonly ConstructionPosition[] {
  const radius = params.radius ?? 2.5, turns = params.turns ?? 1, rise = params.rise ?? 3;
  if (!(radius > 0) || !(turns > 0) || !Number.isFinite(rise)) throw new Error("Raio e voltas devem ser positivos.");
  const steps = Math.max(2, Math.ceil(turns * 8));
  return Array.from({ length: steps + 1 }, (_, k) => {
    const angle = (k / steps) * turns * Math.PI * 2;
    return { x: center.x + radius * Math.cos(angle), y: center.y + (rise * k) / steps, z: center.z + radius * Math.sin(angle) };
  });
}

interface EndWeld {
  readonly controlIndex: number;
  readonly topology: ConstructionRegionTopology;
  readonly use: ConstructionRegionEdge;
  readonly a: ConstructionPosition;
  readonly b: ConstructionPosition;
}

function project(a: ConstructionPosition, b: ConstructionPosition, p: ConstructionPosition): { t: number; distance: number } {
  const dx = b.x - a.x, dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq < 1e-12) return { t: -1, distance: Infinity };
  const t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSq;
  return { t, distance: Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz)) };
}

/** The straight boundary edge of a flat platform at `point`'s height that `point` lands on, if any. */
function landingEdge(topologies: readonly ConstructionRegionTopology[], point: ConstructionPosition, controlIndex: number): EndWeld | undefined {
  let best: (EndWeld & { distance: number }) | undefined;
  for (const topology of topologies) {
    if (topology.surfaceType !== "platform" || Math.abs((topology.nodes[0]?.position.y ?? NaN) - point.y) > 1e-3) continue;
    const positions = new Map(topology.nodes.map((n) => [n.id, n.position]));
    for (const use of topology.outerLoops.flat()) {
      if (use.geometry.kind !== "line") continue;
      const a = positions.get(use.startNodeId)!, b = positions.get(use.endNodeId)!;
      const { t, distance } = project(a, b, point);
      if (t <= 0 || t >= 1 || distance > WELD_TOLERANCE || (best && best.distance <= distance)) continue;
      best = { controlIndex, topology, use, a, b, distance };
    }
  }
  return best;
}

/** `handle` turned to meet the welded edge square on, keeping its length and its climb. */
function squareTo(handle: CurvePoint, weld: EndWeld): CurvePoint {
  const ux = weld.b.x - weld.a.x, uz = weld.b.z - weld.a.z;
  const length = Math.hypot(ux, uz);
  let nx = -uz / length, nz = ux / length;
  if (nx * handle[0] + nz * handle[2] < 0) { nx = -nx; nz = -nz; }
  const reach = Math.hypot(handle[0], handle[2]);
  return [nx * reach, handle[1], nz * reach];
}

/** The welded floor again, with the landing edge split around the ramp end's own rung. */
function reweldedFloor(operationId: string, weld: EndWeld, controlId: string, sections: ReadonlyMap<string, ConstructionPosition>) {
  const edges = new Map<string, ConstructionPatchEdge>();
  const ids = { min: controlSectionId(controlId, "min"), max: controlSectionId(controlId, "max") };
  const along = (id: string) => project(weld.a, weld.b, sections.get(id)!).t;
  const [first, second] = along(ids.min) <= along(ids.max) ? [ids.min, ids.max] : [ids.max, ids.min];
  const walk = (loop: readonly ConstructionRegionEdge[]): ConstructionOrientedEdgeUse[] => loop.flatMap((use) => {
    if (use.edgeId !== weld.use.edgeId) {
      edges.set(use.edgeId, use.reversed
        ? { edgeId: use.edgeId, startNodeId: use.endNodeId, endNodeId: use.startNodeId, geometry: reverseGeometry(use.geometry) }
        : { edgeId: use.edgeId, startNodeId: use.startNodeId, endNodeId: use.endNodeId, geometry: use.geometry });
      return [{ edgeId: use.edgeId, reversed: use.reversed }];
    }
    const before = `${operationId}:weld:${weld.controlIndex}:before`, after = `${operationId}:weld:${weld.controlIndex}:after`;
    edges.set(before, { edgeId: before, startNodeId: use.startNodeId, endNodeId: first });
    edges.set(after, { edgeId: after, startNodeId: second, endNodeId: use.endNodeId });
    return [{ edgeId: before, reversed: false }, { edgeId: controlRungId(controlId), reversed: first !== ids.min }, { edgeId: after, reversed: false }];
  });
  // Walked first: the walk is what declares the split edges.
  const region = { regionId: `${operationId}:floor:${weld.controlIndex}`, boundary: walk(weld.topology.outerLoops[0] ?? []), holes: weld.topology.holes.map(walk), surfaceType: "platform", physical: true };
  return { nodes: weld.topology.nodes.map((n) => ({ id: n.id, position: n.position })), edges: [...edges.values()], region };
}

/** Whether both end cross-sections landed strictly inside the edge, clear of its corners. */
function landsInside(weld: EndWeld, controlId: string, sections: ReadonlyMap<string, ConstructionPosition>): boolean {
  const length = Math.hypot(weld.b.x - weld.a.x, weld.b.z - weld.a.z);
  return (["min", "max"] as const).every((side) => {
    const { t, distance } = project(weld.a, weld.b, sections.get(controlSectionId(controlId, side))!);
    return distance < 1e-3 && t * length > 1e-2 && (1 - t) * length > 1e-2;
  });
}

/**
 * Commits one sloped platform: a spine through `controlPoints`, owned by the
 * sloped platform type, and the faces generated from it. An end that lands
 * on a flat platform's edge at its own height meets that edge square on and
 * is welded into it.
 */
export function commitPlatformSlope(ctx: ToolContext, controlPoints: readonly ConstructionPosition[], params: Params): void {
  try {
    const width = params.width ?? 1.5;
    if (!(width > 0)) throw new Error("A largura deve ser positiva.");
    if (controlPoints.length < 2) throw new Error("Marque pelo menos dois pontos.");
    const operationId = scopedToolId(ctx, "platform-slope", ctx.nextSequence());
    const topologies = ctx.runtime.getAllRegionTopologies();
    const last = controlPoints.length - 1;
    const landings = [landingEdge(topologies, controlPoints[0]!, 0), landingEdge(topologies, controlPoints[last]!, last)]
      .filter((weld): weld is EndWeld => weld !== undefined);
    const points = controlPoints.map((point, i) => {
      const weld = landings.find((w) => w.controlIndex === i);
      if (!weld) return point;
      const { t } = project(weld.a, weld.b, point);
      return { x: weld.a.x + (weld.b.x - weld.a.x) * t, y: weld.a.y, z: weld.a.z + (weld.b.z - weld.a.z) * t };
    });
    const fitted = automaticCurve(ctx.runtime, points, 0.025);
    const nodes = points.map((position, i) => ({ id: spineControlNodeId(operationId, i), position }));
    const spans: ConstructionEdgeSnapshot[] = fitted.handles.map((h, i) => {
      const startWeld = i === 0 ? landings.find((w) => w.controlIndex === 0) : undefined;
      const endWeld = i === last - 1 ? landings.find((w) => w.controlIndex === last) : undefined;
      return {
        edgeId: `spine-edge:${operationId}:${i}`,
        startNodeId: nodes[i]!.id,
        endNodeId: nodes[i + 1]!.id,
        curve: {
          ...h,
          start: startWeld ? squareTo(h.start, startWeld) : h.start,
          end: endWeld ? squareTo(h.end, endWeld) : h.end,
          mode: startWeld || endWeld ? "aligned" : "automatic",
          bandOffsets: [-width / 2, width / 2],
          surfaceType: SLOPE_SURFACE_TYPE,
        },
      };
    });
    const surface = slopeSurface(ctx.runtime, new Map(nodes.map((n) => [n.id, n.position])), spans);
    const sections = new Map(surface.nodes.map((n) => [n.id, n.position]));
    const welds = landings.filter((weld) => landsInside(weld, nodes[weld.controlIndex]!.id, sections));
    if (welds.length === 2 && welds[0]!.topology === welds[1]!.topology) welds.pop();
    const floors = welds.map((weld) => ({ weld, ...reweldedFloor(operationId, weld, nodes[weld.controlIndex]!.id, sections) }));
    ctx.runtime.applyPatchReplacement({
      operationId,
      sourceSurfaceKeys: floors.map((floor) => floor.weld.topology.surfaceKey),
      patch: {
        nodes: [...surface.nodes, ...floors.flatMap((floor) => floor.nodes)],
        edges: [...surface.edges, ...floors.flatMap((floor) => floor.edges)],
        regions: [...floors.map((floor) => floor.region), ...surface.regions],
      },
      graphPatch: { nodes, removedEdgeIds: [], edges: spans },
    }, "local", operationId);
    ctx.history.record({ kind: "path-brush", operationId });
    ctx.reportFeedback({ tone: "success", message: `Plataforma inclinada: ${surface.regions.length} trecho(s), ${welds.length} ponta(s) soldada(s).` });
  } catch (error) {
    ctx.reportFeedback({ tone: "error", message: error instanceof Error ? error.message : String(error) });
  }
}
