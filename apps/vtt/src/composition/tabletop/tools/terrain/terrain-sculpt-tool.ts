import { DEFAULT_TOOL_PARAMS } from "@/features/edit-construction";
import type { TerrainSculptParams } from "@/features/edit-construction";
import type { ConstructionCoveredRegion, ConstructionRegionTopology } from "@/ports";

import { brushSweptOutlinePolygons, brushSweptRegionFill } from "../shapes/preview-shapes.ts";
import { restackTerrain } from "./terrain-restack.ts";
import { outlineConstraints, perimeterConstraints, type ConstraintRing } from "./terrain-constraints.ts";
import { fillTerrain } from "./terrain-fill.ts";
import { neighbourhoodReach, normalizeTerrainAround } from "./terrain-regenerate.ts";
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

const TERRAIN_COLOR: Record<TerrainSculptParams["targetSurface"], number> = {
  terrain: 0x334155,
  "terrain-grass": 0x4a7a4a,
};

/** Resolution of the sampled heightmap -- plenty for smooth variation across one stroke; does not need to match vertex count. */
const HEIGHTMAP_RESOLUTION = 16;

/**
 * The brush's own reach: how wide a band the stroke paints, and the shape the
 * preview shows.
 *
 * Its own constant rather than a multiple of the cell size, which is what it
 * used to be. Those are two unrelated things -- how much ground the stroke
 * covers, and how finely that ground is divided -- and tying them together
 * meant the brush silently got wider every time the cells were made coarser.
 */
const REVEAL_RADIUS = 3;

/**
 * Bilinear sample of a flat row-major heightmap at a normalized `(u, v)`.
 *
 * The grid is irregular and the noise source is not, so nothing lines a vertex
 * up with a sample; bilinear rather than nearest keeps a real step between
 * adjacent vertices' samples.
 */
