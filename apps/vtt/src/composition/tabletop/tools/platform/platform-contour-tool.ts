import { DEFAULT_TOOL_PARAMS, faceOverlapsOutline, faceTouchesOutline, fitPath, hasTrait, outlineOf, planarDifference, planarUnion, platformStructureType, weldFreeEndsOnto } from "../../../../features/edit-construction/index.ts";
import type { FittedEdge, ToolParamsByTool } from "../../../../features/edit-construction/index.ts";
import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";
import type { ConstructionPosition, ConstructionRegionTopology } from "../../../../ports/index.ts";
import { createBoundaryEdges, reverseGeometry } from "../core/boundary-edges.ts";
import { commitPatchReplacement } from "../../effects/effect-commit.ts";
import { scopedToolId, type ConstructionTool, type PointerSample, type ToolContext } from "../core/tool-context.ts";
import { withStructureEditing } from "../core/structure-edit-behavior.ts";
import { contourStroke } from "../core/contour-stroke.ts";
import { polylineSegmentsPreview, segmentsPreview } from "../shapes/preview-shapes.ts";
import { groupLoopsByContainment, splitContourAtPoints, weldedMerge, windLoop, type DirectedContourEdge } from "./platform-contour-merge.ts";
type Params = ToolParamsByTool["platform-contour"];
const COLOR = 0x79b8e8;
/** A shape that would add nothing -- it lies wholly over floors of its kind. */
const BLOCKED_COLOR = 0xd9534f;
/** Same corner-weld tolerance a wall run already snaps onto an existing column with. */
const WELD_TOLERANCE = 0.25;
/** The type a stroke draws, and the only type it extends or cuts. */
const surfaceTypeOf = (_params: Params): string => platformStructureType.surfaceType;
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
 * Commits the same directed line/arc contour vocabulary consumed by wall
 * construction. Ampliar/juntar and recortar/separar no longer run an
 * analytic boolean against the standing platform: the stroke has to weld
 * onto the existing boundary (within {@link WELD_TOLERANCE}, the same one a
 * wall run snaps onto a column with) and the result is assembled from
 * shared/cancelled edges -- see `platform-contour-merge.ts` for why.
 */
