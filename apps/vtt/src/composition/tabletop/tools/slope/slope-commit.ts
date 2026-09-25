import { automaticCurve, controlRungId, controlSectionId, gradeSlopeSpans, hasTrait, reverseGeometry, SLOPE_SURFACE_TYPE, slopeFootprint, slopeSurface, spineControlNodeId } from "../../../../features/edit-construction/index.ts";
import type {
  ConstructionEdgeSnapshot,
  ConstructionOrientedEdgeUse,
  ConstructionPatchEdge,
  ConstructionPosition,
  ConstructionRegionEdge,
  ConstructionRegionTopology,
  CubicBezier,
  CurveHandles,
  CurvePoint,
} from "../../../../ports/index.ts";
import { scopedToolId, type PointerSample, type ToolContext } from "../core/tool-context.ts";
import { commitPatchReplacement } from "../../effects/effect-commit.ts";

const position = (p: CurvePoint): ConstructionPosition => ({ x: p[0], y: p[1], z: p[2] });

/** What every way of drawing a sloped platform may decide; each tool fills the part it offers. */
export interface SlopeParams {
  readonly width?: number;
  readonly rise?: number;
  readonly radius?: number;
  readonly turns?: number;
}
type Params = SlopeParams;
/** Same weld reach the flat platform contour uses. */
const WELD_TOLERANCE = 0.25;

/** A control point's height comes from what the pointer actually touched: a node's own height, else the picked surface. */
export function slopeControlPoint(ctx: ToolContext, sample: PointerSample): ConstructionPosition {
  const node = sample.nodeId ? ctx.runtime.getGraphSnapshot().nodes.find((n) => n.id === sample.nodeId) : undefined;
  return { ...sample.point, y: node?.position.y ?? sample.point.y };
}

/**
 * The spiral preset: an exact helix around `center`, computed in Rust --
 * a circular arc in plan cut into cubics, climbing `rise` over `turns`.
 * `towards`, when given, is where a drag from the centre ended: it sets the
 * radius and the angle the spiral starts at, the way a spiral stair is laid
 * out from its centre. `flip` turns it the other way round.
 */
export function spiralPlan(ctx: ToolContext, center: ConstructionPosition, params: Params & { readonly flip?: boolean }, towards?: ConstructionPosition): readonly CubicBezier[] {
  const radius = towards ? Math.hypot(towards.x - center.x, towards.z - center.z) : params.radius ?? 2.5;
  const turns = params.turns ?? 1, rise = params.rise ?? 3;
  if (!(radius > 0) || !(turns > 0) || !Number.isFinite(rise)) throw new Error("Raio e voltas devem ser positivos.");
  const startAngle = towards ? Math.atan2(towards.z - center.z, towards.x - center.x) : 0;
  const sweep = turns * Math.PI * 2 * (params.flip ? -1 : 1);
  return ctx.runtime.curveBatch({ tolerance: 0.005, commands: [{ kind: "helix", center: [center.x, center.y, center.z], radius, startAngle, sweep, rise }] })[0]!.curves;
}

/** The sampled polyline of `curves`, for a preview. */
export function curvesPolyline(ctx: ToolContext, curves: readonly CubicBezier[]): readonly ConstructionPosition[] {
  if (curves.length === 0) return [];
  return ctx.runtime.curveBatch({ tolerance: 0.05, commands: [{ kind: "sample", curves }] })[0]!.samples
    .flatMap((samples, i) => samples.slice(i === 0 ? 0 : 1)).map((sample) => position(sample.position));
}

export interface EndWeld {
  readonly controlIndex: number;
  readonly topology: ConstructionRegionTopology;
  readonly use: ConstructionRegionEdge;
  readonly a: ConstructionPosition;
  readonly b: ConstructionPosition;
}

