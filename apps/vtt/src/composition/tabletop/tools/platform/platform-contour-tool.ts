import { DEFAULT_TOOL_PARAMS, fitPath } from "../../../../features/edit-construction/index.ts";
import type { FittedEdge, ToolParamsByTool } from "../../../../features/edit-construction/index.ts";
import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";
import type { ConstructionPosition, ConstructionRegionTopology } from "../../../../ports/index.ts";
import { createBoundaryEdges, reverseGeometry } from "../core/boundary-edges.ts";
import { scopedToolId, type ConstructionTool, type PointerSample, type ToolContext } from "../core/tool-context.ts";
import { polylineSegmentsPreview, segmentsPreview } from "../shapes/preview-shapes.ts";
import { circleContour, previewOutline } from "../tower/tower-geometry.ts";
import { groupLoopsByContainment, splitContourAtPoints, weldedMerge, type DirectedContourEdge } from "./platform-contour-merge.ts";

type Params = ToolParamsByTool["platform-contour"];
const COLOR = 0x79b8e8;
/** Same corner-weld tolerance a wall run already snaps onto an existing column with. */
const WELD_TOLERANCE = 0.25;
const drafts = new WeakMap<object, { key: string; points: PointerSample[] }>();
function draft(ctx: ToolContext, params: Params): PointerSample[] {
  const key = JSON.stringify(params);
  let current = drafts.get(ctx.runtime);
  if (!current || current.key !== key) { current = { key, points: [] }; drafts.set(ctx.runtime, current); }
  return current.points;
}
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
  const target = params.mode === "create" ? undefined : ctx.runtime.getAllRegionTopologies().find((t) => t.surfaceType === "platform" &&
    (first.surfaceRef ? surfaceRefFromNodeSet(t.surfaceKey) === first.surfaceRef : first.nodeId && t.nodes.some((n) => n.id === first.nodeId)));
  if (target?.nodes[0]) return { ...params, elevation: target.nodes[0].position.y };
  const node = first.nodeId ? ctx.runtime.getGraphSnapshot().nodes.find((n) => n.id === first.nodeId) : undefined;
  return node ? { ...params, elevation: node.position.y } : params;
}
/** A source region's own boundary/hole edges, by node id -- the identities a stroke has to weld onto, not the position it happens to occupy. */
function sourceEdges(topology: ConstructionRegionTopology): readonly (readonly DirectedContourEdge[])[] {
  return [...topology.outerLoops, ...topology.holes].map((loop) => loop.map((edge) => ({
    a: edge.startNodeId,
    b: edge.endNodeId,
    geometry: edge.reversed ? reverseGeometry(edge.geometry) : edge.geometry,
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
function rectangle(a: PointerSample, b: PointerSample, elevation: number): readonly PointerSample[] {
  return [a, { point: { x: b.point.x, y: elevation, z: a.point.z } }, b, { point: { x: a.point.x, y: elevation, z: b.point.z } }];
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
    const sources = params.mode === "create" ? [] : all.filter((t) => t.surfaceType === "platform" && t.nodes.every((n) => Math.abs(n.position.y - params.elevation) < 1e-4));
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
    const clipEdges: DirectedContourEdge[] = contour.map((c) => params.mode === "cut"
      ? { a: nodeAt([c.end.x,c.end.z]), b: nodeAt([c.start.x,c.start.z]), geometry: reverseGeometry(c.geometry) }
      : { a: nodeAt([c.start.x,c.start.z]), b: nodeAt([c.end.x,c.end.z]), geometry: c.geometry });
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
    const standing = splitContourAtPoints(standingRaw, clipPoints, positionOf, WELD_TOLERANCE);
    const splitClipEdges = splitContourAtPoints(clipEdges, standingPoints, positionOf, WELD_TOLERANCE);
    const merged = weldedMerge(standing, splitClipEdges);
    if (merged.kind === "error") { ctx.reportFeedback({ tone: "error", message: merged.message }); return; }
    let groups = groupLoopsByContainment(merged.loops, positionOf);
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
    const regions = changedGroups.map((group,index) => ({
      regionId: `${operationId}:face:${index}`,
      boundary: group.boundary.map((e) => builder.use(e.a,e.b,e.geometry)),
      holes: group.holes.map((hole) => hole.map((e) => builder.use(e.a,e.b,e.geometry))),
      surfaceType: "platform",
      physical: true,
    }));
    ctx.runtime.applyPatchReplacement({ operationId, sourceSurfaceKeys: remaining.map(({ source }) => source.surfaceKey), patch: { nodes: [...nodes.values()], edges: builder.all(), regions } }, "local", operationId);
    ctx.history.record({ kind: "path-brush", operationId });
    ctx.reportFeedback({ tone: "success", message: `Plataforma: ${regions.length} face(s) na elevação ${params.elevation}.` });
  } catch (error) { ctx.reportFeedback({ tone: "error", message: error instanceof Error ? error.message : String(error) }); }
}
/** Polygon entry point retained for callers that already have explicit corners. */
export function commitPlatformContour(ctx: ToolContext, samples: readonly PointerSample[], params: Params): void {
  commitPlatformShape(ctx, lines(samples,params.elevation),params,samples);
}
export const platformContourTool: ConstructionTool<"platform-contour"> = {
  id: "platform-contour",
  previewOnHover: true,
  defaultParams: () => DEFAULT_TOOL_PARAMS["platform-contour"],
  onCancel(ctx) { drafts.delete(ctx.runtime); },
  previewFor(gesture, params, ctx) {
    const points = draft(ctx,params);
    const effective = parametersAt(ctx,points[0] ?? gesture.start,params);
    const shape = params.shape ?? "rectangle";
    if (shape === "rectangle" && gesture.start.point.x === gesture.current.point.x && gesture.start.point.z === gesture.current.point.z) return undefined;
    if (shape === "circle") return segmentsPreview(previewOutline({ ...gesture.current.point, y: effective.elevation },params.radius ?? 2.5,48),COLOR);
    const samples = shape === "rectangle" ? rectangle(gesture.start,gesture.current,effective.elevation) : [...points,...gesture.samples];
    const outline = samples.map((s) => ({ ...s.point,y: effective.elevation }));
    return polylineSegmentsPreview(outline.length > 2 ? [...outline,outline[0]!] : outline,COLOR);
  },
  onClick(ctx,sample,params) {
    const shape = params.shape ?? "rectangle";
    if (shape === "circle") {
      const effective = parametersAt(ctx,sample,params);
      commitPlatformShape(ctx,circleContour({ ...sample.point,y:effective.elevation },params.radius ?? 2.5),effective);
    } else if (shape === "polygon") {
      const points = draft(ctx,params);
      const first = points[0];
      if (first && points.length >= 3 && Math.hypot(first.point.x-sample.point.x,first.point.z-sample.point.z)<0.25) {
        commitPlatformContour(ctx,points,parametersAt(ctx,first,params)); points.length = 0;
      } else {
        points.push(sample);
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
      if (Math.abs(gesture.start.point.x-gesture.current.point.x)<1e-5 || Math.abs(gesture.start.point.z-gesture.current.point.z)<1e-5) {
        ctx.reportFeedback({ tone: "error", message: "Arraste na diagonal para desenhar uma área." }); return;
      }
      commitPlatformContour(ctx,rectangle(gesture.start,gesture.current,effective.elevation),effective);
    } else {
      const points = gesture.samples.map((s) => ({ ...s.point,y:effective.elevation }));
      const first = points[0]!, last = points.at(-1)!;
      if (Math.hypot(first.x-last.x,first.z-last.z)>1e-5) points.push(first);
      const fitted = fitPath(points,params.tolerance ?? 0.15,{ arcs: !ctx.snapToGrid });
      commitPlatformShape(ctx,fitted,effective,gesture.samples);
    }
    drafts.delete(ctx.runtime);
  },
};
