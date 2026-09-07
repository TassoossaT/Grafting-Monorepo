import { DEFAULT_TOOL_PARAMS, deriveFaceSize } from "@/features/edit-construction";
import type { TerrainSculptParams } from "@/features/edit-construction";
import type {
  ConstructionCoveredRegion,
  ConstructionGridConstraintPoint,
  ConstructionPosition,
  ConstructionRegionEdge,
  ConstructionRegionTopology,
} from "@/ports";
import polygonClipping, { type MultiPolygon, type Polygon } from "polygon-clipping";

import { brushSweptOutlinePolygons, brushSweptRegionFill } from "../shapes/preview-shapes.ts";
import { dirtLoadOver, restackTerrain } from "./terrain-restack.ts";
import {
  OUTLINE_CHORD_PER_FACE,
  OUTLINE_WELD_PER_FACE,
  outlineConstraints,
  perimeterConstraints,
  type ConstraintRing,
  type ConstraintTable,
} from "./terrain-constraints.ts";
import { fillTerrain } from "./terrain-fill.ts";
import { terrainStandingAround, type TerrainStrokeBounds } from "./terrain-neighborhood.ts";
import { heightFieldOf } from "./terrain-regenerate.ts";
import { executeTerrainCut, buildConstraintRings } from "./terrain-cut-executor.ts";
import { logContourGrowth } from "./terrain-diagnostics.ts";
import type { ConstructionTool, ToolContext, ToolGesture } from "../core/tool-context.ts";

/**
 * How this tool works.
 *
 * The stroke names an area, and the engine generates the ground for it in one
 * call -- constrained by the outline of everything already standing inside
 * that area, so the result meets it exactly instead of near it.
 *
 * **What that replaces, and why.** The previous version generated a fresh
 * equilateral lattice seeded at the gesture's own origin, then tried to make it
 * agree with the world afterwards by welding any vertex that landed within
 * `CROSS_SESSION_WELD_EPSILON` of an existing node onto that node. That is
 * proximity matching, and its own doc admitted what it was: *"welding by
 * proximity was patching the symptom, not the cause."* The symptoms were
 * everywhere -- two corners of one quad collapsing onto the same node and
 * having to be discarded as a degenerate cycle, faces reproducing an existing
 * face exactly and being pruned after the fact, a lattice sized by guessing
 * how far the drag might go, and the seam between old ground and new needing
 * `fillUnfilledLoops` afterwards to close what the weld had missed.
 *
 * None of that is handled here, because none of it can arise. The ground
 * already standing goes *down* as a constraint carrying its own node ids, so
 * the mesh comes back already sharing them: there is no candidate to weld, no
 * radius to tune, no coincident node to detect. The lattice is not placed by
 * this side at all -- it is seeded inside the area the stroke actually swept.
 *
 * **The one thing this side still owes the graph** is adoption. Quadrangulation
 * puts a corner along every edge it touches, a neighbour's edge included, so
 * the ground being registered wants nodes partway along edges that already
 * exist. Those edges are split (`terrain-constraints.ts`) so both sides share
 * the result. The generator names which edge each one landed on, so this is
 * splitting a known edge, never finding one by position.
 */

const TERRAIN_COLOR: Record<"terrain" | "terrain-grass", number> = {
  terrain: 0x334155,
  "terrain-grass": 0x4a7a4a,
};

/**
 * World units between noise samples.
 *
 * A fixed spacing in the *world*, never a fixed number of samples per stroke.
 * Sampling a fixed grid stretched over each stroke's own extent gives the same
 * world point a different height in every stroke that covers it, and two
 * patches of ground made that way meet along a crease no agreement about cells
 * can remove -- they disagree about height, not about layout.
 */
const NOISE_SPACING = 1;




/**
 * Bilinear sample of a flat row-major heightmap at a position in *cells*.
 *
 * The grid is irregular and the noise source is not, so nothing lines a vertex
 * up with a sample; bilinear rather than nearest keeps a real step between
 * adjacent vertices' samples.
 */
