import type {
  ConstructionPatchRegion,
  ConstructionPosition,
  ConstructionRegionTopology,
  ConstructionSolidGroundRequest,
  ConstructionSolidShape,
  ConstructionSurfaceKey,
} from "@/ports";

import { SOLID_GROUND_SURFACE_TYPE, createBoundaryEdges, groundSurfaceOf, hasTrait } from "../../../features/edit-construction/index.ts";
import { commitPatchReplacement } from "../effects/effect-commit.ts";
import type { ToolContext } from "../tools/core/tool-context.ts";

/**
 * Tunnels, caves and earth bridges in the tabletop's ground.
 *
 * Ground stays what it always was -- a height over the plane, laid by the
 * irregular quad grid, cut and regenerated round whatever stands in it --
 * everywhere a shape has not reached. Where one has, a **zone** holds:
 *
 * - the heights the ground had before any shape touched it, sampled once,
 *   so a shape can be laid again (or taken away) over the hill as it was;
 * - every shape made there, carve or fill.
 *
 * Laying a zone is one call to the engine (`solidGround`): the height field
 * plus its shapes, split into pieces that are each a height over a plane of
 * their own. What the shapes made -- a tunnel's ceiling, walls and floor,
 * the hill over it, a bridge's deck and belly -- and a narrow collar of open
 * ground round it become faces of one sealed structure, committed the way a
 * floor is: the ground's own regeneration then cuts round it and meets the
 * collar's edge, with nothing here that the floors do not already go
 * through. The rest of the ground stays terrain.
 *
 * A stroke whose shape reaches a standing zone joins it: the zone is laid
 * again with every shape it holds, replacing the faces it had.
 */

/** Spacing of the heights a zone keeps, in world units. */
const HEIGHT_SPACING = 0.5;
/** How far, in faces, the box a zone is read in reaches past its shapes: the ground under open sky has to reach the box on every side. */
const MARGIN_FACES = 2;
/** How wide, in faces, the collar of open ground laid with the shapes is. */
const COLLAR_FACES = 1.5;
/** The steepest slope still laid as ground facing up: 60 degrees. */
const STEEPEST_UP = 0.5;

