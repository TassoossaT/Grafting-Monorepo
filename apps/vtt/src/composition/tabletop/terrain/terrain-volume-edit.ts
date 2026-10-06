import type {
  ConstructionNodeId,
  ConstructionPosition,
  ConstructionRegionTopology,
  ConstructionVolumeShape,
} from "@/ports";

import { hasTrait } from "../../../features/edit-construction/index.ts";
import { commitGround, indexedFaces } from "./ground-commit.ts";
import { grownInward, walkSurface } from "./ground-surface.ts";
import type { ToolContext } from "../tools/core/tool-context.ts";

/**
 * Carving into the ground and filling it in, in three dimensions, as an edit
 * of the ground's own mesh -- no layer beside it, nothing kept but the graph.
 *
 * A stroke names a shape: a capsule along its path. The terrain faces within
 * its reach are laid again by the engine (`editTerrainVolume`): their mesh,
 * with the ground round them, says where solid is; the shape is carved out
 * of it or filled into it; the new surface is stitched to the ring of nodes
 * round those faces and laid with the irregular grid's own cells over the
 * surface. What comes back goes into the graph as ground of the same type,
 * sharing the ring's very nodes and edges, so it is one mesh with the rest:
 * the next stroke, carving or not, edits it the same way.
 */

/** How far past a layer's radius, in faces, the faces laid again reach: it changes nothing past it. */
const LAYER_MARGIN_FACES = 0.25;
/** How far past a shape's reach, in faces, the faces laid again reach. */
const PATCH_MARGIN_FACES = 2;
/** How far past the faces laid again, in faces, the ground asked where solid is reaches. */
const CONTEXT_MARGIN_FACES = 4;

/** How thin a shape is at its thinnest, the scale its blend is taken from: the engine's `Shape::thickness`, but a layer by its height too. */
function thicknessOf(shape: ConstructionVolumeShape): number {
  // A layer blends into nothing: its own height is the scale it changes the ground at.
  if (shape.effect === "raise" || shape.effect === "lower") return Math.min(shape.radius, Math.abs(shape.height ?? shape.radius));
  if (shape.column) return Math.min(shape.radius, Math.max(1e-3, (shape.column.high - shape.column.low) / 2));
  return shape.radius * Math.min(1, Math.max(1e-3, shape.squash ?? 1));
}

/** How far the shapes blend into the ground round them. */
const blendOf = (shapes: readonly ConstructionVolumeShape[]) => Math.min(...shapes.map(thicknessOf)) * 0.35;

/** Distance from `point` to `path`, heights scaled by `yScale`. */
function distanceToPath(point: ConstructionPosition, path: ConstructionVolumeShape["path"], yScale = 1): number {
  const px = point.x, py = point.y * yScale, pz = point.z;
  if (path.length === 1) return Math.hypot(px - path[0]![0], py - path[0]![1] * yScale, pz - path[0]![2]);
  let best = Infinity;
  for (let i = 0; i + 1 < path.length; i++) {
    const [ax, ay0, az] = path[i]!, [bx, by0, bz] = path[i + 1]!;
    const ay = ay0 * yScale, by = by0 * yScale;
    const dx = bx - ax, dy = by - ay, dz = bz - az, l = dx * dx + dy * dy + dz * dz;
    const t = l > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / l)) : 0;
    best = Math.min(best, Math.hypot(px - ax - dx * t, py - ay - dy * t, pz - az - dz * t));
  }
  return best;
}

/** Signed distance to a shape, negative inside -- the engine's own (`Shape::distance`). */
export function shapeDistance(point: ConstructionPosition, shape: ConstructionVolumeShape): number {
  // A layer reaches as far as the capsule round its path.
  if (shape.effect === "raise" || shape.effect === "lower") return distanceToPath(point, shape.path) - shape.radius;
  if (shape.column) {
    const across = distanceToPath(point, shape.path, 0) - shape.radius;
    const up = Math.max(shape.column.low - point.y, point.y - shape.column.high);
    return Math.hypot(Math.max(across, 0), Math.max(up, 0)) + Math.min(Math.max(across, up), 0);
  }
  const squash = Math.max(1e-3, shape.squash ?? 1);
  return (distanceToPath(point, shape.path, 1 / squash) - shape.radius) * Math.min(1, squash);
}