function sampleHeightmapBilinear(
  heightmap: Float32Array,
  width: number,
  height: number,
  column: number,
  row: number,
): number {
  const x = Math.min(Math.max(column, 0), width - 1);
  const y = Math.min(Math.max(row, 0), height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const fx = x - x0;
  const fy = y - y0;

  const at = (cx: number, cy: number) => heightmap[cy * width + cx] ?? 0;
  const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx;
  const bottom = at(x0, y1) * (1 - fx) + at(x1, y1) * fx;
  return top * (1 - fy) + bottom * fy;
}

/**
 * Every region the stroke's own swept area touches, asked of the engine once
 * per disjoint piece of that area and merged by identity.
 *
 * The footprint is the very shape the drag ghost showed
 * (`brushSweptOutlinePolygons` is shared with the preview), so the stroke
 * never affects ground the user was not shown.
 */
/**
 * The one chord every sweep of a stroke is described at.
 *
 * **All three have to be the same shape, and for a while they were not.** The
 * ghost drawn while dragging, the footprint the engine is asked to report
 * coverage for, and the outline the fill is bounded by are three separate
 * calls to the same sweep; when the fill's chord was widened to stop the mesh
 * coming back finer than asked, the other two were left behind.
 *
 * That is not cosmetic. The fill then reaches ground the coverage query never
 * reported, so that ground is never handed over as occupied, the generator
 * plans cells across it, and the engine refuses every one of them -- "no room
 * on edge". And the person at the table paints one shape and gets another.
 */
function strokeFaceSize(params: TerrainSculptParams): number {
  return deriveFaceSize(params.brushRadius, params.faceSize);
}

function strokeChord(params: TerrainSculptParams): number {
  return strokeFaceSize(params) * OUTLINE_CHORD_PER_FACE;
}

function ringArea(ring: readonly (readonly [number, number])[]): number {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    area += (ring[j]![0] + ring[i]![0]) * (ring[j]![1] - ring[i]![1]);
  }
  return Math.abs(area) / 2;
}

function totalMultiPolygonArea(mp: MultiPolygon): number {
  let total = 0;
  for (const polygon of mp) {
    if (polygon.length === 0) continue;
    total += ringArea(polygon[0]!);
    for (let h = 1; h < polygon.length; h += 1) {
      total -= ringArea(polygon[h]!);
    }
  }
  return Math.max(0, total);
}


function coveredByStroke(
  ctx: ToolContext,
  swept: MultiPolygon,
): readonly ConstructionCoveredRegion[] {
  const merged = new Map<string, ConstructionCoveredRegion>();
  for (const polygon of swept) {
    const ring = polygon[0];
    if (ring === undefined || ring.length < 3) continue;
    for (const region of ctx.runtime.getFootprintCoverage(ring)) {
      merged.set(region.surfaceKey.join(" "), region);
    }
  }
  return [...merged.values()];
}

/**
 * Whether a point lies inside the swept area, holes included.
 *
 * Even-odd against each polygon's outer ring, then against its inner rings, so
 * a stroke that curls back on itself does not count the ground it left
 * unpainted in the middle.
 */
function insideSwept(point: ConstructionPosition, swept: MultiPolygon): boolean {
  const inRing = (ring: readonly (readonly [number, number])[]): boolean => {
    let inside = false;
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
      const [ax, az] = ring[index]!;
      const [bx, bz] = ring[previous]!;
      if (az > point.z !== bz > point.z && point.x < ((bx - ax) * (point.z - az)) / (bz - az) + ax) {
        inside = !inside;
      }
    }
    return inside;
  };
  for (const polygon of swept) {
    const outer = polygon[0];
    if (outer === undefined || !inRing(outer)) continue;
    if (polygon.slice(1).some((hole) => inRing(hole))) continue;
    return true;
  }
  return false;
}

/**
 * Everything already standing close enough for the stroke to meet it.
 *
 * This used to expand every covered face to its whole connected cloud before
 * cutting it back to the brush. Joining two large clouds consequently walked
 * each entire cloud once per covered face and performed one JSON Wasm call per
 * member. The engine now does one bounds query and serializes only this local
 * neighbourhood. A subset perimeter is safe here because the generator can
 * only lay cells inside the swept outline: the far side of an interior edge is
 * either also in this neighbourhood or unreachable by the fill.
 *
 * The bound is the stroke's own extent, widened by `reach` so nothing the
 * outline can meet is dropped by a rounding of the box.
 */
