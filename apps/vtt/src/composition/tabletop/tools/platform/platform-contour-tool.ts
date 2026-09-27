import { DEFAULT_TOOL_PARAMS, fitPath, floatingPlatformStructureType, hasTrait, platformStructureType, weldFreeEndsOnto } from "../../../../features/edit-construction/index.ts";
import type { FittedEdge, ToolParamsByTool } from "../../../../features/edit-construction/index.ts";
import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";
import type { ConstructionPosition, ConstructionRegionTopology } from "../../../../ports/index.ts";
import { createBoundaryEdges, reverseGeometry } from "../core/boundary-edges.ts";
import { commitPatchReplacement } from "../../effects/effect-commit.ts";
import { scopedToolId, type ConstructionTool, type PointerSample, type ToolContext } from "../core/tool-context.ts";
import { withStructureEditing } from "../core/structure-edit-behavior.ts";
import { buildFrameAt, frameRectangle, frameStart, snappedInFrame, type BuildFrame } from "../core/build-frame.ts";
import { polylineSegmentsPreview, segmentsPreview } from "../shapes/preview-shapes.ts";
import { circleContour, previewOutline } from "../tower/tower-geometry.ts";
import { groupLoopsByContainment, splitContourAtPoints, weldedMerge, windLoop, type DirectedContourEdge } from "./platform-contour-merge.ts";
type Params = ToolParamsByTool["platform-contour"];
const COLOR = 0x79b8e8;
/** Same corner-weld tolerance a wall run already snaps onto an existing column with. */
const WELD_TOLERANCE = 0.25;
/**
 * The type a stroke draws, and the only type it extends or cuts: a floor on
 * the ground and a floating storey never become one cloud, so neither
 * reshapes the other either.
 */
const surfaceTypeOf = (params: Params): string =>
  (params.support === "floating" ? floatingPlatformStructureType : platformStructureType).surfaceType;
const drafts = new WeakMap<object, { key: string; points: PointerSample[]; frame?: BuildFrame }>();
function draft(ctx: ToolContext, params: Params): PointerSample[] {
  return draftOf(ctx, params).points;
}
function draftOf(ctx: ToolContext, params: Params): { key: string; points: PointerSample[]; frame?: BuildFrame } {
  const key = JSON.stringify(params);
  let current = drafts.get(ctx.runtime);
  if (!current || current.key !== key) { current = { key, points: [] }; drafts.set(ctx.runtime, current); }
  return current;
}
/** The frame a gesture that began at `start` builds in, read once per gesture -- see `build-frame.ts`. */
const frames = new WeakMap<PointerSample, BuildFrame>();
function frameOf(ctx: ToolContext, start: PointerSample): BuildFrame {
  let frame = frames.get(start);
  if (!frame) { frame = buildFrameAt(ctx, start); frames.set(start, frame); }
  return frame;
}
/** `sample` moved to `point`, keeping what it touched. */
const at = (sample: PointerSample, point: ConstructionPosition): PointerSample => ({ ...sample, point });
/**
 * A platform floor for a new storey usually starts by pointing at the top of
 * whatever is already there -- a wall, not necessarily another platform. Any
 * structural node the pointer actually touched is a valid elevation source,
 * not only an existing platform's; `create` used to skip this lookup
 * entirely, which is why starting a new floor on a wall silently kept
 * whatever elevation the field happened to hold instead of the wall's own.
 */