export function project(a: ConstructionPosition, b: ConstructionPosition, p: ConstructionPosition): { t: number; distance: number } {
  const dx = b.x - a.x, dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq < 1e-12) return { t: -1, distance: Infinity };
  const t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSq;
  return { t, distance: Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz)) };
}

/** The straight boundary edge of a flat platform at `point`'s height that `point` lands on, if any. */
export function landingEdge(topologies: readonly ConstructionRegionTopology[], point: ConstructionPosition, controlIndex: number): EndWeld | undefined {
  let best: (EndWeld & { distance: number }) | undefined;
  for (const topology of topologies) {
    if (!hasTrait(topology.surfaceType, "floor") || Math.abs((topology.nodes[0]?.position.y ?? NaN) - point.y) > 1e-3) continue;
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

/** The edge a ramp's end shares with the floor it is welded into, from one of its end nodes to the other. */
export interface Rung {
  readonly edgeId: string;
  readonly startNodeId: string;
  readonly endNodeId: string;
}

/** A spine control node's cross-section, as the rung its spans and a welded floor share. */
const controlRung = (controlId: string): Rung => ({ edgeId: controlRungId(controlId), startNodeId: controlSectionId(controlId, "min"), endNodeId: controlSectionId(controlId, "max") });

/** The welded floor again, with the landing edge split around the ramp end's own rung. */
export function reweldedFloor(operationId: string, weld: EndWeld, rung: Rung, sections: ReadonlyMap<string, ConstructionPosition>) {
  const edges = new Map<string, ConstructionPatchEdge>();
  const along = (id: string) => project(weld.a, weld.b, sections.get(id)!).t;
  const [first, second] = along(rung.startNodeId) <= along(rung.endNodeId) ? [rung.startNodeId, rung.endNodeId] : [rung.endNodeId, rung.startNodeId];
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
    return [{ edgeId: before, reversed: false }, { edgeId: rung.edgeId, reversed: first !== rung.startNodeId }, { edgeId: after, reversed: false }];
  });
  // Walked first: the walk is what declares the split edges.
  const region = { regionId: `${operationId}:floor:${weld.controlIndex}`, boundary: walk(weld.topology.outerLoops[0] ?? []), holes: weld.topology.holes.map(walk), surfaceType: weld.topology.surfaceType, physical: weld.topology.physical };
  return { nodes: weld.topology.nodes.map((n) => ({ id: n.id, position: n.position })), edges: [...edges.values()], region };
}

/** Whether both ends of the rung landed strictly inside the edge, clear of its corners. */
export function landsInside(weld: EndWeld, rung: Rung, sections: ReadonlyMap<string, ConstructionPosition>): boolean {
  const length = Math.hypot(weld.b.x - weld.a.x, weld.b.z - weld.a.z);
  return [rung.startNodeId, rung.endNodeId].every((id) => {
    const { t, distance } = project(weld.a, weld.b, sections.get(id)!);
    return distance < 1e-3 && t * length > 1e-2 && (1 - t) * length > 1e-2;
  });
}

const minus = (a: CurvePoint, b: CurvePoint): CurvePoint => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/**
 * Commits one sloped platform: a spine owned by the sloped platform type,
 * and the faces generated from it.
 *
 * The spine runs smoothly through `controlPoints`, or follows `plan` exactly
 * when a preset already computed its curves -- a helix. Either way only the
 * two ends' heights are kept: everything between is graded at one constant
 * grade by plan length. An end of a free run that lands on a flat
 * platform's edge at its own height meets that edge square on and is
 * welded into it.
 */