/** A face's own ring of node ids, in its walk order; `undefined` for a face with holes, which this edit leaves alone. */
function ringOf(topology: ConstructionRegionTopology): readonly ConstructionNodeId[] | undefined {
  if (topology.holes.length > 0 || topology.outerLoops.length !== 1) return undefined;
  return topology.outerLoops[0]!.map((use) => use.startNodeId);
}

/** The face size of the ground being laid again: the median side of its faces. */
function faceSideOf(faces: readonly ConstructionRegionTopology[]): number {
  const sides = faces.flatMap((face) => face.outerLoops.flat().map((use) => {
    const a = face.nodes.find((n) => n.id === use.startNodeId)!.position, b = face.nodes.find((n) => n.id === use.endNodeId)!.position;
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  })).sort((a, b) => a - b);
  return Math.max(0.75, Math.min(6, sides[sides.length >> 1] ?? 2));
}

/**
 * Carves `shapes` into the ground or fills them in, in order, as one
 * transaction. With `table`, new ground may rest on the bare table -- a fill
 * where no ground stands at all lays it there. No faces where no ground is in
 * reach and nothing may rest on the table; throws where nothing could be
 * laid, the ground then left as it was.
 */
export function commitTerrainVolumeEdit(
  ctx: ToolContext,
  shapes: readonly ConstructionVolumeShape[],
  options: {
    readonly faceSide?: number;
    readonly seed: number;
    readonly table?: number;
    readonly surfaceType?: string;
    /** The face size to lay where no ground stands to take it from. */
    readonly emptyFaceSide?: number;
  },
): { readonly faces: number } {
  if (shapes.length === 0) throw new Error("nada a cavar ou erguer");
  const blend = blendOf(shapes);
  const xs = shapes.flatMap((shape) => shape.path.map((p) => p[0])), zs = shapes.flatMap((shape) => shape.path.map((p) => p[2]));
  const widest = Math.max(...shapes.map((shape) => shape.radius));
  const guess = options.faceSide ?? 2;
  const margin = blend + PATCH_MARGIN_FACES * guess;
  const outer = widest + margin + CONTEXT_MARGIN_FACES * guess;
  const standing = ctx.runtime.getRegionTopologiesInBounds({
    minX: Math.min(...xs) - outer, minZ: Math.min(...zs) - outer, maxX: Math.max(...xs) + outer, maxZ: Math.max(...zs) + outer,
  });
  const nearby = standing.filter((topology) => hasTrait(topology.surfaceType, "ground") && ringOf(topology) !== undefined);
  // Structures standing in the ground: the sides of it they hold are kept.
  const structures = standing.filter((topology) => !hasTrait(topology.surfaceType, "ground") && ringOf(topology) !== undefined);
  // The faces the shapes change, and round them, over the surface, as far as
  // the shapes reach in three dimensions: a cave's ceiling over a layer laid
  // on its floor is neither changed nor reached, and never laid again. A
  // layer or a level changes only what it covers, so it reaches a face
  // further; a bore or an arch is given more room to blend.
  const reachOf = (shape: ConstructionVolumeShape) =>
    blend + (shape.effect === "raise" || shape.effect === "lower" ? LAYER_MARGIN_FACES : shape.column ? 1 : PATCH_MARGIN_FACES) * guess;
  const within = (topology: ConstructionRegionTopology, extra: (shape: ConstructionVolumeShape) => number) =>
    topology.nodes.some((node) => shapes.some((shape) => shapeDistance(node.position, shape) < extra(shape)));
  // Grown from the ground under the stroke itself -- the face nearest each
  // point of every path -- never from whatever lies near in three dimensions:
  // through a thin roof, a tunnel's ceiling lies a metre under the hill a
  // stroke is laid on, and is no part of it.
  const under = (point: readonly [number, number, number]) => {
    let best: ConstructionRegionTopology | undefined, bestDistance = Infinity;
    for (const topology of nearby) {
      for (const node of topology.nodes) {
        const d = Math.hypot(node.position.x - point[0], node.position.y - point[1], node.position.z - point[2]);
        if (d < bestDistance) {
          bestDistance = d;
          best = topology;
        }
      }
    }
    return best;
  };
  const core = shapes.flatMap((shape) => shape.path.map(under)).filter((topology): topology is ConstructionRegionTopology => topology !== undefined && within(topology, reachOf));
  const walked = walkSurface(nearby, core.length > 0 ? core : nearby.filter((topology) => within(topology, reachOf)), (topology) => within(topology, reachOf));
  if (walked.length === 0 && options.table === undefined) return { faces: 0 };
  const neighbours = indexedFaces(structures);
  const attempt = (patchFaces: readonly ConstructionRegionTopology[]) => {
    const patchKeys = new Set(patchFaces.map((face) => face.surfaceKey.join("\u0000")));
    const contextFaces = nearby.filter((topology) => !patchKeys.has(topology.surfaceKey.join("\u0000")));
    // The ground's own face size; the engine lays finer where the shape is narrow.
    const faceSide = options.faceSide ?? (patchFaces.length > 0 ? faceSideOf(patchFaces) : options.emptyFaceSide ?? 2);
    const patch = indexedFaces(patchFaces);
    const context = indexedFaces(contextFaces);
    const edited = ctx.runtime.editTerrainVolume({
      patch: { vertices: patch.vertices, faces: patch.faces },
      context: { vertices: context.vertices, faces: context.faces },
      shapes,
      blend,
      faceSide,
      seed: options.seed,
      ...(options.table !== undefined ? { table: options.table } : {}),
      neighbours: { vertices: neighbours.vertices, faces: neighbours.faces },
    });
    return edited ? { edited, patch, patchFaces, contextFaces, faceSide } : undefined;
  };
  // A hole in the patch the edit closes over is laid again with it: tried as
  // walked first, then grown inward from its holes a ring at a time -- a
  // patch no larger than the last one tried is the same refusal, never asked twice.
  const tries = [walked, grownInward(walked, nearby, 1), grownInward(walked, nearby, 2)];
  const laid = tries.reduce<ReturnType<typeof attempt>>((done, patchFaces, index) => done ?? (index > 0 && patchFaces.length === tries[index - 1]!.length ? undefined : attempt(patchFaces)), undefined);
  if (!laid) throw new Error("o núcleo recusou a edição");
  const { edited, patch, patchFaces, contextFaces, faceSide } = laid;
  const surfaceType = patchFaces[0]?.surfaceType ?? options.surfaceType ?? "terrain";

  const operationId = `${ctx.tableId}:terrain-volume:${ctx.nextSequence()}`;
  let built = 0;
  const { recorded } = ctx.runtime.transact(operationId, "local", () => {
    built = commitGround(ctx.runtime, {
      operationId,
      tableId: ctx.tableId,
      replaced: patchFaces,
      around: contextFaces,
      surfaceType,
      faceSide,
      laid: {
        vertices: edited.vertices,
        faces: edited.faces,
        nodeOf: (vertex) => {
          const source = edited.source[vertex];
          return source === null || source === undefined ? undefined : patch.ids[source];
        },
      },
    }).built;
  });
  if (recorded) ctx.history.record({ kind: "transaction", transactionId: operationId });
  return { faces: built };
}

