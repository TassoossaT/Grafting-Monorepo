import type { TerrainSculptParams } from "@/features/edit-construction";
import type {
  ConstructionCoveredRegion,
  ConstructionPosition,
  ConstructionRegionTopology,
} from "@/ports";
import polygonClipping from "polygon-clipping";
import type { MultiPolygon, Polygon, Ring } from "polygon-clipping";

// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time. The type-only
// `@/` imports above are fine -- those are erased.
import { DEFAULT_TOOL_PARAMS, outwardPerimeterRings } from "../../../../features/edit-construction/index.ts";
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
import { terrainStandingAround, type TerrainStrokeBounds } from "./terrain-neighborhood.ts";
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
function strokeChord(faceSize: number): number {
  return faceSize * OUTLINE_CHORD_PER_FACE;
}

/**
 * How big a face this stroke actually asks the generator for, folding
 * `irregularity` into the nominal `faceSize` -- never `faceSize` alone.
 *
 * `irregularity` already meant "how far from square", but a plain and a
 * mountain painted at one `faceSize` come back costing the same regardless
 * of how little the plain actually needed: flat ground reads the same at
 * cells twice the nominal size, and reads *better* there, cheaper, than at
 * the size a knobbly hill wants. So low irregularity scales the nominal size
 * up (cheap, mostly-square cells for a plain) and high irregularity scales
 * it down (finer detail for a peak) -- one slider doing double duty as both
 * "how irregular" and "how big", because on this table the two questions
 * have always had the same answer.
 *
 * `minFaceSize` is the floor that scaling never crosses: shrinking a cell
 * size roughly quadruples the faces a stroke registers each time it halves,
 * and nothing here would otherwise stop irregularity 1 on a small nominal
 * `faceSize` from asking for that every time.
 */