export function commitPlatformSlope(ctx: ToolContext, controlPoints: readonly ConstructionPosition[], params: Params, plan?: readonly CubicBezier[]): void {
  try {
    const width = params.width ?? 1.5;
    if (!(width > 0)) throw new Error("A largura deve ser positiva.");
    if (plan) controlPoints = [position(plan[0]!.points[0]), ...plan.map((curve) => position(curve.points[3]))];
    if (controlPoints.length < 2) throw new Error("Marque pelo menos dois pontos.");
    const operationId = scopedToolId(ctx, "platform-slope", ctx.nextSequence());
    const topologies = ctx.runtime.getAllRegionTopologies();
    const last = controlPoints.length - 1;
    const landings = plan ? [] : [landingEdge(topologies, controlPoints[0]!, 0), landingEdge(topologies, controlPoints[last]!, last)]
      .filter((weld): weld is EndWeld => weld !== undefined);
    const points = controlPoints.map((point, i) => {
      const weld = landings.find((w) => w.controlIndex === i);
      if (!weld) return point;
      const { t } = project(weld.a, weld.b, point);
      return { x: weld.a.x + (weld.b.x - weld.a.x) * t, y: weld.a.y, z: weld.a.z + (weld.b.z - weld.a.z) * t };
    });
    const handles: readonly CurveHandles[] = plan
      ? plan.map((curve) => ({ start: minus(curve.points[1], curve.points[0]), end: minus(curve.points[2], curve.points[3]), mode: "aligned" as const, bandOffsets: [] }))
      : automaticCurve(ctx.runtime, points, 0.025).handles;
    let nodes = points.map((point, i) => ({ id: spineControlNodeId(operationId, i), position: point }));
    let spans: ConstructionEdgeSnapshot[] = handles.map((h, i) => {
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
          mode: plan || startWeld || endWeld ? "aligned" : "automatic",
          bandOffsets: [-width / 2, width / 2],
          surfaceType: SLOPE_SURFACE_TYPE,
        },
      };
    });
    const graded = gradeSlopeSpans(ctx.runtime, { nodes, edges: spans }, spans);
    const gradedNodes = new Map(graded.nodes.map((n) => [n.id, n.position]));
    const gradedSpans = new Map(graded.edges.map((e) => [e.edgeId, e]));
    nodes = nodes.map((n) => ({ ...n, position: gradedNodes.get(n.id) ?? n.position }));
    spans = spans.map((s) => gradedSpans.get(s.edgeId) ?? s);
    const surface = slopeSurface(ctx.runtime, new Map(nodes.map((n) => [n.id, n.position])), spans);
    const sections = new Map(surface.nodes.map((n) => [n.id, n.position]));
    const welds = landings.filter((weld) => landsInside(weld, controlRung(nodes[weld.controlIndex]!.id), sections));
    if (welds.length === 2 && welds[0]!.topology === welds[1]!.topology) welds.pop();
    const floors = welds.map((weld) => ({ weld, ...reweldedFloor(operationId, weld, controlRung(nodes[weld.controlIndex]!.id), sections) }));
    const { recorded } = commitPatchReplacement(ctx.runtime, {
      operationId,
      sourceSurfaceKeys: floors.map((floor) => floor.weld.topology.surfaceKey),
      patch: {
        nodes: [...surface.nodes, ...floors.flatMap((floor) => floor.nodes)],
        edges: [...surface.edges, ...floors.flatMap((floor) => floor.edges)],
        // The ramp's own faces first: the first region names the type whose
        // change the commit emits.
        regions: [...surface.regions, ...floors.map((floor) => floor.region)],
      },
      graphPatch: { nodes, removedEdgeIds: [], edges: spans },
      footprintOutline: slopeFootprint(ctx.runtime, surface),
    }, { transactionId: operationId });
    if (recorded) ctx.history.record({ kind: "transaction", transactionId: operationId });
    const slope = graded.grade === undefined ? "" : `, inclinação ${(graded.grade * 100).toFixed(0)}%`;
    ctx.reportFeedback({ tone: "success", message: `Plataforma inclinada: ${surface.regions.length} trecho(s), ${welds.length} ponta(s) soldada(s)${slope}.` });
  } catch (error) {
    ctx.reportFeedback({ tone: "error", message: error instanceof Error ? error.message : String(error) });
  }
}
