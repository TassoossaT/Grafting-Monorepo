import type {
  BezierPort,
  ConstructionPatchEdge,
  ConstructionPatchRegion,
  ConstructionPosition,
  ConstructionRegionTopology,
} from "@/ports";
import { automaticCurve, ribbonSections, sampleRibbons } from "./bezier-curve.ts";

/**
 * A strip swept along a 3D curve: a row of stations, each one horizontal
 * cross-section of two nodes, joined into quads. The curve may climb -- every
 * control point carries its own height -- but a station never tilts sideways.
 *
 * Generic on purpose. Nothing here knows what a strip is *for*; a sloped
 * platform, a ramp and a spiral stair are all callers choosing control points
 * and a width. The curve fitting and the lateral offset go through the shared
 * curve module (`bezier-curve.ts`), the same one roads use; this module only
 * names what comes back.
 *
 * **Why quads and not one contour.** A spiral's turns overlap in plan, so any
 * planar union of its footprint would weld one turn onto the next. One face per
 * station span keeps every face nearly planar and never overlapping itself.
 *
 * **Identity lives on edges.** Stations are read back from rung edge ids, not
 * node ids, because a strip end welded onto an existing corner reuses that
 * corner's node -- the node keeps its owner's id, while the rung keeps ours.
 */

export type StripSide = "l" | "r";

export interface StripStation {
  readonly l: ConstructionPosition;
  readonly r: ConstructionPosition;
}

/** How closely a station row follows the true curve, in world units. */
const STRIP_TOLERANCE = 0.05;

/**
 * Stations along the smooth curve through `controlPoints`, `width` wide.
 * Consecutive curve spans share their joint station exactly once.
 */
export function sampleStripStations(
  port: Pick<BezierPort, "curveBatch">,
  controlPoints: readonly ConstructionPosition[],
  width: number,
): readonly StripStation[] {
  if (!(width > 0)) throw new Error("A largura deve ser positiva.");
  if (controlPoints.length < 2) throw new Error("Marque pelo menos dois pontos.");
  const half = width / 2;
  const curves = automaticCurve(port, controlPoints, STRIP_TOLERANCE).curves;
  const outlines = sampleRibbons(port, curves.map((curve) => ({ curve, offsets: [-half, half] as const })), STRIP_TOLERANCE);
  const stations: StripStation[] = [];
  outlines.forEach((outline, index) => {
    // Consecutive curves share their joint section; keep it once.
    ribbonSections(outline).slice(index === 0 ? 0 : 1).forEach((section) => stations.push({ l: section.min, r: section.max }));
  });
  if (stations.length < 2) throw new Error("A curva não teve extensão suficiente.");
  return stations;
}

/**
 * Control points of a helix around `center`, starting at `center.y` and
 * climbing `rise` over `turns` full turns. Eight per turn keeps the automatic
 * curve visibly round.
 */
export function helixControlPoints(
  center: ConstructionPosition,
  radius: number,
  turns: number,
  rise: number,
  startAngle = 0,
): readonly ConstructionPosition[] {
  if (!(radius > 0) || !(turns > 0) || !Number.isFinite(rise)) throw new Error("Raio e voltas devem ser positivos.");
  const steps = Math.max(2, Math.ceil(turns * 8));
  return Array.from({ length: steps + 1 }, (_, k) => {
    const angle = startAngle + (k / steps) * turns * Math.PI * 2;
    return { x: center.x + radius * Math.cos(angle), y: center.y + (rise * k) / steps, z: center.z + radius * Math.sin(angle) };
  });
}

export const stripRungEdgeId = (stripId: string, index: number): string => `${stripId}:rung:${index}`;
export const stripRailEdgeId = (stripId: string, side: StripSide, index: number): string => `${stripId}:rail:${side}:${index}`;
export const stripNodeId = (stripId: string, index: number, side: StripSide): string => `${stripId}:station:${index}:${side}`;

export function parseStripRungEdgeId(edgeId: string): { readonly stripId: string; readonly index: number } | undefined {
  const match = /^(.*):rung:(\d+)$/.exec(edgeId);
  return match ? { stripId: match[1]!, index: Number(match[2]) } : undefined;
}

/** Whether a face is one span of a swept strip. */
export function isStripFace(topology: ConstructionRegionTopology): boolean {
  return topology.outerLoops.some((loop) => loop.some((use) => parseStripRungEdgeId(use.edgeId) !== undefined));
}

/**
 * The strip's nodes, edges and one quad per span. `nodeIds` lets a caller
 * substitute an existing node for a station end it welds onto.
 */