function effectiveFaceSize(params: TerrainSculptParams): number {
  const scaleAtSquare = 2;
  const scaleAtIrregular = 0.5;
  const scale = scaleAtSquare + (scaleAtIrregular - scaleAtSquare) * params.irregularity;
  return Math.max(params.minFaceSize, params.faceSize * scale);
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

/**
 * Rounds one coordinate to a fixed decimal precision -- far below anything
 * this pipeline treats as a meaningfully different point (the engine's own
 * weld epsilon is `1e-6`) and far above ordinary float noise.
 *
 * `polygon-clipping`'s sweep-line union is not robust to two polygons that
 * run almost, but not exactly, coincident along a long shared boundary --
 * exactly what unioning `swept` against the previous stroke's own outer
 * perimeter at the same position produces: the same circle, described by a
 * different vertex count each time (10-odd raw points for the brush, 20-odd
 * once quadrangulation has midpointed every one of them), landing a few
 * units of float error apart everywhere along what is otherwise one curve.
 * Reproduced against the live engine on the second stroke painted at one
 * spot: `Unable to find segment ... in SweepLine tree`. Snapping every
 * coordinate to this precision first removes exactly that noise before
 * `polygon-clipping` ever sees it, without moving anything a person could
 * see.
 */
function snapForUnion(ring: Ring): Ring {
  const snap = (value: number): number => Math.round(value * 1e6) / 1e6;
  return ring.map(([x, z]): [number, number] => [snap(x), snap(z)]);
}

function snapMultiPolygon(polygons: MultiPolygon): MultiPolygon {
  return polygons.map((polygon) => polygon.map(snapForUnion));
}

/**
 * The one or two rings bounding *all* of `standing`, walked by topology --
 * shared edge counts -- rather than by polygon geometry.
 *
 * This exists to keep `polygon-clipping` away from real generated meshes.
 * Handed one raw polygon per face -- dozens, on ground painted even a
 * handful of times -- its sweep-line union throws ("Unable to find segment
 * ... in SweepLine tree"), reproduced against the live engine by painting
 * one spot twenty times in a row; not a rare degenerate input, the ordinary
 * case this tool exists for. `outwardPerimeterRings` already does the exact
 * cancellation a union of touching faces would do -- an edge two faces in
 * the set share is interior and drops out, only the true outer walk
 * survives -- entirely as graph bookkeeping, without comparing a single
 * floating-point coordinate. `fillArea`'s own `polygon-clipping` call then
 * only ever has to reconcile `swept` against the one or two rings this
 * collapses to, never against every individual face's own corners.
 */
function standingOuterRings(standing: readonly ConstructionRegionTopology[]): readonly Ring[] {
  const positions = new Map<string, ConstructionPosition>();
  for (const topology of standing) {
    for (const node of topology.nodes) positions.set(node.id, node.position);
  }
  const rings: Ring[] = [];
  for (const loop of outwardPerimeterRings(standing)) {
    const ring: Ring = [];
    let complete = true;
    for (const edge of loop) {
      const position = positions.get(edge.startNodeId);
      if (position === undefined) { complete = false; break; }
      ring.push([position.x, position.z]);
    }
    if (complete && ring.length >= 3) rings.push(ring);
  }
  return rings;
}

/**
 * The standing ground `joinHalo` reclaims -- deletes and regenerates as part
 * of this same fill, rather than merely meeting: fully inside `probeArea`,
 * matching the painted type, *and* reachable by a chain of touching faces
 * that ends at one the brush itself actually overlaps.
 *
 * That last part is a deliberate restraint, not a correctness requirement --
 * `fillArea`'s own union folds in every standing neighbour regardless (see
 * its comment), and a retained neighbour's matching hole ring cancels it back
 * out wherever it lands, connected or not. What a broken chain buys is
 * scope: reclaiming, and so deleting and rebuilding, a face with no real
 * relationship to anything else this stroke touches is pure waste -- a
 * pointless separate patch generated in the same call for no benefit anyone
 * asked for. Requiring the chain keeps `joinHalo`'s reach proportional to
 * what the brush is actually doing.
 *
 * Walking the touching chain here, in the already-local `standing` set,
 * costs nothing new: it is the same neighbourhood query already paid for.
 */
function reclaimedTopologies(
  standing: readonly ConstructionRegionTopology[],
  targetSurface: string,
  swept: MultiPolygon,
  probeArea: MultiPolygon,
): readonly ConstructionRegionTopology[] {
  const candidates = standing.filter(
    (topology) =>
      topology.surfaceType === targetSurface &&
      topology.nodes.length > 0 &&
      topology.nodes.every((node) => insideSwept(node.position, probeArea)),
  );

  const byNode = new Map<string, ConstructionRegionTopology[]>();
  for (const topology of candidates) {
    for (const node of topology.nodes) {
      const sharing = byNode.get(node.id);
      if (sharing) sharing.push(topology);
      else byNode.set(node.id, [topology]);
    }
  }

  const reachable = new Map<string, ConstructionRegionTopology>();
  const frontier = candidates.filter((topology) => topology.nodes.some((node) => insideSwept(node.position, swept)));
  for (const topology of frontier) reachable.set(topology.surfaceKey.join(" "), topology);
  while (frontier.length > 0) {
    const topology = frontier.pop()!;
    for (const node of topology.nodes) {
      for (const neighbour of byNode.get(node.id) ?? []) {
        const key = neighbour.surfaceKey.join(" ");
        if (reachable.has(key)) continue;
        reachable.set(key, neighbour);
        frontier.push(neighbour);
      }
    }
  }
  return [...reachable.values()];
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
      strokeChord(effectiveFaceSize(params)),
    );
  },

  // Presence of this hook makes the generic dispatcher capture and sample the drag; the grid is only ever generated on release.
  onPointerMove(): void {},

  onPointerUp(ctx: ToolContext, gesture: ToolGesture, params: TerrainSculptParams): void {
    const salt = ctx.nextSequence();
    const causeId = `${ctx.tableId}:terrain-sculpt:${salt}`;
    // Everything below scales off this, not off `params.faceSize` directly --
    // see `effectiveFaceSize`'s own comment for why `irregularity` and
    // `minFaceSize` both feed into it.
    const faceSize = effectiveFaceSize(params);
    const swept = brushSweptOutlinePolygons(
      gesture.samples.map((sample) => sample.point),
      params.brushRadius,
      strokeChord(faceSize),
    );
    // How far out to *look* for standing ground worth reclaiming -- never how
    // far out to *generate*. `probeArea` only decides which nearby faces are
    // close enough to fold into this stroke; the actual fill boundary built
    // below (also named `fillArea`, once it exists) is the brush's own
    // outline plus the real footprint of whatever `probeArea` found, and
    // never anything wider than that. The preview promised the brush's own
    // shape, and nothing this stroke does may generate ground beyond it --
    // ground already standing can be reclaimed and re-laid, since that space
    // was never empty, but empty space past the brush stays empty.
    const probeArea =
      params.joinHalo > 0
        ? brushSweptOutlinePolygons(
            gesture.samples.map((sample) => sample.point),
            params.brushRadius + faceSize * params.joinHalo,
            strokeChord(faceSize),
          )
        : swept;

    // One stroke does both, per area -- it is not a choice between them.
    // Where ground already exists the covered faces are raised; where it does
    // not, terrain is generated. A stroke uniting two patches spans exactly
    // that mix.
    //
    // The raise goes first so generation meets ground already at its final
    // height: a corner shared with the rim wants the raised Y, not the stale
    // one. Occupancy is unaffected either way -- the raise moves ground in Y,
    // never in XZ.
    const covered = coveredByStroke(ctx, swept);
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
    // Whole, not merely touched. A face `probeArea` only clips keeps ground
    // outside that outline, and the fill stops at that outline -- so
    // consuming it would leave a gap exactly as wide as the part that stuck
    // out. Those stay, and their contour is what the new ground meets.
    // Seeded with what the *halo* covers, not just the brush's own footprint
    // (`covered`, above). `joinHalo`'s entire point is reaching ground the
    // brush itself never overlaps, so when it is the only thing nearby,
    // `covered` is empty -- and an empty seed list is what sends
    // `terrainStandingAround` looking at every region in the box, joinHalo's
    // intended neighbour included but also anything else that happens to
    // share the box without sharing so much as a node with this stroke.
    // `probeArea` already is `swept` when there is no halo, so this only
    // costs a second engine crossing while `joinHalo` is actually widening
    // the reach.
    const probeExtent = boundsOf(probeArea);
    const haloCovered = params.joinHalo > 0 ? coveredByStroke(ctx, probeArea) : covered;
    const standing = terrainStandingAround(ctx.runtime, haloCovered, probeExtent, faceSize * 2);
    const consumed = reclaimedTopologies(standing, params.targetSurface, swept, probeArea);

    // The generator is never asked for ground beyond the brush's own outline
    // plus the real shape of everything standing nearby -- reclaimed or not
    // -- folded in, never by the halo distance that found it. Empty space
    // past the brush is never included, whatever `joinHalo` is set to.
    //
    // **All of `standing`, not just `consumed`.** A face this stroke reclaims
    // sits right next to faces it does not -- the retained layer just past
    // the seam -- and a shared edge between the two is a real edge in the
    // graph today. Folding in only the reclaimed side would describe that
    // edge twice: once as part of *this* outer boundary (the reclaimed
    // face's own far side), and once as part of the retained neighbour's own
    // outward perimeter, which becomes a hole below. The same segment as both
    // "the edge of the ground" and "the edge of a hole in it" is a
    // contradiction the CDT resolves by treating it as a self-cancelling
    // sliver of zero ground -- a real hole, exactly along the seam this
    // stroke just reclaimed. Reported on the table right after the fix that
    // first folded reclaimed ground in this way.
    //
    // Folding retained ground into this too does not add it to the final
    // mesh -- `holeRings` below still carves it back out, exactly as it
    // always has. It only makes the *outer* silhouette self-consistent with
    // the holes it is about to carry: the reclaim/retain seam becomes
    // internal and disappears from the boundary entirely, leaving the hole
    // ring as the sole authority for where it runs -- the same contract the
    // swept/retained seam has always kept.
    //
    // **Why `standingOuterRings`, not one `polygon-clipping` polygon per
    // face.** That was the next thing tried, and it does not survive contact
    // with a real table: handed one raw polygon per standing face -- dozens,
    // on ground painted even a handful of times -- `polygon-clipping`'s
    // sweep-line union reliably throws ("Unable to find segment ... in
    // SweepLine tree"), reproduced by painting one spot twenty times in a
    // row. `standingOuterRings` collapses that same cancellation down to the
    // one or two rings it was always going to reduce to first, by topology,
    // so the one `polygon-clipping` call left only ever reconciles `swept`
    // against those -- never against every individual face's own corners.
    const outerRings = standingOuterRings(standing);
    const fillArea: MultiPolygon =
      outerRings.length === 0
        ? swept
        : polygonClipping.union(snapMultiPolygon(swept), ...outerRings.map((ring): Polygon => [snapForUnion(ring)]));

    // What the stroke (now widened by whatever it just reclaimed) asks to
    // fill, and what is already standing in it. The second becomes holes:
    // ground somebody already holds is not regenerated, it is met.
    // The cell size goes into the sweep, so the outline is never described
    // more finely than the mesh it is about to bound. A boundary point is a
    // cell corner, and a patch comes back with about twice as many faces as
    // its boundary has points.
    const weld = faceSize * OUTLINE_WELD_PER_FACE;
    const outline = outlineConstraints(fillArea.flatMap((polygon) => polygon.slice(0, 1)), weld);
    if (outline.length === 0) {
      ctx.reportFeedback({ tone: "info", message: "Nada a fazer aqui." });
      return;
    }
    const consumedKeys = new Set(consumed.map((topology) => topology.surfaceKey.join(" ")));
    const retained = standing.filter((topology) => !consumedKeys.has(topology.surfaceKey.join(" ")));
    const perimeters = perimeterConstraints(retained, 0);
    const contourBefore = perimeters.sources.length;
    // A stroke that curls back on itself leaves a real hole in `fillArea`'s
    // own shape, and `polygon-clipping` reports it as an inner ring. Ground
    // there was never painted, so it is subtracted like any other hole -- it
    // simply has no edges, and so owes nobody an adopted node.
    const holeRings: readonly ConstraintRing[] = [
      ...outlineConstraints(fillArea.flatMap((polygon) => polygon.slice(1)), weld),
      ...perimeters.rings,
    ];
    const extent = boundsOf(fillArea);

    // Height comes from the noise field over the area the fill actually
    // covers, so it is asked for the extent the generator settled on rather
    // than the one this side guessed before generating.
    // The noise window is anchored to the world and sized to the stroke, never
    // the other way round: one world point has one height, whichever stroke
    // asks for it, so ground laid now and ground laid later are the same
    // surface where they meet.
    const { minX, minZ, maxX, maxZ } = extent;
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
      faceSize * 2,
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
      faceSide: faceSize,
      relaxStrength: params.irregularity,
      surfaceType: params.targetSurface,
      boundary: outline,
      holes: holeRings,
      sources: perimeters.sources,
      // A pure creation has nothing whose deletion needs transactional
      // rollback. Let it use the direct add path instead of cloning the whole
      // construction session solely to replace an empty set.
      replaceSurfaceKeys: consumed.length === 0 ? undefined : consumed.map((topology) => topology.surfaceKey),
      topologySeeds: retained.map((topology) => ({ seed: topology.surfaceKey, surfaceType: topology.surfaceType })),
      heightAt,
    });

    // The growth of the contour was measured here, by scanning the
    // neighbourhood a second time once the stroke had landed. It cost a full
    // repeat of the three most expensive steps of the gesture -- the coverage
    // query, the neighbourhood walk and the perimeter -- on every stroke, for
    // one console line. It is gone, and nothing is lost with it: the commit
    // line already carries `contorno N pts (M com nó)` for what went down and
    // `nosNoContorno` for what the new mesh planted on it, which is the
    // accumulation the growth number was there to expose.
    void contourBefore;

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