function centroidOf(nodes: readonly { readonly position: ConstructionPosition }[]): ConstructionPosition {
  if (nodes.length === 0) return { x: 0, y: 0, z: 0 };
  let x = 0;
  let y = 0;
  let z = 0;
  for (const n of nodes) {
    x += n.position.x;
    y += n.position.y;
    z += n.position.z;
  }
  return { x: x / nodes.length, y: y / nodes.length, z: z / nodes.length };
}

function faceIntersectsSwept(topology: ConstructionRegionTopology, swept: MultiPolygon): boolean {
  for (const node of topology.nodes) {
    if (insideSwept(node.position, swept)) return true;
  }
  return insideSwept(centroidOf(topology.nodes), swept);
}

function topologyToPolygon(topology: ConstructionRegionTopology): Polygon {
  const nodes = topology.nodes;
  if (nodes.length < 3) return [];
  const ring: [number, number][] = nodes.map((n) => [n.position.x, n.position.z]);
  ring.push([nodes[0]!.position.x, nodes[0]!.position.z]);
  return [ring];
}

/** The axis-aligned extent of a swept stroke, in XZ. */
function boundsOf(swept: MultiPolygon): TerrainStrokeBounds {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const polygon of swept) {
    for (const ring of polygon) {
      for (const [x, z] of ring) {
        minX = Math.min(minX, x);
        minZ = Math.min(minZ, z);
        maxX = Math.max(maxX, x);
        maxZ = Math.max(maxZ, z);
      }
    }
  }
  return { minX, minZ, maxX, maxZ };
}