export function commitPlatformShape(ctx: ToolContext, contour: readonly FittedEdge[], params: Params, pickedSamples: readonly PointerSample[] = [], options: { readonly clipped?: boolean; readonly alone?: boolean } = {}): void {
  try {
    if (!Number.isFinite(params.elevation)) throw new Error("A elevação deve ser finita.");
    if (contour.length < 2) throw new Error("Desenhe uma área com largura e comprimento.");
    const all = ctx.runtime.getAllRegionTopologies();
    const graph = ctx.runtime.getGraphSnapshot();
    // Picking the terrain below a drawing plane is not an instruction to weld floors.
    const picked = new Set(pickedSamples.flatMap((s) => s.nodeId ? [s.nodeId] : []));
    const level = all.filter((t) => t.surfaceType === surfaceTypeOf(params) && t.nodes.every((n) => Math.abs(n.position.y - params.elevation) < 1e-4));
    // One cloud's faces never lie over each other: they mesh with holes where
    // they cross. A floor drawn over one of its own kind at its height is
    // united with it into one floor -- the U closed into a ring, one cloud,
    // no face over another. Where that union cannot be taken exactly -- a
    // curved edge on either side -- it stands apart instead: its own cloud,
    // sharing not one node, and so does everything that floor's cloud holds.
    const drawnOutline = outlineOf(contour);
    const overlapped = params.mode === "create" ? level.filter((t) => faceOverlapsOutline(t, drawnOutline)) : [];
    const straight = (t: ConstructionRegionTopology) => [...t.outerLoops, ...t.holes].flat().every((use) => use.geometry.kind !== "arc");
    const touching = params.mode === "create" && !options.alone ? level.filter((t) => !overlapped.includes(t) && faceTouchesOutline(t, drawnOutline, WELD_TOLERANCE)) : [];
    // Already cut back to what the standing floors leave free: any overlap left is rounding, never cut again.
    const unites = !options.clipped && overlapped.length > 0 && contour.every((c) => c.geometry.kind !== "arc") && [...overlapped, ...touching].every(straight);
    const apart = new Set(unites ? [] : overlapped.flatMap((t) => ctx.runtime.cloudFor({ seed: t.surfaceKey, surfaceType: t.surfaceType }).surfaceKeys.map((key) => key.join("\u0000"))));
    if (!unites) for (const t of overlapped) apart.add(t.surfaceKey.join("\u0000"));
    const apartNodes = new Set(level.filter((t) => apart.has(t.surfaceKey.join("\u0000"))).flatMap((t) => t.nodes.map((n) => n.id)));
    // A floor drawn against one of its own kind at its own height -- only
    // touching it -- joins it: the two become one floor, as extending would
    // make them, rather than two faces lying edge to edge unconnected.
    const joins = params.mode === "create" ? [...(unites ? overlapped : []), ...touching.filter((t) => !apart.has(t.surfaceKey.join("\u0000")))] : [];
    const sources = params.mode === "create" ? joins : level;
    if (params.mode !== "create" && sources.length === 0) throw new Error("Nenhuma plataforma nessa elevação. Comece sobre a plataforma ou escolha a elevação correta.");

    const operationId = scopedToolId(ctx, "platform", ctx.nextSequence());
    const retained = new Map(sources.flatMap((t) => t.nodes.map((n) => [n.id,n] as const)));
    for (const n of graph.nodes) if (picked.has(n.id) && !apartNodes.has(n.id) && Math.abs(n.position.y - params.elevation) < 1e-4) retained.set(n.id,n);
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
        if (Math.abs(n.position.y-params.elevation) > 1e-3 || apartNodes.has(n.id)) continue;
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
    if (unites) {
      // The standing floors are the drawn one's limits, never reshaped by it:
      // it keeps only what they leave free, and that joins them along their
      // own edges. Only a floor drawn round a standing one -- what is left
      // would ring it -- takes the standing one in whole.
      const polygonOf = (t: ConstructionRegionTopology) => {
        const at = new Map(t.nodes.map((n) => [n.id, n.position]));
        return [...t.outerLoops, ...t.holes].map((loop) => loop.map((use) => [at.get(use.startNodeId)!.x, at.get(use.startNodeId)!.z] as const));
      };
      const free = planarDifference(ctx.runtime, [contour.map((c) => [c.start.x, c.start.z] as const)], ...overlapped.map(polygonOf));
      if (free.some((polygon) => polygon.length > 1)) {
        commitUnion(ctx, params, operationId, sources, contour, nodeAt, positionOf, () => [...nodes.values()]);
        return;
      }
      if (free.length === 0) { ctx.reportFeedback({ tone: "info", message: "A área já está coberta pela plataforma." }); return; }
      for (const polygon of free) {
        const ring = polygon[0]!.slice(0, -1).map(([x, z]) => ({ x, y: params.elevation, z }));
        commitPlatformShape(ctx, ring.map((start, i) => ({ start, end: ring[(i + 1) % ring.length]!, geometry: { kind: "line" as const } })), params, [], { clipped: true });
      }
      return;
    }
    const clipPoints = [...new Set(clipEdges.flatMap((e) => [e.a,e.b]))].map((id) => ({ id, position: positionOf(id) }));
    const standingPoints = [...new Set(standingRaw.flatMap((e) => [e.a,e.b]))].map((id) => ({ id, position: positionOf(id) }));
    const standing = splitContourAtPoints(ctx.runtime, standingRaw, clipPoints, positionOf, WELD_TOLERANCE);
    const splitClipEdges = splitContourAtPoints(ctx.runtime, clipEdges, standingPoints, positionOf, WELD_TOLERANCE);
    const merged = weldedMerge(standing, splitClipEdges);
    if (merged.kind === "error") {
      // A piece already cut back to the free area meets the standing floors only along their edges:
      // their exact union is the same floor, taken on points instead of welded edge by edge.
      if (options.clipped) { commitUnion(ctx, params, operationId, sources, contour, nodeAt, positionOf, () => [...nodes.values()]); return; }
      // Touching a floor only at a corner -- no side to weld along -- it is its own face, holding that corner with it.
      if (params.mode === "create" && !options.alone) { commitPlatformShape(ctx, contour, params, pickedSamples, { alone: true }); return; }
      ctx.reportFeedback({ tone: "error", message: merged.message }); return;
    }
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
    ctx.reportFeedback({ tone: "success", message: overlapped.length > 0 && !unites
      ? `Plataforma sobreposta a outra: fica separada dela, na elevação ${params.elevation}.`
      : `Plataforma: ${regions.length} face(s) na elevação ${params.elevation}.` });
  } catch (error) { ctx.reportFeedback({ tone: "error", message: error instanceof Error ? error.message : String(error) }); }
}
/**
 * What the closed `outline` would add as a floor of `params`' kind: the
 * outline less every floor of that kind it lies over at its level -- what
 * `commitPlatformShape` commits. `undefined` when it lies over none, or a
 * curved edge makes that area inexact, so the outline stands as drawn.
 */