export function stripPatch(
  stripId: string,
  stations: readonly StripStation[],
  surfaceType: string,
  nodeIds: (index: number, side: StripSide) => string = (index, side) => stripNodeId(stripId, index, side),
): {
  readonly nodes: readonly { readonly id: string; readonly position: ConstructionPosition }[];
  readonly edges: readonly ConstructionPatchEdge[];
  readonly regions: readonly ConstructionPatchRegion[];
} {
  const nodes = stations.flatMap((station, i) => (["l", "r"] as const).map((side) => ({ id: nodeIds(i, side), position: station[side] })));
  const edges: ConstructionPatchEdge[] = stations.map((_, i) => ({ edgeId: stripRungEdgeId(stripId, i), startNodeId: nodeIds(i, "l"), endNodeId: nodeIds(i, "r") }));
  const regions: ConstructionPatchRegion[] = [];
  for (let i = 0; i + 1 < stations.length; i += 1) {
    for (const side of ["l", "r"] as const) {
      edges.push({ edgeId: stripRailEdgeId(stripId, side, i), startNodeId: nodeIds(i, side), endNodeId: nodeIds(i + 1, side) });
    }
    regions.push({
      regionId: `${stripId}:span:${i}`,
      surfaceType,
      physical: true,
      boundary: [
        { edgeId: stripRailEdgeId(stripId, "l", i), reversed: false },
        { edgeId: stripRungEdgeId(stripId, i + 1), reversed: false },
        { edgeId: stripRailEdgeId(stripId, "r", i), reversed: true },
        { edgeId: stripRungEdgeId(stripId, i), reversed: true },
      ],
    });
  }
  return { nodes, edges, regions };
}

interface StripRow { readonly l: { id: string; position: ConstructionPosition }; readonly r: { id: string; position: ConstructionPosition } }

/** Every strip the faces belong to, as ordered station rows. Strips with a gap in their row are skipped. */
export function readStrips(topologies: readonly ConstructionRegionTopology[]): ReadonlyMap<string, readonly StripRow[]> {
  const rows = new Map<string, Map<number, StripRow>>();
  for (const topology of topologies) {
    const positions = new Map(topology.nodes.map((node) => [node.id, node.position]));
    for (const use of [...topology.outerLoops, ...topology.holes].flat()) {
      const rung = parseStripRungEdgeId(use.edgeId);
      if (rung === undefined) continue;
      const [l, r] = use.reversed ? [use.endNodeId, use.startNodeId] : [use.startNodeId, use.endNodeId];
      const lp = positions.get(l), rp = positions.get(r);
      if (!lp || !rp) continue;
      const strip = rows.get(rung.stripId) ?? new Map<number, StripRow>();
      strip.set(rung.index, { l: { id: l, position: lp }, r: { id: r, position: rp } });
      rows.set(rung.stripId, strip);
    }
  }
  const result = new Map<string, readonly StripRow[]>();
  for (const [stripId, strip] of rows) {
    const ordered = Array.from({ length: strip.size }, (_, i) => strip.get(i));
    if (ordered.every((row): row is StripRow => row !== undefined) && ordered.length >= 2) result.set(stripId, ordered);
  }
  return result;
}

/**
 * Spreads received motion along each strip instead of kinking it at the
 * moved station.
 *
 * Every station a move already reached is an anchor, and so are both ends --
 * an unmoved end stays where it stands. Each side's stations in between take
 * the anchors' displacement interpolated by arc length along the strip. On a
 * climbing strip that is exactly what regenerating it between its new ends
 * would give for height; a helix stays a helix.
 */
export function interpolateStripMotion(
  topologies: readonly ConstructionRegionTopology[],
  moved: ReadonlyMap<string, ConstructionPosition>,
): ReadonlyMap<string, ConstructionPosition> {
  const derived = new Map<string, ConstructionPosition>();
  for (const rows of readStrips(topologies).values()) {
    if (!rows.some((row) => moved.has(row.l.id) || moved.has(row.r.id))) continue;
    const arc = [0];
    for (let i = 1; i < rows.length; i += 1) {
      const a = mid(rows[i - 1]!), b = mid(rows[i]!);
      arc.push(arc[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
    }
    for (const side of ["l", "r"] as const) {
      const deltaAt = (i: number): ConstructionPosition | undefined => {
        const node = rows[i]![side];
        const target = moved.get(node.id);
        return target && { x: target.x - node.position.x, y: target.y - node.position.y, z: target.z - node.position.z };
      };
      const anchors = rows.map((_, i) => i).filter((i) => i === 0 || i === rows.length - 1 || deltaAt(i) !== undefined);
      for (let k = 0; k + 1 < anchors.length; k += 1) {
        const from = anchors[k]!, to = anchors[k + 1]!;
        const d0 = deltaAt(from) ?? ZERO, d1 = deltaAt(to) ?? ZERO;
        const span = arc[to]! - arc[from]!;
        for (let i = from + 1; i < to; i += 1) {
          const node = rows[i]![side];
          if (moved.has(node.id) || derived.has(node.id)) continue;
          const t = span > 1e-9 ? (arc[i]! - arc[from]!) / span : 0;
          const delta = { x: d0.x + (d1.x - d0.x) * t, y: d0.y + (d1.y - d0.y) * t, z: d0.z + (d1.z - d0.z) * t };
          if (Math.abs(delta.x) + Math.abs(delta.y) + Math.abs(delta.z) < 1e-9) continue;
          derived.set(node.id, { x: node.position.x + delta.x, y: node.position.y + delta.y, z: node.position.z + delta.z });
        }
      }
    }
  }
  return derived;
}

const ZERO: ConstructionPosition = { x: 0, y: 0, z: 0 };
const mid = (row: StripRow): ConstructionPosition => ({
  x: (row.l.position.x + row.r.position.x) / 2,
  y: (row.l.position.y + row.r.position.y) / 2,
  z: (row.l.position.z + row.r.position.z) / 2,
});