/** Terrain-sculpt's own effect: the brush hands over the whole gesture, once, on release. */
export const terrainSculptTool: ConstructionTool<"terrain-sculpt"> = {
  id: "terrain-sculpt",
  defaultParams: () => DEFAULT_TOOL_PARAMS["terrain-sculpt"],

  previewFor(gesture: ToolGesture, params: TerrainSculptParams) {
    const targetSurface = params.targetSurface ?? "terrain";
    const color = TERRAIN_COLOR[targetSurface] ?? 0x334155;
    return brushSweptRegionFill(
      gesture.samples.map((sample) => sample.point),
      { kind: "circle", radius: params.brushRadius },
      color,
      0.35,
      // The same chord the commit will sweep with, so the ghost is the shape
      // the engine is actually asked about.
      strokeChord(params),
    );
  },

  // Presence of this hook makes the generic dispatcher capture and sample the drag; the grid is only ever generated on release.
  onPointerMove(): void {},

  onPointerUp(ctx: ToolContext, gesture: ToolGesture, params: TerrainSculptParams): void {
    const salt = ctx.nextSequence();
    const causeId = `${ctx.tableId}:terrain-sculpt:${salt}`;
    const faceSize = strokeFaceSize(params);
    const brushRadius = params.brushRadius;
    const swept = brushSweptOutlinePolygons(
      gesture.samples.map((sample) => sample.point),
      brushRadius,
      strokeChord(params),
    );

    const mode = params.mode ?? "add";
    const isAdd = mode === "add" || mode === "elevate";
    const isDig = mode === "dig" || mode === "lower";
    const isFlatten = mode === "flatten";
    const elevationStep = params.elevationStep ?? 0.5;
    const targetSurface = params.targetSurface ?? "terrain";

    const covered = coveredByStroke(ctx, swept);

    if (isFlatten) {
      const raised =
        covered.length > 0
          ? restackTerrain(
              ctx,
              targetSurface,
              covered,
              causeId,
              dirtLoadOver(gesture.samples.map((sample) => sample.point), brushRadius),
              "flatten",
              elevationStep,
            )
          : { raisedFaces: 0, movedVertices: 0, skipped: [] };
      report(ctx, 0, 0, 0, raised, true, raised.raisedFaces > 0 ? `${raised.raisedFaces} faces niveladas` : undefined);
      return;
    }

    const extent = boundsOf(swept);
    const standing = terrainStandingAround(ctx.runtime, covered, extent, faceSize * 2);

    // Identify which standing faces are affected (touched) by the brush stroke
    const affected = standing.filter(
      (topology) => topology.surfaceType === targetSurface && faceIntersectsSwept(topology, swept),
    );
    const affectedKeys = new Set(affected.map((t) => t.surfaceKey.join(" ")));
    const retained = standing.filter((t) => !affectedKeys.has(t.surfaceKey.join(" ")));

    // Extract 2D polygon of affected faces
    const affectedPolygons: Polygon[] = affected
      .map(topologyToPolygon)
      .filter((p) => p.length > 0);
    const affectedMerged: MultiPolygon =
      affectedPolygons.length > 0
        ? polygonClipping.union(affectedPolygons[0]!, ...affectedPolygons.slice(1))
        : [];

    let targetPolygon: MultiPolygon;
    let effectiveFaceSide = faceSize;

    if (isDig) {
      if (covered.length === 0 || standing.length === 0) {
        ctx.reportFeedback({ tone: "info", message: "Nada a cavar aqui." });
        return;
      }
      const centerPoint = gesture.samples[gesture.samples.length - 1]?.point ?? gesture.samples[0]?.point;
      const outcome = executeTerrainCut(ctx.runtime, {
        area: {
          outline: swept[0]?.[0] ?? [],
          center: centerPoint ? { x: centerPoint.x, y: centerPoint.y, z: centerPoint.z } : undefined,
          radius: brushRadius,
        },
        targetSurfaceType: targetSurface,
        profile: { kind: "concave", depth: elevationStep },
        causeId,
        tableId: ctx.tableId,
        faceSide: faceSize,
        seed: Math.floor(params.seed ?? 1) || 1,
        irregularity: params.irregularity ?? 0.7,
      });
      if (!outcome.success) {
        ctx.reportFeedback({ tone: "info", message: outcome.message ?? "Nada a cavar aqui." });
        return;
      }
      ctx.reportFeedback({
        tone: "success",
        message: `Terreno: ${outcome.builtFaces} faces escavadas (${outcome.removedFaces} faces substituídas).`,
      });
      return;
    }

    // isAdd:
    if (affectedMerged.length === 0) {
      targetPolygon = swept;
    } else {
      // Check if stroke extends into empty ground or bridges clouds:
      let uncovered: MultiPolygon = swept;
      try {
        uncovered = polygonClipping.difference(swept, affectedMerged);
      } catch {
        uncovered = swept;
      }
      const uncoveredArea = totalMultiPolygonArea(uncovered);
      const minUsefulArea = faceSize * faceSize * 0.25;

      if (uncoveredArea < minUsefulArea) {
        // Entirely inside existing terrain: generate convex elevation profile
        const centerPoint = gesture.samples[gesture.samples.length - 1]?.point ?? gesture.samples[0]?.point;
        const outcome = executeTerrainCut(ctx.runtime, {
          area: {
            outline: swept[0]?.[0] ?? [],
            center: centerPoint ? { x: centerPoint.x, y: centerPoint.y, z: centerPoint.z } : undefined,
            radius: brushRadius,
          },
          targetSurfaceType: targetSurface,
          profile: { kind: "convex", height: elevationStep },
          causeId,
          tableId: ctx.tableId,
          faceSide: faceSize,
          seed: Math.floor(params.seed ?? 1) || 1,
          irregularity: params.irregularity ?? 0.7,
        });
        if (!outcome.success) {
          ctx.reportFeedback({ tone: "info", message: outcome.message ?? "Nada a adicionar aqui." });
          return;
        }
        ctx.reportFeedback({
          tone: "success",
          message: `Terreno: ${outcome.builtFaces} faces elevadas (${outcome.removedFaces} faces substituídas).`,
        });
        return;
      }

      try {
        targetPolygon = polygonClipping.union(affectedMerged, swept);
      } catch {
        targetPolygon = swept;
      }
    }

    const perimeters = perimeterConstraints(retained, 0);
    const targetRings = buildConstraintRings(targetPolygon, effectiveFaceSide, perimeters);
    const boundaryRings = targetRings.filter((r) => !r.isHole && r.points.length >= 3);
    const holeRings = targetRings.filter((r) => r.isHole && r.points.length >= 3);

    if (boundaryRings.length === 0) {
      ctx.reportFeedback({ tone: "info", message: "Nada a fazer aqui." });
      return;
    }

    const { minX, minZ, maxX, maxZ } = extent;
    const originX = Math.floor(minX / NOISE_SPACING) - 1;
    const originZ = Math.floor(minZ / NOISE_SPACING) - 1;
    const columns = Math.ceil(maxX / NOISE_SPACING) - originX + 2;
    const rows = Math.ceil(maxZ / NOISE_SPACING) - originZ + 2;
    const heightmap = ctx.runtime.generateHeightmap(
      columns,
      rows,
      Math.floor(params.seed ?? 1) || 1,
      params.noiseScale ?? 0.15,
      originX,
      originZ,
    );
    const noiseAt = (point: { readonly x: number; readonly z: number }): number =>
      sampleHeightmapBilinear(
        heightmap,
        columns,
        rows,
        point.x / NOISE_SPACING - originX,
        point.z / NOISE_SPACING - originZ,
      ) * (params.heightScale ?? 1.5);

    const standingNodes = standing.flatMap((topology) => topology.nodes.map((node) => node.position));
    const kept = heightFieldOf(standingNodes, effectiveFaceSide * 2);
    const heightAt = (point: { readonly x: number; readonly z: number }): number =>
      kept.at(point) ?? noiseAt(point);

    const filled = fillTerrain(ctx.runtime, {
      what: isDig ? "escava├º├úo" : "pincelada",
      mint: `${ctx.tableId}:terrain-sculpt-${salt}`,
      tableId: ctx.tableId,
      causeId,
      seed: Math.floor(params.seed ?? 1) || 1,
      faceSide: effectiveFaceSide,
      relaxStrength: params.irregularity ?? 0.7,
      surfaceType: targetSurface,
      boundary: boundaryRings,
      holes: holeRings,
      sources: perimeters.sources,
      replaceSurfaceKeys: affected.length > 0 ? affected.map((f) => f.surfaceKey) : undefined,
      topologySeeds: retained.map((topology) => ({ seed: topology.surfaceKey, surfaceType: topology.surfaceType })),
      heightAt,
    });

    const raisedInfo =
      isAdd && covered.length > 0
        ? restackTerrain(
            ctx,
            targetSurface,
            covered,
            causeId,
            dirtLoadOver(gesture.samples.map((sample) => sample.point), brushRadius),
            "elevate",
            elevationStep,
          )
        : { raisedFaces: 0, movedVertices: 0, skipped: [] };

    report(
      ctx,
      filled.built,
      filled.refused,
      filled.unadopted,
      raisedInfo,
      filled.refinementComplete,
      isDig ? `${filled.built} faces restantes p├│s-escava├º├úo` : undefined,
    );
  },
};

