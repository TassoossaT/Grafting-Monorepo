import type { ConstructionGridConstraintPoint, ConstructionIrregularQuadGrid } from "@/ports";

import { TOOL_DIAGNOSTIC_PREFIX } from "../core/tool-diagnostics.ts";
import type { ConstraintRing } from "./terrain-constraints.ts";

/**
 * What one terrain commit actually did, on the console.
 *
 * Not failure reporting -- `tool-diagnostics.ts` already covers that. This is
 * for a commit that *succeeded* and still produced something wrong, which is
 * the only kind this tool has been producing. Every fix attempted here so far
 * was argued from a test that measured what the author believed mattered,
 * while the person at the table was looking at the screen. These are the
 * numbers that tell those two apart.
 *
 * Three blocks, because three different faults look identical from outside:
 *
 * - **contorno** -- what the generator was told. Its segment length against
 *   the face size is the single best predictor of the result being too fine:
 *   measured, a boundary walked at the face size yields cells at about two
 *   thirds of it, and only stops driving the interior at about twice it.
 * - **geração** -- what came back, and whether the cells are the size asked
 *   for. Purely the engine's business; if this block is right and the screen
 *   is wrong, the fault is downstream.
 * - **mescla** -- what survived registration. Faces refused and junctions
 *   left unsewn are the two ways a good mesh still lands fragmented.
 */

const TERRAIN_PREFIX = `${TOOL_DIAGNOSTIC_PREFIX} terreno`;

function segmentLengths(rings: readonly ConstraintRing[]): number[] {
  const lengths: number[] = [];
  for (const ring of rings) {
    for (let index = 0; index < ring.points.length; index += 1) {
      const from = ring.points[index]!;
      const to = ring.points[(index + 1) % ring.points.length]!;
      lengths.push(Math.hypot(to.x - from.x, to.z - from.z));
    }
  }
  return lengths;
}

function pointCount(rings: readonly ConstraintRing[]): number {
  return rings.reduce((total, ring) => total + ring.points.length, 0);
}

function sourceCount(rings: readonly ConstraintRing[]): number {
  return rings.reduce(
    (total, ring) => total + ring.points.filter((point: ConstructionGridConstraintPoint) => point.source !== undefined).length,
    0,
  );
}