interface Box {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

interface HeightGrid {
  readonly originX: number;
  readonly originZ: number;
  readonly spacing: number;
  readonly columns: number;
  readonly rows: number;
  readonly heights: readonly number[];
}

interface SolidZone {
  readonly id: string;
  readonly box: Box;
  readonly shapes: readonly ConstructionSolidShape[];
  readonly ground: HeightGrid;
  /** The face size it was laid at. */
  readonly faceSide: number;
  readonly seed: number;
}

/**
 * Every zone ever laid, by id. Never pruned: undoing a stroke brings back the
 * faces of the zone it replaced, and that zone has to still be here to be
 * joined again. Whether a zone stands is read off the graph, not off this.
 */
const ZONES = new Map<string, SolidZone>();

/** What a stroke asks for. */
export interface SolidShapeStroke {
  readonly shape: ConstructionSolidShape;
  /** Face size of ground under open sky round it. */
  readonly faceSide: number;
  readonly seed: number;
}

const overlaps = (a: Box, b: Box) => a.minX <= b.maxX && b.minX <= a.maxX && a.minZ <= b.maxZ && b.minZ <= a.maxZ;
const union = (a: Box, b: Box): Box => ({ minX: Math.min(a.minX, b.minX), minZ: Math.min(a.minZ, b.minZ), maxX: Math.max(a.maxX, b.maxX), maxZ: Math.max(a.maxZ, b.maxZ) });
const inside = (box: Box, x: number, z: number) => x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ;

/** How far a shape blends into the ground round it. */
const blendFor = (shapes: readonly ConstructionSolidShape[]) => Math.max(...shapes.map((shape) => shape.radius)) * 0.35;

function shapeBox(shape: ConstructionSolidShape, reach: number): Box {
  const xs = shape.path.map((p) => p[0]), zs = shape.path.map((p) => p[2]);
  const r = shape.radius + reach;
  return { minX: Math.min(...xs) - r, minZ: Math.min(...zs) - r, maxX: Math.max(...xs) + r, maxZ: Math.max(...zs) + r };
}

function sampleGrid(grid: HeightGrid, x: number, z: number): number {
  const u = Math.min(Math.max((x - grid.originX) / grid.spacing, 0), grid.columns - 1);
  const v = Math.min(Math.max((z - grid.originZ) / grid.spacing, 0), grid.rows - 1);
  const c = Math.floor(u), r = Math.floor(v), fu = u - c, fv = v - r;
  const at = (cc: number, rr: number) => grid.heights[Math.min(rr, grid.rows - 1) * grid.columns + Math.min(cc, grid.columns - 1)]!;
  return (at(c, r) * (1 - fu) + at(c + 1, r) * fu) * (1 - fv) + (at(c, r + 1) * (1 - fu) + at(c + 1, r + 1) * fu) * fv;
}

/** The id of face `face` of piece `piece` a zone lays. */
const faceId = (zone: string, piece: number, face: number) => `${zone}:p${piece}:f${face}`;

/**
 * The faces a zone laid that still stand. Matched on the whole face id: the
 * ground the regeneration lays round a zone is minted under the zone's own
 * transaction, so its ids start the same way.
 */
function liveFaces(all: readonly ConstructionRegionTopology[], zone: SolidZone): readonly ConstructionRegionTopology[] {
  const prefix = `${zone.id}:p`;
  const own = (part: string) => part.startsWith(prefix) && /^\d+:f\d+$/.test(part.slice(prefix.length));
  return all.filter((topology) => topology.surfaceKey.some(own));
}

/**
 * The heights of the ground across `box`, before any shape: a standing zone's
 * own where it has them -- its hill is under its faces, gone from the ground
 * -- and the ground's own everywhere else.
 */
function baseHeights(ctx: ToolContext, box: Box, joined: readonly SolidZone[]): HeightGrid {
  const ground = ctx.runtime.getRegionTopologiesInBounds(box).filter((topology) => hasTrait(topology.surfaceType, "ground"));
  const heightAt = groundSurfaceOf(ground, new Set());
  const columns = Math.round((box.maxX - box.minX) / HEIGHT_SPACING) + 1;
  const rows = Math.round((box.maxZ - box.minZ) / HEIGHT_SPACING) + 1;
  const heights: number[] = [];
  let last = 0;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x = box.minX + column * HEIGHT_SPACING, z = box.minZ + row * HEIGHT_SPACING;
      const owner = joined.find((zone) => inside(zone.box, x, z));
      const height = owner ? sampleGrid(owner.ground, x, z) : heightAt({ x, z });
      last = height ?? last;
      heights.push(last);
    }
  }
  return { originX: box.minX, originZ: box.minZ, spacing: HEIGHT_SPACING, columns, rows, heights };
}

/**
 * The standing zones `start` reaches, and every zone those reach in turn --
 * one zone is laid from all the shapes that touch -- with the box grown over
 * them all.
 */
function zonesReached(all: readonly ConstructionRegionTopology[], start: Box): { readonly joined: readonly SolidZone[]; readonly box: Box } {
  const standing = [...ZONES.values()].filter((zone) => liveFaces(all, zone).length > 0);
  let box = start;
  const joined: SolidZone[] = [];
  for (let grew = true; grew;) {
    grew = false;
    for (const zone of standing) {
      if (!joined.includes(zone) && overlaps(zone.box, box)) {
        joined.push(zone);
        box = union(box, zone.box);
        grew = true;
      }
    }
  }
  return { joined, box };
}

/**
 * Lays `stroke`'s shape into the ground, joining any zone it reaches, as one
 * transaction the ground's regeneration answers.
 */
export function commitSolidShape(ctx: ToolContext, stroke: SolidShapeStroke): { readonly faces: number } {
  const { shape, faceSide } = stroke;
  const all = ctx.runtime.getAllRegionTopologies();
  const { joined, box } = zonesReached(all, shapeBox(shape, blendFor([shape]) + MARGIN_FACES * faceSide));
  const shapeFaceSide = Math.min(faceSide, Math.max(0.75, shape.radius * 0.8), ...joined.map((zone) => zone.faceSide));
  const shapes = [...joined.flatMap((zone) => zone.shapes), shape];
  return layZone(ctx, all, joined, box, shapes, baseHeights(ctx, box, joined), shapeFaceSide, stroke.seed);
}

/** How a terrain brush stroke changes heights. */
export type ZoneHeightEdit = "raise" | "lower" | "flatten";