/** At least this far between the points a stroke's path keeps, as a fraction of its radius. */
const PATH_STEP = 0.75;

/**
 * How far over the point it starts on a carve's axis runs, as a fraction of
 * its radius: its floor on the ground there, never under it -- sunk, it would
 * dig a trench everywhere the stroke crosses level ground on its way into a
 * hill; on it, the tunnel opens only where the hill rises over its floor.
 */
const CARVE_AXIS_RISE = 1.05;

/** The pointer's path, thinned to a point every so often, the last kept. */
function thinned(points: readonly ConstructionPosition[], step: number): ConstructionPosition[] {
  const kept: ConstructionPosition[] = [];
  for (const point of points) {
    const last = kept.at(-1);
    if (!last || Math.hypot(point.x - last.x, point.z - last.z) >= step) kept.push(point);
  }
  const end = points.at(-1);
  if (end && kept.at(-1) !== end && kept.length > 1) kept[kept.length - 1] = end;
  return kept;
}

/**
 * A carve pushed into the ground from where the stroke starts: level at that
 * height, its floor on the ground there, running wherever the stroke runs in
 * plan. A click without a drag is a ball sunk into the ground there.
 */
export function carveShape(points: readonly ConstructionPosition[], radius: number): ConstructionVolumeShape | undefined {
  const path = thinned(points, radius * PATH_STEP);
  if (path.length === 0) return undefined;
  if (path.length === 1) return { effect: "carve", radius, path: [[path[0]!.x, path[0]!.y, path[0]!.z]] };
  const y = path[0]!.y + radius * CARVE_AXIS_RISE;
  return { effect: "carve", radius, path: path.map((p) => [p.x, y, p.z] as const) };
}