function freeArea(ctx: ToolContext, outline: readonly ConstructionPosition[], params: Params) {
  const level = ctx.runtime.getAllRegionTopologies().filter((t) => t.surfaceType === surfaceTypeOf(params) && t.nodes.every((n) => Math.abs(n.position.y - params.elevation) < 1e-4));
  const overlapped = level.filter((t) => faceOverlapsOutline(t, outline));
  if (overlapped.length === 0 || overlapped.some((t) => [...t.outerLoops, ...t.holes].flat().some((use) => use.geometry.kind === "arc"))) return undefined;
  const polygonOf = (t: ConstructionRegionTopology) => {
    const at = new Map(t.nodes.map((n) => [n.id, n.position]));
    return [...t.outerLoops, ...t.holes].map((loop) => loop.map((use) => [at.get(use.startNodeId)!.x, at.get(use.startNodeId)!.z] as const));
  };
  return planarDifference(ctx.runtime, [outline.map((p) => [p.x, p.z] as const)], ...overlapped.map(polygonOf));
}

/**
 * `sources` and the drawn `contour` replaced by their union, as floors of
 * the drawn type: every corner the union keeps where a floor already had
 * one is that floor's own node -- so what is welded there stays welded --
 * and the rest are new. Only straight edges come here: the union is taken
 * on points.
 */