/**
 * A terrain brush stroke over standing zones: inside a zone its heights are
 * the truth, so the stroke edits those -- raising, lowering or levelling them
 * under the brush with the falloff of a round brush -- and the zone is laid
 * again over the hill as it now is, its tunnels following it. `undefined`
 * when the stroke reaches no zone.
 */
export function reshapeZoneGround(
  ctx: ToolContext,
  path: readonly ConstructionPosition[],
  radius: number,
  edit: ZoneHeightEdit,
  step: number,
): { readonly faces: number } | undefined {
  // No zone was ever laid: an ordinary stroke has nothing more to do here.
  if (path.length === 0 || ZONES.size === 0) return undefined;
  const all = ctx.runtime.getAllRegionTopologies();
  const reachOf: Box = {
    minX: Math.min(...path.map((p) => p.x)) - radius,
    minZ: Math.min(...path.map((p) => p.z)) - radius,
    maxX: Math.max(...path.map((p) => p.x)) + radius,
    maxZ: Math.max(...path.map((p) => p.z)) + radius,
  };
  const { joined, box } = zonesReached(all, reachOf);
  if (joined.length === 0) return undefined;
  const ground = baseHeights(ctx, box, joined);
  const distanceTo = (x: number, z: number) => Math.min(...path.map((p, i) => {
    const q = path[Math.min(i + 1, path.length - 1)]!;
    const dx = q.x - p.x, dz = q.z - p.z, l = dx * dx + dz * dz;
    const t = l > 0 ? Math.max(0, Math.min(1, ((x - p.x) * dx + (z - p.z) * dz) / l)) : 0;
    return Math.hypot(x - p.x - dx * t, z - p.z - dz * t);
  }));
  const weights = ground.heights.map((_, index) => {
    const x = ground.originX + (index % ground.columns) * ground.spacing;
    const z = ground.originZ + Math.floor(index / ground.columns) * ground.spacing;
    const d = distanceTo(x, z);
    return d >= radius ? 0 : (1 - (d / radius) ** 2) ** 2;
  });
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total === 0) return undefined;
  const level = ground.heights.reduce((sum, h, i) => sum + h * weights[i]!, 0) / total;
  const heights = ground.heights.map((h, i) => {
    const w = weights[i]!;
    return edit === "raise" ? h + step * w : edit === "lower" ? h - step * w : h + (level - h) * w;
  });
  const shapes = joined.flatMap((zone) => zone.shapes);
  return layZone(ctx, all, joined, box, shapes, { ...ground, heights }, Math.min(...joined.map((zone) => zone.faceSide)), joined[0]!.seed);
}