function parametersAt(ctx: ToolContext, first: PointerSample | undefined, params: Params): Params {
  if (!first) return params;
  const target = params.mode === "create" ? undefined : ctx.runtime.getAllRegionTopologies().find((t) => t.surfaceType === surfaceTypeOf(params) &&
    (first.surfaceRef ? surfaceRefFromNodeSet(t.surfaceKey) === first.surfaceRef : first.nodeId && t.nodes.some((n) => n.id === first.nodeId)));
  if (target?.nodes[0]) return { ...params, elevation: target.nodes[0].position.y };
  const node = first.nodeId ? ctx.runtime.getGraphSnapshot().nodes.find((n) => n.id === first.nodeId) : undefined;
  if (node) return { ...params, elevation: node.position.y };
  if (params.mode === "create" && Number.isFinite(first.point?.y) && params.elevation === DEFAULT_TOOL_PARAMS["platform-contour"].elevation) {
    return { ...params, elevation: first.point.y };
  }
  return params;
}
/** A source region's own boundary/hole edges, by node id -- the identities a stroke has to weld onto, not the position it happens to occupy. */
function sourceEdges(topology: ConstructionRegionTopology): readonly (readonly DirectedContourEdge[])[] {
  return [...topology.outerLoops, ...topology.holes].map((loop) => loop.map((edge) => ({
    a: edge.startNodeId,
    b: edge.endNodeId,
    geometry: edge.geometry,
  })));
}
function ringSignature(edges: readonly DirectedContourEdge[]): string {
  return edges
    .map((e) => `${e.a}>${e.b}:${e.geometry.kind === "arc" ? `arc:${e.geometry.clockwise}:${e.geometry.center[0]}:${e.geometry.center[1]}` : "line"}`)
    .sort()
    .join("|");
}
function regionSignature(rings: readonly (readonly DirectedContourEdge[])[]): string {
  return rings.map(ringSignature).sort().join("#");
}
function lines(samples: readonly PointerSample[], elevation: number): readonly FittedEdge[] {
  const points = samples.map((s) => ({ ...s.point, y: elevation })).filter((p, i, all) => i === 0 || p.x !== all[i-1]!.x || p.z !== all[i-1]!.z);
  if (points.length > 1 && points[0]!.x === points.at(-1)!.x && points[0]!.z === points.at(-1)!.z) points.pop();
  return points.map((start, i) => ({ start, end: points[(i+1)%points.length]!, geometry: { kind: "line" } }));
}
/**
 * The rectangle dragged from `a` to `b`, laid along the frame the drag began
 * in -- a structure's own sides next to it, else the way the camera looks --
 * never the world's fixed axes. `undefined` when it has no area.
 */
function rectangle(ctx: ToolContext, a: PointerSample, b: PointerSample, elevation: number): readonly PointerSample[] | undefined {
  const frame = frameOf(ctx, a);
  const corners = frameRectangle(ctx, frame, frameStart(ctx, frame, a), b.point, elevation);
  return corners && corners.map((corner, i) => (i === 0 ? at(a, corner) : { point: corner }));
}
/**
 * Commits the same directed line/arc contour vocabulary consumed by wall
 * construction. Ampliar/juntar and recortar/separar no longer run an
 * analytic boolean against the standing platform: the stroke has to weld
 * onto the existing boundary (within {@link WELD_TOLERANCE}, the same one a
 * wall run snaps onto a column with) and the result is assembled from
 * shared/cancelled edges -- see `platform-contour-merge.ts` for why.
 */
