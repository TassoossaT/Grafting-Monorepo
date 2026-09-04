import { DEFAULT_TOOL_PARAMS } from "@/features/edit-construction";
import type { TerrainSculptParams } from "@/features/edit-construction";
import type {
  ConstructionCoveredRegion,
  ConstructionIrregularQuadGrid,
  ConstructionNodeId,
  ConstructionOrientedEdgeUse,
  ConstructionPatch,
  ConstructionPatchRegion,
  ConstructionPosition,
  ConstructionRegionTopology,
} from "@/ports";

import { brushSweptOutlinePolygons, brushSweptRegionFill } from "../shapes/preview-shapes.ts";
import { restackTerrain } from "./terrain-restack.ts";
import {
  adoptContourNodes,
  outlineConstraints,
  perimeterConstraints,
  resolveAdoptions,
  type ConstraintRing,
} from "./terrain-constraints.ts";
import type { ConstructionTool, ToolContext, ToolGesture } from "../core/tool-context.ts";
import { createBoundaryEdges } from "../core/boundary-edges.ts";

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

/** Physical edge length of one triangle in the lattice -- world-space scale of one cell. */
const HEX_TRIANGLE_SIDE = 2;

/** The brush's own reach: how wide a band the stroke paints, and the shape the preview shows. */
const REVEAL_RADIUS = HEX_TRIANGLE_SIDE * 1.5;

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

function nodeId(ctx: ToolContext, salt: number, vertexIndex: number): ConstructionNodeId {
  return `${ctx.tableId}:terrain-sculpt-${salt}:v${vertexIndex}`;
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

/**
 * Turns the generated grid into a patch whose neighbours share their boundary
 * edges.
 *
 * The edge between two nodes is named after the *pair*, in a fixed order, so
 * both faces that meet on it derive the same name and end up referencing one
 * edge used twice. Letting each face mint its own produces two coincident
 * edges used once each: visually identical, structurally unconnected.
 *
 * `refuse-when-full` because a boundary with a face on both sides is interior
 * ground, and terrain is never created above anything -- a face that finds its
 * edge full is meant to be refused, not rescued with an edge of its own.
 */
function toPatch(
  ctx: ToolContext,
  grid: ConstructionIrregularQuadGrid,
  idFor: (vertex: number) => ConstructionNodeId | undefined,
  nodes: readonly { readonly id: ConstructionNodeId; readonly position: ConstructionPosition }[],
  params: TerrainSculptParams,
): ConstructionPatch {
  const edges = createBoundaryEdges(ctx.tableId, { kind: "refuse-when-full" });
  const regions: ConstructionPatchRegion[] = [];

  for (const quad of grid.quads) {
    const cycle = quad.map(idFor).filter((id): id is ConstructionNodeId => id !== undefined);
    if (cycle.length !== quad.length) continue;
    // A cell whose corners resolved to the same node twice carries no ground.
    // With nothing welding by proximity any more this should not happen at
    // all; it is cheaper to skip than to have the engine reject the batch.
    if (new Set(cycle).size !== cycle.length) continue;

    const boundary: ConstructionOrientedEdgeUse[] = [];
    for (let index = 0; index < cycle.length; index += 1) {
      boundary.push(edges.use(cycle[index]!, cycle[(index + 1) % cycle.length]!));
    }
    regions.push({
      regionId: cycle.join("|"),
      boundary,
      surfaceType: params.targetSurface,
      physical: true,
    });
  }

  return { nodes, edges: edges.all(), regions };
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

    const grid = ctx.runtime.generateIrregularQuadGrid({
      seed: Math.floor(params.seed) || 1,
      triangleSide: HEX_TRIANGLE_SIDE,
      boundary: outline.map((ring) => ring.points),
      holes: holeRings.map((ring) => ring.points),
    });
    if (grid === undefined) {
      report(ctx, 0, 0, 0, raised);
      return;
    }

    // Height. A corner that already exists keeps the height it has -- it is
    // the same node, and moving it would drag the ground it already belongs
    // to. Everything else samples the heightmap over the stroke's own extent,
    // except a corner being adopted onto a neighbour edge, which takes the
    // height of that edge so the seam has no vertical kink.
    const heightmap = ctx.runtime.generateHeightmap(
      HEIGHTMAP_RESOLUTION,
      HEIGHTMAP_RESOLUTION,
      Math.floor(params.seed) || 1,
      params.noiseScale,
    );
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const vertex of grid.vertices) {
      minX = Math.min(minX, vertex.x);
      minZ = Math.min(minZ, vertex.z);
      maxX = Math.max(maxX, vertex.x);
      maxZ = Math.max(maxZ, vertex.z);
    }
    const spanX = maxX - minX || 1;
    const spanZ = maxZ - minZ || 1;
    const sampledHeight = (x: number, z: number): number =>
      sampleHeightmapBilinear(heightmap, HEIGHTMAP_RESOLUTION, (x - minX) / spanX, (z - minZ) / spanZ) *
      params.heightScale;

    const live = ctx.runtime.getSnapshot().map.nodePositions;
    const adoptions = resolveAdoptions(holeRings, outline, grid.onContour, (vertex) => grid.vertices[vertex]);
    const adoptionPositions = new Map<number, ConstructionPosition>();
    for (const adoption of adoptions) {
      const vertex = grid.vertices[adoption.vertex];
      const from = live.get(adoption.edge.startNodeId)?.position;
      const to = live.get(adoption.edge.endNodeId)?.position;
      if (vertex === undefined) continue;
      const y =
        from !== undefined && to !== undefined
          ? from.y + (to.y - from.y) * adoption.along
          : sampledHeight(vertex.x, vertex.z);
      adoptionPositions.set(adoption.vertex, { x: vertex.x, y, z: vertex.z });
    }

    const adoption = adoptContourNodes(
      ctx.runtime,
      ctx.tableId,
      salt,
      causeId,
      adoptions,
      (vertex) => nodeId(ctx, salt, vertex),
      (vertex) => adoptionPositions.get(vertex),
    );

    // Which node id every corner of the grid resolves to, and which of those
    // this stroke still has to declare. A corner that arrived with a source is
    // a node already standing; one just adopted onto a neighbour edge was
    // created by that split. Declaring either again would be a second node at
    // the same identity.
    const idFor = (vertex: number): ConstructionNodeId | undefined => {
      const source = grid.vertices[vertex]?.source;
      if (source !== undefined) return perimeters.sources[source];
      return nodeId(ctx, salt, vertex);
    };
    const nodes: { readonly id: ConstructionNodeId; readonly position: ConstructionPosition }[] = [];
    for (let vertex = 0; vertex < grid.vertices.length; vertex += 1) {
      const point = grid.vertices[vertex]!;
      if (point.source !== undefined || adoption.adopted.has(vertex)) continue;
      const id = idFor(vertex);
      if (id === undefined) continue;
      // A refused adoption still needs its node, or the face referencing it
      // has no corner. It lands as ordinary new geometry -- one T-junction
      // instead of one missing cell.
      nodes.push({
        id,
        position: adoptionPositions.get(vertex) ?? { x: point.x, y: sampledHeight(point.x, point.z), z: point.z },
      });
    }

    // A face the engine refuses is one whose boundary had no room -- ground
    // that already has a face on both sides. It costs that face, never the
    // stroke, so the count is reported rather than treated as a failure.
    const outcome = ctx.runtime.addPatch(toPatch(ctx, grid, idFor, nodes, params), "local", causeId);
    report(
      ctx,
      outcome.createdSurfaceKeys.length,
      outcome.skippedRegionIds.length,
      adoption.refused.length,
      raised,
      grid.refinementComplete,
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