/** Lays one zone -- `shapes` over `ground` across `box` -- replacing the faces of the zones it joins. */
function layZone(
  ctx: ToolContext,
  all: readonly ConstructionRegionTopology[],
  joined: readonly SolidZone[],
  box: Box,
  shapes: readonly ConstructionSolidShape[],
  ground: HeightGrid,
  shapeFaceSide: number,
  seed: number,
): { readonly faces: number } {
  const reach = Math.max(...shapes.map((s) => s.radius)) + blendFor(shapes);
  const ys = [...ground.heights, ...shapes.flatMap((s) => s.path.flatMap((p) => [p[1] - reach, p[1] + reach]))];
  const request: ConstructionSolidGroundRequest = {
    ground,
    shapes,
    blend: blendFor(shapes),
    regionMin: [box.minX, Math.min(...ys) - 2, box.minZ],
    regionMax: [box.maxX, Math.max(...ys) + 2, box.maxZ],
    cell: Math.min(0.5, Math.min(...shapes.map((s) => s.radius)) / 3),
    faceSide: shapeFaceSide,
    shapeFaceSide,
    // A collar of open ground round the shapes is laid with them: its far
    // edge lies on open ground, smooth in plan, and that is the line the
    // ground round them meets. The shapes' own outline climbs walls and folds
    // under arches, which ground laid as a height over the plane cannot follow.
    collar: COLLAR_FACES * shapeFaceSide,
    steepestUp: STEEPEST_UP,
    seed,
  };
  const laid = ctx.runtime.solidGround(request);
  if (!laid) throw new Error("o núcleo recusou a forma");
  // What the shapes made and the collar round it: the ground under open sky
  // beyond stays the ground's, laid by its own regeneration round them.
  const shaped = laid.pieces.filter((piece) => !piece.openGround);
  const failed = shaped.find((piece) => piece.error !== null);
  if (failed) throw new Error(`um pedaço da forma não pôde ser malhado: ${failed.error}`);
  if (shaped.every((piece) => piece.faces.length === 0)) throw new Error("a forma não alcança o terreno");

  const id = `${ctx.tableId}:solid:${ctx.nextSequence()}`;
  const nodes = new Map<string, { readonly id: string; readonly position: ConstructionPosition }>();
  const nodeOf = (piece: number, vertex: number): string => {
    const border = shaped[piece]!.borderPoint[vertex];
    const nodeId = border === null || border === undefined ? `${id}:p${piece}:v${vertex}` : `${id}:b${border}`;
    if (!nodes.has(nodeId)) {
      const [x, y, z] = shaped[piece]!.vertices[vertex]!;
      nodes.set(nodeId, { id: nodeId, position: { x, y, z } });
    }
    return nodeId;
  };
  const builder = createBoundaryEdges(ctx.tableId, { kind: "private-when-full", runPrefix: id, existingUses: new Map() });
  const regions: ConstructionPatchRegion[] = [];
  shaped.forEach((piece, p) => piece.faces.forEach((face, f) => {
    const ring = face.map((vertex) => nodeOf(p, vertex)).filter((nodeId, k, all) => nodeId !== all[(k + 1) % all.length]);
    if (new Set(ring).size < 3) return;
    regions.push({
      regionId: faceId(id, p, f),
      boundary: ring.map((nodeId, k) => builder.use(nodeId, ring[(k + 1) % ring.length]!)),
      holes: [],
      surfaceType: SOLID_GROUND_SURFACE_TYPE,
      physical: true,
    });
  }));

  const replaced: ConstructionSurfaceKey[] = joined.flatMap((zone) => liveFaces(all, zone).map((topology) => topology.surfaceKey));
  const { recorded } = commitPatchReplacement(ctx.runtime, {
    operationId: id,
    sourceSurfaceKeys: replaced,
    patch: { nodes: [...nodes.values()], edges: builder.all(), regions },
    footprintOutline: [[box.minX, box.minZ], [box.maxX, box.minZ], [box.maxX, box.maxZ], [box.minX, box.maxZ]],
  }, { transactionId: id });
  ZONES.set(id, { id, box, shapes, ground, faceSide: shapeFaceSide, seed });
  if (recorded) ctx.history.record({ kind: "transaction", transactionId: id });
  return { faces: regions.length };
}

/** At least this far between the points a stroke's path keeps, as a fraction of its radius. */
const PATH_STEP = 0.75;

/** The pointer's path, thinned to a point every so often, the last kept. */
function thinned(points: readonly ConstructionPosition[], step: number): ConstructionPosition[] {
  const kept: ConstructionPosition[] = [];
  for (const point of points) {
    const last = kept.at(-1);
    if (!last || Math.hypot(point.x - last.x, point.z - last.z) >= step) kept.push(point);
  }
  const end = points.at(-1);
  if (end && kept.at(-1) !== end && kept.length > 0) kept[kept.length - 1] = end;
  return kept;
}

/**
 * A tunnel pushed into the hill from where the stroke starts: level at that
 * height, its floor just under the ground there so its mouth opens onto it,
 * running wherever the stroke runs in plan.
 */
export function tunnelShape(points: readonly ConstructionPosition[], radius: number): ConstructionSolidShape | undefined {
  const path = thinned(points, radius * PATH_STEP);
  if (path.length < 2) return undefined;
  const y = path[0]!.y + radius * 0.7;
  return { effect: "carve", radius, path: path.map((p) => [p.x, y, p.z] as const) };
}

/**
 * An earth bridge from where the stroke starts to where it ends: its feet in
 * the ground at both, arched `rise` over the straight line between them.
 */
export function bridgeShape(points: readonly ConstructionPosition[], radius: number, rise: number): ConstructionSolidShape | undefined {
  const path = thinned(points, radius * PATH_STEP);
  if (path.length < 2) return undefined;
  const lengths = [0];
  for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1]! + Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.z - path[i - 1]!.z));
  const total = lengths.at(-1)!;
  if (total < radius * 2) return undefined;
  const [start, end] = [path[0]!, path.at(-1)!];
  return {
    effect: "fill",
    radius,
    path: path.map((p, i) => {
      const t = lengths[i]! / total;
      return [p.x, start.y + (end.y - start.y) * t + rise * Math.sin(Math.PI * t), p.z] as const;
    }),
  };
}