export function commitPlatformShape(ctx: ToolContext, contour: readonly FittedEdge[], params: Params, pickedSamples: readonly PointerSample[] = []): void {
  try {
    if (!Number.isFinite(params.elevation)) throw new Error("A elevação deve ser finita.");
    if (contour.length < 2) throw new Error("Desenhe uma área com largura e comprimento.");
    const all = ctx.runtime.getAllRegionTopologies();
    const graph = ctx.runtime.getGraphSnapshot();
    // Picking the terrain below a drawing plane is not an instruction to weld floors.
    const picked = new Set(pickedSamples.flatMap((s) => s.nodeId ? [s.nodeId] : []));
    const level = all.filter((t) => t.surfaceType === surfaceTypeOf(params) && t.nodes.every((n) => Math.abs(n.position.y - params.elevation) < 1e-4));
    // A floor drawn against one of its own kind at its own height joins it: the two become one floor,
    // as extending would make them, rather than two faces lying edge to edge unconnected.
    const joins = params.mode === "create" ? level.filter((t) => touchesContour(t, contour)) : [];
    const sources = params.mode === "create" ? joins : level;
    if (params.mode !== "create" && sources.length === 0) throw new Error("Nenhuma plataforma nessa elevação. Comece sobre a plataforma ou escolha a elevação correta.");

    const operationId = scopedToolId(ctx, "platform", ctx.nextSequence());
    const retained = new Map(sources.flatMap((t) => t.nodes.map((n) => [n.id,n] as const)));
    for (const n of graph.nodes) if (picked.has(n.id) && Math.abs(n.position.y - params.elevation) < 1e-4) retained.set(n.id,n);
    const nodes = new Map<string, { id: string; position: ConstructionPosition }>();
    function nodeAt(p: readonly [number,number]): string {
      const existing = [...retained.values(),...nodes.values()].find((n) => Math.abs(n.position.x-p[0]) < WELD_TOLERANCE && Math.abs(n.position.z-p[1]) < WELD_TOLERANCE);
      // A corner landing near any node at the same elevation -- a wall's own
      // vertex included, not only this operation's own platform sources --
      // is a magnet by distance, the same tolerance a wall run already snaps
      // onto a column with. Nearest wins so two nearby candidates never
      // resolve arbitrarily.
      let nearest: { readonly node: (typeof graph.nodes)[number]; readonly distance: number } | undefined;
      if (!existing) for (const n of graph.nodes) {
        if (Math.abs(n.position.y-params.elevation) > 1e-3) continue;
        const distance = Math.hypot(n.position.x-p[0],n.position.z-p[1]);
        if (distance > WELD_TOLERANCE) continue;
        if (nearest === undefined || distance < nearest.distance) nearest = { node:n, distance };
      }
      const node = existing ?? nearest?.node ?? { id: `${operationId}:node:${nodes.size}`, position: { x: p[0], y: params.elevation, z: p[1] } };
      nodes.set(node.id,node); return node.id;
    }
    const positionOf = (id: string): readonly [number, number] => {
      const n = nodes.get(id) ?? retained.get(id)!;
      return [n.position.x, n.position.z];
    };

    // A cut stroke is wound like every other outer boundary here (never
    // pre-reversed by the caller), but subtracting means it has to meet a
    // shared span from the *opposite* side a merge would -- the same
    // relationship an outer ring and its own hole always have. Reversing it
    // once here is what keeps the surviving edges after cancellation
    // decomposable into a single walk instead of a node with two ways in.
    // Whichever way it was drawn, the stroke is first wound the way every
    // standing boundary is: a rectangle dragged the other way round would
    // otherwise meet a shared side running the same way as its neighbour's,
    // and the two could never cancel into one floor.
    const drawn = windLoop(ctx.runtime, contour.map((c) => ({ a: nodeAt([c.start.x,c.start.z]), b: nodeAt([c.end.x,c.end.z]), geometry: c.geometry })), positionOf, "boundary");
    const clipEdges: DirectedContourEdge[] = params.mode === "cut"
      ? [...drawn].reverse().map((e) => ({ a: e.b, b: e.a, geometry: reverseGeometry(e.geometry) }))
      : [...drawn];
    const sourceNodeIds = new Set(sources.flatMap((t) => t.nodes.map((n) => n.id)));
    if (params.mode === "extend" && !clipEdges.some((e) => sourceNodeIds.has(e.a) || sourceNodeIds.has(e.b))) {
      ctx.reportFeedback({ tone: "error", message: "Encoste o traço na borda da plataforma existente para ampliar." }); return;
    }

    // A weld can land mid-span rather than on an existing corner (the stroke
    // touches partway along a long standing edge, say) -- split both sides
    // at every point the other side actually declares, so a mid-span weld
    // becomes a real shared node before edges are ever compared.
    const standingRaw = sources.flatMap((t) => sourceEdges(t).flat());
    const clipPoints = [...new Set(clipEdges.flatMap((e) => [e.a,e.b]))].map((id) => ({ id, position: positionOf(id) }));
    const standingPoints = [...new Set(standingRaw.flatMap((e) => [e.a,e.b]))].map((id) => ({ id, position: positionOf(id) }));
    const standing = splitContourAtPoints(ctx.runtime, standingRaw, clipPoints, positionOf, WELD_TOLERANCE);
    const splitClipEdges = splitContourAtPoints(ctx.runtime, clipEdges, standingPoints, positionOf, WELD_TOLERANCE);
    const merged = weldedMerge(standing, splitClipEdges);
    if (merged.kind === "error") { ctx.reportFeedback({ tone: "error", message: merged.message }); return; }
    let groups = groupLoopsByContainment(ctx.runtime, merged.loops, positionOf);
    // A cut clip that never touches or nests inside any standing platform
    // removed nothing -- its own loop must not be promoted into a new face.
    if (params.mode === "cut") {
      groups = groups.filter((group) => [group.boundary, ...group.holes].some((loop) => loop.some((e) => sourceNodeIds.has(e.a) || sourceNodeIds.has(e.b))));
    }
    if (params.mode !== "cut" && groups.length === 0) throw new Error("O contorno precisa delimitar uma área.");

    // Preserve the identities and render items of faces the operation did not change.
    const remaining = sources.map((source) => ({ source, signature: regionSignature(sourceEdges(source)) }));
    const changedGroups = groups.filter((group) => {
      const signature = regionSignature([group.boundary, ...group.holes]);
      const match = remaining.findIndex((item) => item.signature === signature);
      if (match < 0) return true;
      remaining.splice(match,1); return false;
    });
    if (params.mode !== "create" && remaining.length === 0 && changedGroups.length === 0) {
      ctx.reportFeedback({ tone: "info", message: params.mode === "extend" ? "A área já está coberta. Desenhe além da borda para ampliar." : "O recorte não removeu nenhuma área." }); return;
    }

    // New boundary identities avoid borrowing an unrelated wall's geometry.
    // Shared graph vertices, rather than endpoint-only edge names, carry support.
    const builder = createBoundaryEdges(operationId, { kind: "private-when-full", runPrefix: operationId, existingUses: new Map() });
    // Wound here, after the identity match above: a face the operation left
    // alone keeps its stored walk, so its signature still finds it.
    const regions = changedGroups.map((group,index) => ({
      regionId: `${operationId}:face:${index}`,
      boundary: windLoop(ctx.runtime,group.boundary,positionOf,"boundary").map((e) => builder.use(e.a,e.b,e.geometry)),
      holes: group.holes.map((hole) => windLoop(ctx.runtime,hole,positionOf,"hole").map((e) => builder.use(e.a,e.b,e.geometry))),
      surfaceType: surfaceTypeOf(params),
      physical: true,
    }));
    const primaryGroup = changedGroups[0];
    const footprintOutline = primaryGroup && primaryGroup.boundary.length >= 3
      ? primaryGroup.boundary.map((e) => positionOf(e.a))
      : (contour.length >= 3 ? contour.map((c) => [c.start.x, c.start.z] as const) : undefined);
    const { recorded } = commitPatchReplacement(ctx.runtime, {
      operationId,
      sourceSurfaceKeys: remaining.map(({ source }) => source.surfaceKey),
      patch: { nodes: [...nodes.values()], edges: builder.all(), regions },
      footprintOutline,
    }, {
      transactionId: operationId,
      // A floor drawn against a ramp's or spiral's free end joins it, corners picked or not.
      afterward: (outcome) => {
        if (params.mode === "cut") return;
        const welds = weldFreeEndsOnto(ctx.runtime.getGraphSnapshot(), ctx.runtime.getAllRegionTopologies(), outcome.createdSurfaceKeys, `${operationId}:ends`);
        if (welds) ctx.runtime.applyPatchReplacement(welds, "local", operationId);
      },
    });
    if (recorded) ctx.history.record({ kind: "transaction", transactionId: operationId });
    ctx.reportFeedback({ tone: "success", message: `Plataforma: ${regions.length} face(s) na elevação ${params.elevation}.` });
  } catch (error) { ctx.reportFeedback({ tone: "error", message: error instanceof Error ? error.message : String(error) }); }
}
/**
 * Whether the drawn `contour` meets `topology`'s outline -- a corner of
 * either within reach of the other's boundary, or either inside the other --
 * in plan.
 */