function report(
  ctx: ToolContext,
  built: number,
  refused: number,
  unadopted: number,
  raised: { readonly raisedFaces: number; readonly movedVertices: number; readonly skipped: readonly string[] },
  refinementComplete = true,
  customMsg?: string,
): void {
  const parts: string[] = [];
  if (customMsg) parts.push(customMsg);
  else if (built > 0) parts.push(`${built} faces novas`);
  if (refused > 0) parts.push(`${refused} faces perdidas (aresta sem lado livre)`);
  if (raised.raisedFaces > 0) parts.push(`${raised.raisedFaces} ajustadas (${raised.movedVertices} v├®rtices)`);
  if (unadopted > 0) parts.push(`${unadopted} jun├º├Áes n├úo costuradas`);
  if (!refinementComplete) parts.push("malha mais grossa em parte da ├írea");

  if (parts.length === 0) {
    ctx.reportFeedback({
      tone: "info",
      message: raised.skipped.length > 0 ? raised.skipped[0] ?? "Nada a fazer aqui." : "Nada a fazer aqui.",
    });
    return;
  }
  ctx.reportFeedback({
    tone: "success",
    message: `Terreno: ${parts.join(", ")}.${raised.skipped.length > 0 ? ` ${raised.skipped[0]}` : ""}`,
  });
}

