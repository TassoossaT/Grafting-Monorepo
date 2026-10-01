import { adoptJointEnd, adoptsEnds, automaticCurve, controlRungId, endJointNear, controlSectionId, floorLandingNear, gradeSpineSpans, landingSeat, type EndJoint, type FloorLanding, hasTrait, reweldFloors, SLOPE_SURFACE_TYPE, slopeFootprint, slopeSurface, spineControlNodeId, type WeldRung } from "../../../../features/edit-construction/index.ts";
import type {
  ConstructionEdgeSnapshot,
  ConstructionPosition,
  ConstructionRegionEdge,
  ConstructionRegionTopology,
  CubicBezier,
  CurveHandles,
  CurvePoint,
} from "../../../../ports/index.ts";
import { scopedToolId, type PointerSample, type ToolContext } from "../core/tool-context.ts";
import { graphNodeOf } from "../core/node-identity.ts";
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
  const nodeId = graphNodeOf(sample);
  const node = nodeId ? ctx.runtime.getGraphSnapshot().nodes.find((n) => n.id === nodeId) : undefined;
  return { ...sample.point, y: node?.position.y ?? sample.point.y };
}

/** One span a creation gesture already laid out: the cubic it resolves to, and its handles -- a straight or circular span's carry that shape. */
export interface PlannedSpan {
  readonly curve: CubicBezier;
  readonly handles: CurveHandles;
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
  /** The floor edge met, as found -- a curved one says its circle. */
  readonly landing: FloorLanding;
}

export function project(a: ConstructionPosition, b: ConstructionPosition, p: ConstructionPosition): { t: number; distance: number } {
  const dx = b.x - a.x, dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq < 1e-12) return { t: -1, distance: Infinity };
  const t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSq;
  return { t, distance: Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz)) };
}