function touchesContour(topology: ConstructionRegionTopology, contour: readonly FittedEdge[]): boolean {
  const at = new Map(topology.nodes.map((node) => [node.id, node.position]));
  const own = topology.outerLoops.flat().map((use) => [at.get(use.startNodeId)!, at.get(use.endNodeId)!] as const);
  const drawn = contour.map((edge) => [edge.start, edge.end] as const);
  const near = (p: { readonly x: number; readonly z: number }, segments: readonly (readonly [{ readonly x: number; readonly z: number }, { readonly x: number; readonly z: number }])[]) =>
    segments.some(([a, b]) => {
      const dx = b.x - a.x, dz = b.z - a.z, lengthSq = dx * dx + dz * dz;
      const t = lengthSq < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSq));
      return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t)) <= WELD_TOLERANCE;
    });
  const inside = (p: { readonly x: number; readonly z: number }, segments: readonly (readonly [{ readonly x: number; readonly z: number }, { readonly x: number; readonly z: number }])[]) => {
    let crossings = 0;
    for (const [a, b] of segments) if ((a.z > p.z) !== (b.z > p.z) && p.x < a.x + ((p.z - a.z) * (b.x - a.x)) / (b.z - a.z)) crossings += 1;
    return crossings % 2 === 1;
  };
  return drawn.some(([p]) => near(p, own) || inside(p, own)) || own.some(([p]) => near(p, drawn) || inside(p, drawn));
}

