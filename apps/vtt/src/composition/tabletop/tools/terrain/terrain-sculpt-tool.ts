import { DEFAULT_TOOL_PARAMS } from "@/features/edit-construction";
import type { TerrainSculptParams } from "@/features/edit-construction";
import type {
  ConstructionCoveredRegion,
  ConstructionPosition,
  ConstructionRegionTopology,
  ConstructionSurfaceKey,
} from "@/ports";
import type { MultiPolygon } from "polygon-clipping";

import { brushSweptOutlinePolygons, brushSweptRegionFill } from "../shapes/preview-shapes.ts";
import { dirtLoadOver, restackTerrain } from "./terrain-restack.ts";
import {
  OUTLINE_CHORD_PER_FACE,
  OUTLINE_WELD_PER_FACE,
  outlineConstraints,
  perimeterConstraints,
  type ConstraintRing,
} from "./terrain-constraints.ts";
import { fillTerrain } from "./terrain-fill.ts";
import { heightFieldOf } from "./terrain-regenerate.ts";
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

const TERRAIN_COLOR: Record<TerrainSculptParams["targetSurface"], number> = {
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
function strokeChord(params: TerrainSculptParams): number {
  return params.faceSize * OUTLINE_CHORD_PER_FACE;
}

function coveredByStroke(
  ctx: ToolContext,
  gesture: ToolGesture,
  params: TerrainSculptParams,
): readonly ConstructionCoveredRegion[] {
  const merged = new Map<string, ConstructionCoveredRegion>();
  for (const polygon of brushSweptOutlinePolygons(
    gesture.samples.map((sample) => sample.point),
    params.brushRadius,
    strokeChord(params),
  )) {
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
 * Everything already standing that the stroke reaches, as **whole clouds**.
 *
 * Whole clouds, not the faces the footprint happens to touch, and the
 * difference is not a refinement -- it decides whether the result is one mesh
 * or a scattering of them.
 *
 * The perimeter of a *subset* of a cloud is not that cloud's boundary. It runs
 * partly through the cloud's own interior, over edges that already carry a
 * face on both sides. Handing that to the generator as the outline of occupied
 * ground says the far side of those edges is free, so cells get planned
 * against them -- and every one of those faces is refused at registration,
 * because an edge with two sides is exactly what `refuse-when-full` exists to
 * protect. Faces vanish in ones and twos all along the seam, and what lands is
 * a mesh with holes punched through it.
 *
 * `cloudFor` is the query that answers this properly: the connected component
 * of same-type surfaces reachable through shared nodes. Its perimeter is a
 * real free boundary, every edge of it with one side still open.
 */
function standingAround(
  ctx: ToolContext,
  covered: readonly ConstructionCoveredRegion[],
): readonly ConstructionRegionTopology[] {
  const keys = new Map<string, ConstructionSurfaceKey>();
  for (const region of covered) {
    const cloud = ctx.runtime.cloudFor({ seed: region.surfaceKey, surfaceType: region.surfaceType });
    for (const surfaceKey of cloud.surfaceKeys) keys.set(surfaceKey.join(" "), surfaceKey);
  }
  return [...keys.values()]
    .map((surfaceKey) => ctx.runtime.getRegionTopology(surfaceKey))
    .filter((topology): topology is ConstructionRegionTopology => topology !== undefined);
}

/** Terrain-sculpt's own effect: the brush hands over the whole gesture, once, on release. */
export const terrainSculptTool: ConstructionTool<"terrain-sculpt"> = {
  id: "terrain-sculpt",
  defaultParams: () => DEFAULT_TOOL_PARAMS["terrain-sculpt"],

  previewFor(gesture: ToolGesture, params: TerrainSculptParams) {
    return brushSweptRegionFill(
      gesture.samples.map((sample) => sample.point),
      { kind: "circle", radius: params.brushRadius },
      TERRAIN_COLOR[params.targetSurface],
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

    // One stroke does both, per area -- it is not a choice between them.
    // Where ground already exists the covered faces are raised; where it does
    // not, terrain is generated. A stroke uniting two patches spans exactly
    // that mix.
    //
    // The raise goes first so generation meets ground already at its final
    // height: a corner shared with the rim wants the raised Y, not the stale
    // one. Occupancy is unaffected either way -- the raise moves ground in Y,
    // never in XZ.
    const covered = coveredByStroke(ctx, gesture, params);
    const raised =
      covered.length > 0
        ? restackTerrain(
            ctx,
            params.targetSurface,
            covered,
            causeId,
            dirtLoadOver(gesture.samples.map((sample) => sample.point), params.brushRadius),
          )
        : { raisedFaces: 0, movedVertices: 0, skipped: [] };

    // What the stroke asks to fill, and what is already standing in it. The
    // second becomes holes: ground somebody already holds is not regenerated,
    // it is met.
    // The cell size goes into the sweep, so the outline is never described
    // more finely than the mesh it is about to bound. A boundary point is a
    // cell corner, and a patch comes back with about twice as many faces as
    // its boundary has points.
    const swept = brushSweptOutlinePolygons(
      gesture.samples.map((sample) => sample.point),
      params.brushRadius,
      strokeChord(params),
    );
    const weld = params.faceSize * OUTLINE_WELD_PER_FACE;
    const outline = outlineConstraints(swept.flatMap((polygon) => polygon.slice(0, 1)), weld);
    if (outline.length === 0) {
      ctx.reportFeedback({ tone: "info", message: "Nada a fazer aqui." });
      return;
    }
    // Ground the stroke covers *whole* is not met, it is regenerated: the
    // faces go away and the area they held is laid again as part of this one
    // generation.
    //
    // This is what stops the two failures the table reported together. A face
    // left standing under the stroke is ground the generator is then told to
    // work around, so it plans cells against edges that already carry a face
    // on both sides and the engine refuses them -- 53 faces lost on one
    // stroke, which is the band along the join simply never registering. And
    // being told to stop at that face's contour is what put a vertex in the
    // middle of every one of its edges, because the ortho step midpoints every
    // segment it is given and the seam then has to adopt the result. Delete
    // the face instead and neither arises: nothing to refuse, nothing to
    // subdivide, and the ground comes back in one piece at one size.
    //
    // Whole, not merely touched. A face the stroke only clips keeps ground
    // outside the swept outline, and the fill stops at that outline -- so
    // consuming it would leave a gap exactly as wide as the part that stuck
    // out. Those stay, and their contour is what the new ground meets.
    const standing = standingAround(ctx, covered);
    const consumed = standing.filter(
      (topology) =>
        topology.surfaceType === params.targetSurface &&
        topology.nodes.length > 0 &&
        topology.nodes.every((node) => insideSwept(node.position, swept)),
    );
    const consumedKeys = new Set(consumed.map((topology) => topology.surfaceKey.join(" ")));
    const perimeters = perimeterConstraints(
      standing.filter((topology) => !consumedKeys.has(topology.surfaceKey.join(" "))),
      0,
    );
    const contourBefore = perimeters.sources.length;
    // A stroke that curls back on itself leaves a real hole in its own swept
    // shape, and `polygon-clipping` reports it as an inner ring. Ground there
    // was never painted, so it is subtracted like any other hole -- it simply
    // has no edges, and so owes nobody an adopted node.
    const holeRings: readonly ConstraintRing[] = [
      ...outlineConstraints(swept.flatMap((polygon) => polygon.slice(1)), weld),
      ...perimeters.rings,
    ];

    // Height comes from the noise field over the area the fill actually
    // covers, so it is asked for the extent the generator settled on rather
    // than the one this side guessed before generating.
    // The noise window is anchored to the world and sized to the stroke, never
    // the other way round: one world point has one height, whichever stroke
    // asks for it, so ground laid now and ground laid later are the same
    // surface where they meet.
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
    const originX = Math.floor(minX / NOISE_SPACING) - 1;
    const originZ = Math.floor(minZ / NOISE_SPACING) - 1;
    const columns = Math.ceil(maxX / NOISE_SPACING) - originX + 2;
    const rows = Math.ceil(maxZ / NOISE_SPACING) - originZ + 2;
    const heightmap = ctx.runtime.generateHeightmap(
      columns,
      rows,
      Math.floor(params.seed) || 1,
      params.noiseScale,
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
      ) * params.heightScale;

    // Ground being regenerated keeps the height it had, read from the corners
    // about to be deleted -- the raise this very stroke just applied
    // included. Sampling the noise there instead would flatten the relief a
    // person built up, and painting the same hill twice would reset it rather
    // than raise it.
    const kept = heightFieldOf(
      consumed.flatMap((topology) => topology.nodes.map((node) => node.position)),
      params.faceSize * 2,
    );
    const heightAt = (point: { readonly x: number; readonly z: number }): number =>
      kept.at(point) ?? noiseAt(point);

    const filled = fillTerrain(ctx.runtime, {
      what: "pincelada",
      regenerated: consumed.length,
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
      // Only once the generator has answered. A refusal then costs nothing;
      // deleting first would cost the ground with nothing to lay back.
      onGenerated: () => {
        let deleted = 0;
        const failed: string[] = [];
        for (const topology of consumed) {
          try {
            ctx.runtime.applyRegionEdit(
              [{ kind: "delete-region", surfaceKey: topology.surfaceKey }],
              "local",
              causeId,
            );
            deleted += 1;
          } catch (error) {
            // One stale key is that key's own problem, never a reason to leave
            // the rest of the ground standing under the stroke. But it is
            // counted and its words kept: ground that failed to go was left
            // out of the hole rings on the promise that it would, so the next
            // face laid over it collides with nothing anyone declared.
            failed.push(error instanceof Error ? error.message : String(error));
          }
        }
        return { deleted, failed };
      },
    });

    // The one number that says whether the mesh degrades over strokes: how
    // many nodes the perimeter of the ground around this stroke carries, now
    // that the stroke has landed. Read the same way it was read before, over
    // the same clouds, so the two are comparable.
    logContourGrowth(
      "pincelada",
      contourBefore,
      perimeterConstraints(standingAround(ctx, coveredByStroke(ctx, gesture, params)), 0).sources.length,
    );

    report(ctx, filled.built, filled.refused, filled.unadopted, raised, filled.refinementComplete);
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
  // Named as a loss rather than as a note. A refusal means the generator
  // planned a face over ground that was already occupied, which is a fault in
  // what it was told, not a normal outcome -- and reading it as one is how a
  // mesh full of holes went unnoticed.
  if (refused > 0) parts.push(`${refused} faces perdidas (aresta sem lado livre)`);
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