function commitUnion(
  ctx: ToolContext,
  params: Params,
  operationId: string,
  sources: readonly ConstructionRegionTopology[],
  contour: readonly FittedEdge[],
  nodeAt: (p: readonly [number, number]) => string,
  positionOf: (id: string) => readonly [number, number],
  created: () => readonly { id: string; position: ConstructionPosition }[],
): void {
  const polygonOf = (t: ConstructionRegionTopology) => {
    const at = new Map(t.nodes.map((n) => [n.id, n.position]));
    return [...t.outerLoops, ...t.holes].map((loop) => loop.map((use) => [at.get(use.startNodeId)!.x, at.get(use.startNodeId)!.z] as const));
  };
  const area = planarUnion(ctx.runtime, [contour.map((c) => [c.start.x, c.start.z] as const)], ...sources.map(polygonOf));
  const used = new Set<string>();
  const loopOf = (ring: readonly (readonly [number, number])[]): DirectedContourEdge[] => {
    const ids = ring.slice(0, -1).map((p) => nodeAt(p)).filter((id, i, all) => id !== all[(i + all.length - 1) % all.length]);
    for (const id of ids) used.add(id);
    return ids.map((a, i) => ({ a, b: ids[(i + 1) % ids.length]!, geometry: { kind: "line" as const } }));
  };
  const builder = createBoundaryEdges(operationId, { kind: "private-when-full", runPrefix: operationId, existingUses: new Map() });
  const regions = area.map((polygon, index) => ({
    regionId: `${operationId}:face:${index}`,
    boundary: windLoop(ctx.runtime, loopOf(polygon[0]!), positionOf, "boundary").map((e) => builder.use(e.a, e.b, e.geometry)),
    holes: polygon.slice(1).map((hole) => windLoop(ctx.runtime, loopOf(hole), positionOf, "hole").map((e) => builder.use(e.a, e.b, e.geometry))),
    surfaceType: surfaceTypeOf(params),
    physical: true,
  })).filter((region) => region.boundary.length >= 3);
  if (regions.length === 0) throw new Error("O contorno precisa delimitar uma área.");
  const { recorded } = commitPatchReplacement(ctx.runtime, {
    operationId,
    sourceSurfaceKeys: sources.map((t) => t.surfaceKey),
    // Only the corners the union kept: a drawn corner it swallowed is no node at all.
    patch: { nodes: created().filter((node) => used.has(node.id)), edges: builder.all(), regions },
    footprintOutline: area[0]![0]!.slice(0, -1).map(([x, z]) => [x, z] as const),
  }, {
    transactionId: operationId,
    afterward: (outcome) => {
      const welds = weldFreeEndsOnto(ctx.runtime.getGraphSnapshot(), ctx.runtime.getAllRegionTopologies(), outcome.createdSurfaceKeys, `${operationId}:ends`);
      if (welds) ctx.runtime.applyPatchReplacement(welds, "local", operationId);
    },
  });
  if (recorded) ctx.history.record({ kind: "transaction", transactionId: operationId });
  ctx.reportFeedback({ tone: "success", message: `Plataforma unida: ${regions.length} face(s) na elevação ${params.elevation}.` });
}

/** Polygon entry point retained for callers that already have explicit corners. */
export function commitPlatformContour(ctx: ToolContext, samples: readonly PointerSample[], params: Params): void {
  commitPlatformShape(ctx, lines(samples,params.elevation),params,samples);
}
const rawPlatformContourTool: ConstructionTool<"platform-contour"> = {
  id: "platform-contour",
  // Snapped in the frame each shape is built in, never to the world's fixed grid.
  useGridSnap: false,
  previewOnHover: true,
  defaultParams: () => DEFAULT_TOOL_PARAMS["platform-contour"],
  ...contourStroke<"platform-contour", Params>({
    color: COLOR,
    levelAt: (ctx, first, params) => parametersAt(ctx, first, params).elevation,
    commit: (ctx, contour, level, params, samples) => commitPlatformShape(ctx, contour, { ...params, elevation: level }, samples),
    // A closed shape shows only what it will add: the floors of its kind it lies over are its limits.
    previewClosed: (ctx, outline, level, params) => {
      const effective = { ...params, elevation: level };
      if (effective.mode !== "create") return undefined;
      const free = freeArea(ctx, outline, effective);
      if (!free) return undefined;
      return free.length === 0
        ? polylineSegmentsPreview([...outline, outline[0]!], BLOCKED_COLOR, 0.45)
        : segmentsPreview(free.flatMap((polygon) => polygon.flatMap((ring) => ring.slice(0, -1).flatMap(([x, z], i) => {
          const [nx, nz] = ring[i + 1]!;
          return [x, level, z, nx, level, nz];
        }))), COLOR);
    },
    dragHint: (shape) => (shape === "rectangle" ? "Arraste de um canto ao canto oposto. Para ampliar, cubra a borda e a área nova." : "Arraste um contorno fechado; a correção ajusta retas e curvas."),
  }),
};

/** Also grabs and edits an existing platform's own vertex/edge/body -- see `structure-edit-behavior.ts`. */
export const platformContourTool = withStructureEditing(rawPlatformContourTool, { ownsType: (surfaceType) => hasTrait(surfaceType, "floor"), handlesOnly: true });