function sampleHeightmapBilinear(heightmap: Float32Array, resolution: number, u: number, v: number): number {
  const x = Math.min(Math.max(u, 0), 1) * (resolution - 1);
  const y = Math.min(Math.max(v, 0), 1) * (resolution - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, resolution - 1);
  const y1 = Math.min(y0 + 1, resolution - 1);
  const fx = x - x0;
  const fy = y - y0;

  const at = (column: number, row: number) => heightmap[row * resolution + column] ?? 0;
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
function coveredByStroke(ctx: ToolContext, gesture: ToolGesture): readonly ConstructionCoveredRegion[] {
  const merged = new Map<string, ConstructionCoveredRegion>();
  for (const polygon of brushSweptOutlinePolygons(gesture.samples.map((sample) => sample.point), REVEAL_RADIUS)) {
    const ring = polygon[0];
    if (ring === undefined || ring.length < 3) continue;
    for (const region of ctx.runtime.getFootprintCoverage(ring)) {
      merged.set(region.surfaceKey.join(" "), region);
    }
  }
  return [...merged.values()];
}

/** Terrain-sculpt's own effect: the brush hands over the whole gesture, once, on release. */
export const terrainSculptTool: ConstructionTool<"terrain-sculpt"> = {
  id: "terrain-sculpt",
  defaultParams: () => DEFAULT_TOOL_PARAMS["terrain-sculpt"],

  previewFor(gesture: ToolGesture, params: TerrainSculptParams) {
    return brushSweptRegionFill(
      gesture.samples.map((sample) => sample.point),
      { kind: "circle", radius: REVEAL_RADIUS },
      TERRAIN_COLOR[params.targetSurface],
      0.35,
    );
  },

  // Presence of this hook makes the generic dispatcher capture and sample the drag; the grid is only ever generated on release.
  onPointerMove(): void {},

  onPointerUp(ctx: ToolContext, gesture: ToolGesture, params: TerrainSculptParams): void {
    const salt = ctx.nextSequence();
    const causeId = `${ctx.tableId}:terrain-sculpt:${salt}`;

    // One stroke does both, per area -- it is not a choice between them.
    // Where ground already exists the covered faces are raised; where it does
    // not, terrain is generated. A stroke uniting two patches spans exactly
    // that mix.
    //
    // The raise goes first so generation meets ground already at its final
    // height: a corner shared with the rim wants the raised Y, not the stale
    // one. Occupancy is unaffected either way -- the raise moves ground in Y,
    // never in XZ.
    const covered = coveredByStroke(ctx, gesture);
    const raised =
      covered.length > 0
        ? restackTerrain(ctx, params.targetSurface, covered, causeId)
        : { raisedFaces: 0, movedVertices: 0, skipped: [] };

    // What the stroke asks to fill, and what is already standing in it. The
    // second becomes holes: ground somebody already holds is not regenerated,
    // it is met.
    const swept = brushSweptOutlinePolygons(gesture.samples.map((sample) => sample.point), REVEAL_RADIUS);
    const outline = outlineConstraints(swept.flatMap((polygon) => polygon.slice(0, 1)));
    if (outline.length === 0) {
      ctx.reportFeedback({ tone: "info", message: "Nada a fazer aqui." });
      return;
    }
    const standing = covered
      .map((region) => ctx.runtime.getRegionTopology(region.surfaceKey))
      .filter((topology): topology is ConstructionRegionTopology => topology !== undefined);
    const perimeters = perimeterConstraints(standing, 0);
    // A stroke that curls back on itself leaves a real hole in its own swept
    // shape, and `polygon-clipping` reports it as an inner ring. Ground there
    // was never painted, so it is subtracted like any other hole -- it simply
    // has no edges, and so owes nobody an adopted node.
    const holeRings: readonly ConstraintRing[] = [
      ...outlineConstraints(swept.flatMap((polygon) => polygon.slice(1))),
      ...perimeters.rings,
    ];

    // Height comes from the noise field over the area the fill actually
    // covers, so it is asked for the extent the generator settled on rather
    // than the one this side guessed before generating.
    const heightmap = ctx.runtime.generateHeightmap(
      HEIGHTMAP_RESOLUTION,
      HEIGHTMAP_RESOLUTION,
      Math.floor(params.seed) || 1,
      params.noiseScale,
    );

    // Anchored to the stroke's own extent, and sampled the same way by both
    // passes below. Anchoring to whatever extent each generation happened to
    // settle on would give one world point two different heights in the same
    // stroke, which is a step in the ground exactly where the two passes meet.
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
    const heightAt = (point: { readonly x: number; readonly z: number }): number =>
      sampleHeightmapBilinear(
        heightmap,
        HEIGHTMAP_RESOLUTION,
        (point.x - minX) / (maxX - minX || 1),
        (point.z - minZ) / (maxZ - minZ || 1),
      ) * params.heightScale;

    const filled = fillTerrain(ctx.runtime, {
      mint: `${ctx.tableId}:terrain-sculpt-${salt}`,
      tableId: ctx.tableId,
      causeId,
      seed: Math.floor(params.seed) || 1,
      faceSide: params.faceSize,
      relaxStrength: params.irregularity,
      surfaceType: params.targetSurface,
      boundary: outline,
      holes: holeRings,
      sources: perimeters.sources,
      heightAt,
    });

    // The stroke has landed, and where it met ground that was already there it
    // met it along a contour -- one generation stopping exactly where another
    // began. That line is the seam: cells on both sides of it were pinned
    // during relaxation, so it reads as two meshes touching rather than as one
    // piece of ground.
    //
    // So lay that whole neighbourhood again, now, as a single generation. It
    // finds one cloud where a moment ago there were two, and the ring of cells
    // that used to be the boundary is interior to what it regenerates. It also
    // takes the accumulated nodes with it: laying ground against a contour
    // doubles that contour, and this is what stops the doubling from being
    // permanent -- the contour it would have accumulated on no longer exists.
    // Only where there was something to join to. A stroke laying ground on
    // empty space has no seam, and regenerating what it just made would cost a
    // second generation and a fresh set of node ids to change nothing.
    const met = covered.some((region) => region.surfaceType === params.targetSurface);
    const normalized = !met ? 0 : normalizeTerrainAround(ctx.runtime, {
      dilatedOutline: brushSweptOutlinePolygons(
        gesture.samples.map((sample) => sample.point),
        REVEAL_RADIUS + neighbourhoodReach(params.faceSize),
      ),
      surfaceType: params.targetSurface,
      faceSide: params.faceSize,
      causeId,
      tableId: ctx.tableId,
      heightOfNewGround: heightAt,
    });

    report(
      ctx,
      normalized > 0 ? normalized : filled.built,
      filled.refused,
      filled.unadopted,
      raised,
      filled.refinementComplete,
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
): void {
  const parts: string[] = [];
  if (built > 0) parts.push(`${built} faces novas`);
  if (refused > 0) parts.push(`${refused} sobre terreno existente`);
  if (raised.raisedFaces > 0) parts.push(`${raised.raisedFaces} elevadas (${raised.movedVertices} vértices)`);
  if (unadopted > 0) parts.push(`${unadopted} junções não costuradas`);
  if (!refinementComplete) parts.push("malha mais grossa em parte da área");

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
