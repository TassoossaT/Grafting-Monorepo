import type {
  ConstructionNodeId,
  ConstructionPosition,
  ConstructionRegionTopology,
  ConstructionVolumeShape,
} from "@/ports";

import { hasTrait } from "../../../features/edit-construction/index.ts";
import { commitGround, indexedFaces } from "./ground-commit.ts";
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

/** How far past a shape's reach, in faces, the faces laid again reach. */
const PATCH_MARGIN_FACES = 2;
/** How far past the faces laid again, in faces, the ground asked where solid is reaches. */
const CONTEXT_MARGIN_FACES = 4;

/** How far a shape blends into the ground round it. */
const blendOf = (shape: ConstructionVolumeShape) => shape.radius * 0.35;

function distanceToPath(point: ConstructionPosition, path: ConstructionVolumeShape["path"]): number {
  if (path.length === 1) return Math.hypot(point.x - path[0]![0], point.y - path[0]![1], point.z - path[0]![2]);
  let best = Infinity;
  for (let i = 0; i + 1 < path.length; i++) {
    const [ax, ay, az] = path[i]!, [bx, by, bz] = path[i + 1]!;
    const dx = bx - ax, dy = by - ay, dz = bz - az, l = dx * dx + dy * dy + dz * dz;
    const t = l > 0 ? Math.max(0, Math.min(1, ((point.x - ax) * dx + (point.y - ay) * dy + (point.z - az) * dz) / l)) : 0;
    best = Math.min(best, Math.hypot(point.x - ax - dx * t, point.y - ay - dy * t, point.z - az - dz * t));
  }
  return best;
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
 * Carves `shape` into the ground or fills it in, as one transaction. Throws
 * where nothing could be laid; the ground is then left as it was.
 */
export function commitTerrainVolumeEdit(ctx: ToolContext, shape: ConstructionVolumeShape, options: { readonly faceSide?: number; readonly seed: number }): { readonly faces: number } {
  const blend = blendOf(shape);
  const xs = shape.path.map((p) => p[0]), zs = shape.path.map((p) => p[2]);
  const guess = options.faceSide ?? 2;
  const reach = shape.radius + blend + PATCH_MARGIN_FACES * guess;
  const outer = reach + CONTEXT_MARGIN_FACES * guess;
  const nearby = ctx.runtime.getRegionTopologiesInBounds({
    minX: Math.min(...xs) - outer, minZ: Math.min(...zs) - outer, maxX: Math.max(...xs) + outer, maxZ: Math.max(...zs) + outer,
  }).filter((topology) => hasTrait(topology.surfaceType, "ground") && ringOf(topology) !== undefined);
  const patchFaces = nearby.filter((topology) => topology.nodes.some((node) => distanceToPath(node.position, shape.path) < reach));
  if (patchFaces.length === 0) throw new Error("não há terreno ao alcance");
  const patchKeys = new Set(patchFaces.map((face) => face.surfaceKey.join("\u0000")));
  const contextFaces = nearby.filter((topology) => !patchKeys.has(topology.surfaceKey.join("\u0000")));
  // The ground's own face size; the engine lays finer where the shape is narrow.
  const faceSide = options.faceSide ?? faceSideOf(patchFaces);

  const patch = indexedFaces(patchFaces);
  const context = indexedFaces(contextFaces);

  const edited = ctx.runtime.editTerrainVolume({
    patch: { vertices: patch.vertices, faces: patch.faces },
    context: { vertices: context.vertices, faces: context.faces },
    shapes: [shape],
    blend,
    faceSide,
    seed: options.seed,
  });
  if (!edited) throw new Error("o núcleo recusou a edição");

  const operationId = `${ctx.tableId}:terrain-volume:${ctx.nextSequence()}`;
  let built = 0;
  const { recorded } = ctx.runtime.transact(operationId, "local", () => {
    built = commitGround(ctx.runtime, {
      operationId,
      tableId: ctx.tableId,
      replaced: patchFaces,
      around: contextFaces,
      surfaceType: patchFaces[0]!.surfaceType,
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