/**
 * Earth filled in from where the stroke starts to where it ends: its feet in
 * the ground at both, arched `rise` over the line between them -- a bridge.
 * A click without a drag is a mound.
 */
export function fillShape(points: readonly ConstructionPosition[], radius: number, rise: number): ConstructionVolumeShape | undefined {
  const path = thinned(points, radius * PATH_STEP);
  if (path.length === 0) return undefined;
  if (path.length === 1) return { effect: "fill", radius, path: [[path[0]!.x, path[0]!.y, path[0]!.z]] };
  const lengths = [0];
  for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1]! + Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.z - path[i - 1]!.z));
  const total = lengths.at(-1)!;
  const [start, end] = [path[0]!, path.at(-1)!];
  return {
    effect: "fill",
    radius,
    path: path.map((p, i) => {
      const t = total > 0 ? lengths[i]! / total : 0;
      return [p.x, start.y + (end.y - start.y) * t + rise * Math.sin(Math.PI * t), p.z] as const;
    }),
  };
}

/** Where the volume a stroke would carve or fill runs, for its ghost: the very path the commit uses. */
export function volumeStrokePath(mode: "carve" | "fill", points: readonly ConstructionPosition[], radius: number, rise: number): readonly ConstructionPosition[] {
  const shape = mode === "carve" ? carveShape(points, radius) : fillShape(points, radius, rise);
  return shape ? shape.path.map(([x, y, z]) => ({ x, y, z })) : [];
}

/**
 * A layer of earth laid along a stroke -- or the trench dug along it:
 * `height` deep where the stroke ran, thinning to nothing at the brush's
 * radius, over the ground it lies on -- a hillside, a cave's floor or its
 * wall alike.
 */
export function moundShape(effect: "raise" | "lower", points: readonly ConstructionPosition[], radius: number, height: number): ConstructionVolumeShape | undefined {
  const path = thinned(points, radius * PATH_STEP);
  if (path.length === 0) return undefined;
  return { effect, radius, height, path: path.map((p) => [p.x, p.y, p.z] as const) };
}

/**
 * Levelling along a stroke at the height it starts on: the column over the
 * stroke's plan filled up to that level and cut down to it, `reach` above
 * and below and no further -- never up to a cave's ceiling.
 */
export function levelShapes(points: readonly ConstructionPosition[], radius: number, reach: number): readonly ConstructionVolumeShape[] {
  const path = thinned(points, radius * PATH_STEP);
  if (path.length === 0) return [];
  const level = path[0]!.y;
  const flat = path.map((p) => [p.x, level, p.z] as const);
  return [
    { effect: "fill", radius, path: flat, column: { low: level - reach, high: level } },
    { effect: "carve", radius, path: flat, column: { low: level, high: level + reach } },
  ];
}