/** The straight boundary edge of a flat platform at `point`'s height that `point` lands on, if any -- a whole straight run, however ground split it. */
export function landingEdge(topologies: readonly ConstructionRegionTopology[], point: ConstructionPosition, controlIndex: number): EndWeld | undefined {
  const floors = topologies.filter((topology) => hasTrait(topology.surfaceType, "floor") && Math.abs((topology.nodes[0]?.position.y ?? NaN) - point.y) <= 1e-3);
  const landing = floorLandingNear(floors, point, { reach: WELD_TOLERANCE });
  return landing && { controlIndex, topology: landing.topology, use: landing.use, a: landing.a, b: landing.b, landing };
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

/** A spine control node's cross-section, as the rung its spans and a welded floor share. */
const controlRung = (controlId: string): WeldRung => ({ edgeId: controlRungId(controlId), startNodeId: controlSectionId(controlId, "min"), endNodeId: controlSectionId(controlId, "max") });

/**
 * Commits one sloped platform: a spine owned by the sloped platform type,
 * and the faces generated from it.
 *
 * The spine runs smoothly through `controlPoints`, or follows `plan` exactly
 * when a creation gesture already laid its spans out -- straight, circular
 * or free. Either way only the
 * two ends' heights are kept: everything between is graded at one constant
 * grade by plan length. An end of a free run that lands on a flat
 * platform's edge at its own height meets that edge square on and is
 * welded into it.
 */
export function commitPlatformSlope(ctx: ToolContext, controlPoints: readonly ConstructionPosition[], params: Params, plan?: readonly PlannedSpan[]): void {
  try {
    const width = params.width ?? 1.5;
    if (!(width > 0)) throw new Error("A largura deve ser positiva.");
    if (plan) controlPoints = [position(plan[0]!.curve.points[0]), ...plan.map((span) => position(span.curve.points[3]))];
    if (controlPoints.length < 2) throw new Error("Marque pelo menos dois pontos.");
    const operationId = scopedToolId(ctx, "platform-slope", ctx.nextSequence());
    const topologies = ctx.runtime.getAllRegionTopologies();
    const last = controlPoints.length - 1;
    // An end at a straight ramp's free end runs straight on from it; the ramp takes the end over.
    const graph = ctx.runtime.getGraphSnapshot();
    const jointAt = (point: ConstructionPosition) => endJointNear(graph, topologies, point, { accept: adoptsEnds, reach: WELD_TOLERANCE });
    const joints = new Map<number, EndJoint>();
    for (const i of [0, last]) {
      const joint = jointAt(controlPoints[i]!);
      if (joint) joints.set(i, joint);
    }
    const landings = [joints.has(0) ? undefined : landingEdge(topologies, controlPoints[0]!, 0), joints.has(last) ? undefined : landingEdge(topologies, controlPoints[last]!, last)]
      .filter((weld): weld is EndWeld => weld !== undefined);
    const points = controlPoints.map((point, i) => {
      const joint = joints.get(i);
      if (joint) return joint.mid;
      const weld = landings.find((w) => w.controlIndex === i);
      if (!weld) return point;
      // On a curved edge the end sits at the middle of the chord its width makes.
      if (weld.landing.arc) return landingSeat(weld.landing, width) ?? point;
      const { t } = project(weld.a, weld.b, point);
      return { x: weld.a.x + (weld.b.x - weld.a.x) * t, y: weld.a.y, z: weld.a.z + (weld.b.z - weld.a.z) * t };
    });
    const handles: readonly CurveHandles[] = plan ? plan.map((span) => span.handles) : automaticCurve(ctx.runtime, points, 0.025).handles;
    let nodes = points.map((point, i) => ({ id: spineControlNodeId(operationId, i), position: point }));
    let spans: ConstructionEdgeSnapshot[] = handles.map((h, i) => {
      const startWeld = i === 0 ? landings.find((w) => w.controlIndex === 0) : undefined;
      const endWeld = i === last - 1 ? landings.find((w) => w.controlIndex === last) : undefined;
      // Run straight on from a joined end, the way the structure it joins was going.
      const startJoint = i === 0 ? joints.get(0) : undefined;
      const endJoint = i === last - 1 ? joints.get(last) : undefined;
      const onFrom = (handle: CurvePoint, out: { readonly x: number; readonly z: number }): CurvePoint => {
        const reach = Math.hypot(handle[0], handle[2]) || 1;
        return [out.x * reach, handle[1], out.z * reach];
      };
      return {
        edgeId: `spine-edge:${operationId}:${i}`,
        startNodeId: nodes[i]!.id,
        endNodeId: nodes[i + 1]!.id,
        curve: {
          // A span pinned straight or circular cannot also run on from a joined end: it is freed to curve.
          ...(startJoint || endJoint ? (({ geometry: _pinned, ...free }) => free)(h) : h),
          start: startJoint ? onFrom(h.start, startJoint.out) : startWeld ? squareTo(h.start, startWeld) : h.start,
          end: endJoint ? onFrom(h.end, endJoint.out) : endWeld ? squareTo(h.end, endWeld) : h.end,
          mode: plan || startWeld || endWeld || startJoint || endJoint ? "aligned" : "automatic",
          bandOffsets: [-width / 2, width / 2],
          surfaceType: SLOPE_SURFACE_TYPE,
        },
      };
    });
    const graded = gradeSpineSpans(ctx.runtime, { nodes, edges: spans }, spans);
    const gradedNodes = new Map(graded.nodes.map((n) => [n.id, n.position]));
    const gradedSpans = new Map(graded.edges.map((e) => [e.edgeId, e]));
    nodes = nodes.map((n) => ({ ...n, position: gradedNodes.get(n.id) ?? n.position }));
    spans = spans.map((s) => gradedSpans.get(s.edgeId) ?? s);
    const surface = slopeSurface(ctx.runtime, new Map(nodes.map((n) => [n.id, n.position])), spans);
    const sections = new Map(surface.nodes.map((n) => [n.id, n.position]));
    const attach = landings.map((weld) => ({ rung: controlRung(nodes[weld.controlIndex]!.id), floor: weld.topology.surfaceKey }));
    if (attach.length === 2 && landings[0]!.topology === landings[1]!.topology) attach.pop();
    const floors = reweldFloors(topologies, { detach: [], attach }, sections, operationId);
    const adopters = [...joints].flatMap(([i, joint]) => adoptJointEnd(topologies, joint, controlRung(nodes[i]!.id), sections) ?? []);
    const { recorded } = commitPatchReplacement(ctx.runtime, {
      operationId,
      sourceSurfaceKeys: [...floors.sourceSurfaceKeys, ...adopters.map(({ face }) => face.surfaceKey)],
      patch: {
        nodes: [...surface.nodes, ...floors.nodes, ...adopters.flatMap(({ rebuilt }) => rebuilt.patch.nodes)],
        edges: [...surface.edges, ...floors.edges, ...adopters.flatMap(({ rebuilt }) => rebuilt.patch.edges)],
        // The ramp's own faces first: the first region names the type whose
        // change the commit emits.
        regions: [...surface.regions, ...floors.regions, ...adopters.flatMap(({ rebuilt }) => rebuilt.patch.regions)],
      },
      graphPatch: { nodes, removedEdgeIds: [], edges: spans },
      footprintOutline: slopeFootprint(ctx.runtime, surface),
    }, { transactionId: operationId });
    if (recorded) ctx.history.record({ kind: "transaction", transactionId: operationId });
    const slope = graded.grade === undefined ? "" : `, inclinação ${(graded.grade * 100).toFixed(0)}%`;
    ctx.reportFeedback({ tone: "success", message: `Plataforma inclinada: ${surface.regions.length} trecho(s), ${floors.attached.length} ponta(s) soldada(s)${adopters.length > 0 ? `, ${adopters.length} continuando uma rampa` : ""}${slope}.` });
  } catch (error) {
    ctx.reportFeedback({ tone: "error", message: error instanceof Error ? error.message : String(error) });
  }
}