/** Polygon entry point retained for callers that already have explicit corners. */
export function commitPlatformContour(ctx: ToolContext, samples: readonly PointerSample[], params: Params): void {
  commitPlatformShape(ctx, lines(samples,params.elevation),params,samples);
}
/** A polygon's next corner: its first starts the frame -- against a structure's side when next to one -- and every corner snaps in it. */
function polygonCorner(ctx: ToolContext, params: Params, sample: PointerSample): PointerSample {
  const current = draftOf(ctx, params);
  if (!current.frame || current.points.length === 0) {
    const frame = buildFrameAt(ctx, sample);
    if (current.points.length === 0) current.frame = frame;
    return at(sample, frameStart(ctx, frame, sample));
  }
  return sample.nodeId ? sample : at(sample, snappedInFrame(ctx, current.frame, sample.point));
}

const rawPlatformContourTool: ConstructionTool<"platform-contour"> = {
  id: "platform-contour",
  // Snapped in the frame each shape is built in, never to the world's fixed grid.
  useGridSnap: false,
  previewOnHover: true,
  defaultParams: () => DEFAULT_TOOL_PARAMS["platform-contour"],
  onCancel(ctx) { drafts.delete(ctx.runtime); },
  previewFor(gesture, params, ctx) {
    const points = draft(ctx,params);
    const effective = parametersAt(ctx,points[0] ?? gesture.start,params);
    const shape = params.shape ?? "rectangle";
    if (shape === "rectangle" && gesture.start.point.x === gesture.current.point.x && gesture.start.point.z === gesture.current.point.z) return undefined;
    if (shape === "circle") return segmentsPreview(previewOutline({ ...gesture.current.point, y: effective.elevation },params.radius ?? 2.5,48),COLOR);
    const samples = shape === "rectangle" ? rectangle(ctx,gesture.start,gesture.current,effective.elevation) : shape === "polygon" ? [...points,polygonCorner(ctx,params,gesture.current)] : [...points,...gesture.samples];
    if (!samples) return undefined;
    const outline = samples.map((s) => ({ ...s.point,y: effective.elevation }));
    return polylineSegmentsPreview(outline.length > 2 ? [...outline,outline[0]!] : outline,COLOR);
  },
  onClick(ctx,sample,params) {
    const shape = params.shape ?? "rectangle";
    if (shape === "circle") {
      const effective = parametersAt(ctx,sample,params);
      const center = frameStart(ctx,buildFrameAt(ctx,sample),sample);
      commitPlatformShape(ctx,circleContour({ ...center,y:effective.elevation },params.radius ?? 2.5),effective);
    } else if (shape === "polygon") {
      const points = draft(ctx,params);
      const first = points[0];
      if (first && points.length >= 3 && Math.hypot(first.point.x-sample.point.x,first.point.z-sample.point.z)<0.25) {
        commitPlatformContour(ctx,points,parametersAt(ctx,first,params)); points.length = 0;
      } else {
        points.push(polygonCorner(ctx,params,sample));
        ctx.reportFeedback({ tone: "info", message: "Marque os cantos e clique no primeiro para fechar. Esc cancela." });
      }
    } else {
      ctx.reportFeedback({ tone: "info", message: shape === "rectangle" ? "Arraste de um canto ao canto oposto. Para ampliar, cubra a borda e a área nova." : "Arraste um contorno fechado; a correção ajusta retas e curvas." });
    }
  },
  onPointerUp(ctx,gesture,params) {
    const shape = params.shape ?? "rectangle";
    if (shape === "circle" || shape === "polygon") return;
    if (gesture.samples.length < 2) return;
    const effective = parametersAt(ctx,gesture.start,params);
    if (shape === "rectangle") {
      const corners = rectangle(ctx,gesture.start,gesture.current,effective.elevation);
      if (!corners) {
        ctx.reportFeedback({ tone: "error", message: "Arraste na diagonal para desenhar uma área." }); return;
      }
      commitPlatformContour(ctx,corners,effective);
    } else {
      const points = gesture.samples.map((s) => ({ ...s.point,y:effective.elevation }));
      const first = points[0]!, last = points.at(-1)!;
      if (Math.hypot(first.x-last.x,first.z-last.z)>1e-5) points.push(first);
      const fitted = fitPath(points,params.tolerance ?? 0.15,{ curves: ctx.snapToGrid ? "none" : "arc" });
      commitPlatformShape(ctx,fitted,effective,gesture.samples);
    }
    drafts.delete(ctx.runtime);
  },
};

/** Also grabs and edits an existing platform's own vertex/edge/body -- see `structure-edit-behavior.ts`. */
export const platformContourTool = withStructureEditing(rawPlatformContourTool, { ownsType: (surfaceType) => hasTrait(surfaceType, "floor"), handlesOnly: true });