/** Twice the signed area of one quad, by the shoelace rule. */
function quadArea(grid: ConstructionIrregularQuadGrid, quad: readonly number[]): number {
  let twice = 0;
  for (let index = 0; index < quad.length; index += 1) {
    const from = grid.vertices[quad[index]!];
    const to = grid.vertices[quad[(index + 1) % quad.length]!];
    if (from === undefined || to === undefined) return 0;
    twice += from.x * to.z - to.x * from.z;
  }
  return Math.abs(twice) / 2;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface TerrainCommitReport {
  /** Which operation this was: a stroke, a cut repair. */
  readonly what: string;
  readonly faceSideAsked: number;
  readonly boundary: readonly ConstraintRing[];
  readonly holes: readonly ConstraintRing[];
  readonly grid: ConstructionIrregularQuadGrid | undefined;
  readonly adopted: number;
  readonly unadopted: number;
  readonly built: number;
  readonly refusedFaces: number;
  /** Why the engine refused, in its own words, first few only. */
  readonly refusals: readonly string[];
  readonly declaredNodes: number;
  /**
   * Edges the patch walks twice the same way *before* the engine sees it.
   *
   * Non-empty means this side built the clash; empty with faces refused means
   * the edge was already standing. The two need opposite fixes.
   */
  readonly selfClashes?: readonly string[];
  /** Faces of this stroke's own type that were thrown away and laid again. */
  readonly regenerated?: number;
}

/**
 * Never throws, whatever it is handed.
 *
 * A diagnostic that costs the stroke is worse than no diagnostic: the commit
 * itself was fine, and the person at the table loses their work to the code
 * that was supposed to explain it. Every reader below is defensive for that
 * reason, and the whole thing is wrapped as well.
 */
export function logTerrainCommit(report: TerrainCommitReport): void {
  try {
    describe(report);
  } catch (error) {
    console.warn(`${TERRAIN_PREFIX} não foi possível descrever o commit`, error);
  }
}

function describe(report: TerrainCommitReport): void {
  const boundarySegments = segmentLengths(report.boundary);
  const holeSegments = segmentLengths(report.holes);
  const constrained = [...boundarySegments, ...holeSegments];
  const mean = (values: readonly number[]) =>
    values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

  const contorno = {
    aneisBoundary: report.boundary.length,
    aneisHoles: report.holes.length,
    pontos: pointCount(report.boundary) + pointCount(report.holes),
    pontosComNo: sourceCount(report.boundary) + sourceCount(report.holes),
    segmentoMedio: round(mean(constrained)),
    segmentoMinimo: round(constrained.length === 0 ? 0 : Math.min(...constrained)),
    // Split, because the two sides fail for different reasons and the fix is
    // different. A short segment on the stroke's own outline came from the
    // brush sweep; a short one among the holes is a sliver already standing in
    // the graph, left by an earlier stroke's adoption.
    minimoDoTraco: round(boundarySegments.length === 0 ? 0 : Math.min(...boundarySegments)),
    minimoDoQueJaExiste: round(holeSegments.length === 0 ? 0 : Math.min(...holeSegments)),
    // Below about 2 the boundary drives the interior and the result comes
    // back finer than the face size asked for, whatever else is right.
    razaoSegmentoPorFace: round(mean(constrained) / report.faceSideAsked),
  };

  if (report.grid === undefined) {
    console.warn(`${TERRAIN_PREFIX} ${report.what}: o gerador recusou`, { contorno });
    return;
  }

  const area = report.grid.quads.reduce((total, quad) => total + quadArea(report.grid!, quad), 0);
  const geracao = {
    vertices: report.grid.vertices.length,
    faces: report.grid.quads.length,
    faceLadoPedido: report.faceSideAsked,
    faceLadoObtido: round(report.grid.quads.length === 0 ? 0 : Math.sqrt(area / report.grid.quads.length)),
    refinamentoCompleto: report.grid.refinementComplete,
    nosNoContorno: report.grid.onContour.length,
  };

  const mescla = {
    nosAdotados: report.adopted,
    nosNaoCosturados: report.unadopted,
    nosNovosDeclarados: report.declaredNodes,
    facesRegistradas: report.built,
    facesRegeneradas: report.regenerated ?? 0,
    facesPerdidas: report.refusedFaces,
    colisoesNoProprioPatch: (report.selfClashes ?? []).length,
    motivos: [...(report.refusals ?? [])].slice(0, 3),
  };

  const wrong = report.refusedFaces > 0 || report.unadopted > 0 || contorno.razaoSegmentoPorFace < 2;
  // In the text of the line, not only in the object beside it. A console
  // collapses the object, and every number that decides anything here was
  // being read by someone who had to expand it first -- which meant the
  // deciding number was, in practice, never read.
  const line =
    `${TERRAIN_PREFIX} ${report.what}: ${geracao.faces} faces de ~${geracao.faceLadoObtido} ` +
    `(pedido ${report.faceSideAsked}), ${mescla.facesPerdidas} perdidas, ` +
    `${mescla.nosNaoCosturados} junções abertas, ${mescla.facesRegeneradas} regeneradas, ` +
    `${mescla.colisoesNoProprioPatch} colisões no próprio patch ` +
    `| contorno ${contorno.pontos} pts ` +
    `(${contorno.pontosComNo} com nó, min traço ${contorno.minimoDoTraco}, ` +
    `min existente ${contorno.minimoDoQueJaExiste}, razão ${contorno.razaoSegmentoPorFace}) ` +
    `| anéis ${contorno.aneisBoundary}+${contorno.aneisHoles}`;
  if (wrong) console.warn(line, { contorno, geracao, mescla });
  else console.info(line, { contorno, geracao, mescla });

  // Every distinct refusal, as its own plain line. A refusal is the engine
  // telling this side that it planned ground where ground already stood, and
  // its wording names the edge that decided it -- which is the whole
  // diagnosis for terrain that will not join.
  for (const clash of (report.selfClashes ?? []).slice(0, 3)) {
    console.warn(`${TERRAIN_PREFIX} ${report.what}: colisão interna -- ${clash}`);
  }
  for (const reason of new Set(report.refusals ?? [])) {
    console.warn(`${TERRAIN_PREFIX} ${report.what}: recusa -- ${reason}`);
  }
}

/**
 * How many nodes the perimeter of the ground around the stroke carries, before
 * and after.
 *
 * The one number that says whether the mesh is degrading over time. Every
 * generation laid against a contour puts a vertex at the midpoint of each of
 * its segments, so this grows unless something stops it -- and a stroke that
 * leaves it unchanged is the fixed point the tool is trying to reach.
 */
export function logContourGrowth(what: string, before: number, after: number): void {
  if (!Number.isFinite(before) || !Number.isFinite(after)) return;
  const delta = after - before;
  const line = `${TERRAIN_PREFIX} ${what}: contorno ${before} -> ${after} nós (${delta >= 0 ? "+" : ""}${delta})`;
  if (delta > 0) console.warn(line, { antes: before, depois: after, delta });
  else console.info(line, { antes: before, depois: after, delta });
}
