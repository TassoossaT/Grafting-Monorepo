import type { ConstructionGridConstraintPoint, ConstructionIrregularQuadGrid } from "@/ports";

const TOOL_DIAGNOSTIC_PREFIX = "[grafting:vtt]";
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

/**
 * Twice the signed area of a ring: positive counter-clockwise.
 *
 * Reported because the generator's ground rule sums the winding of every ring
 * at once, and that only means what it should when the rings agree on which
 * way round they run. They come from two sources with two conventions -- the
 * brush's swept outline through the planar boolean, and the rims of standing
 * ground walked off the graph -- and nothing reconciles them. If two rings
 * that overlap disagree, their windings cancel and the overlap reads as free
 * ground, which is ground planned on top of ground that is still standing.
 *
 * An attempt to force the orientation by nesting depth was reverted: it turned
 * cancelling pairs into summing ones, which subtracts overlaps that were real
 * ground and leaves nodes and edges standing with no face on them. The nesting
 * test is also unreliable exactly where it matters, because a gap's inner rim
 * can share a node with the outer one and the winding at a point lying on a
 * ring is not decided.
 *
 * So the orientations are measured here first, against a real drawing, rather
 * than assumed either way again.
 */
function twiceSignedArea(ring: ConstraintRing): number {
  let twice = 0;
  for (let index = 0; index < ring.points.length; index += 1) {
    const from = ring.points[index]!;
    const to = ring.points[(index + 1) % ring.points.length]!;
    twice += from.x * to.z - to.x * from.z;
  }
  return twice;
}

/** `+`/`-` per ring, in order, so a disagreement is visible at a glance. */
function orientations(rings: readonly ConstraintRing[]): string {
  return rings.map((ring) => (twiceSignedArea(ring) >= 0 ? "+" : "-")).join("") || "·";
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
  /** Splits the runtime was asked for and refused. */
  readonly unadopted: number;
  /** Contour nodes the generator reported as landing on a constraint segment. */
  readonly landings?: number;
  /**
   * Landings that ended as neither a split nor a shared corner.
   *
   * **This is the number that was missing.** `unadopted` only ever counted
   * splits the runtime refused, so a landing thrown away before a split was
   * attempted appeared nowhere -- and the mesh could come back visibly toothed
   * along a seam while the log reported no open junctions at all. Each of
   * these is one tooth: ground meeting its neighbour at a coincident position
   * rather than at a node.
   */
  readonly unstitched?: number;
  /** Of those, the ones whose segment named no edge to split. */
  readonly droppedNoEdge?: number;
  /** Landings exactly on a ring corner: already a shared node, nothing to split. */
  readonly droppedAtCorner?: number;
  /** Landings on a segment of zero length, or on a ring that was not there. */
  readonly droppedDegenerate?: number;
  /** Corners that wanted a node another corner had already taken, with no edge to fall back on. */
  readonly snapsLost?: number;
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
  /**
   * Refused faces whose centre lies inside a hole ring -- ground planned on
   * top of ground that was declared as still standing. Non-zero means the
   * generator's ground rule let it through, and the fault is in what the rings
   * said, not in how the patch was stitched.
   */
  readonly refusedInHole?: number;
  /**
   * Winding of the refused faces against the winding of the ones that landed.
   *
   * Two faces sharing an edge walk it in opposite directions *when they agree
   * on which way round they run*. A face wound against the grain walks it the
   * same way as its neighbour and is refused for exactly the reason the log
   * reports -- while sitting perfectly beside it, overlapping nothing. It
   * leaves no self-clash either, as long as it only ever touches ground that
   * was already standing, which is where every refusal in the log lands.
   *
   * So a split reading here -- refused faces wound one way, built faces the
   * other -- is the whole diagnosis, and it needs the opposite fix from
   * `refusedInHole`.
   */
  readonly refusedClockwise?: number;
  readonly builtClockwise?: number;
  /**
   * Faces the stroke *meant* to clear against the faces it actually cleared.
   *
   * `regenerated` is counted before the deletions run, so the two diverging
   * silently is a fault with no other signature. Ground promised as gone is
   * left out of the hole rings deliberately -- so a face laid over ground the
   * deletion missed is not inside any hole, is not wound the wrong way, and
   * clashes with nothing this side declared. It simply collides, and every
   * other reading says the patch is fine.
   */
  readonly regeneratedCleared?: number;
  readonly regenerateFailures?: readonly string[];
  /**
   * Ground actually laid, against the ground the rings asked for.
   *
   * Every other reading counts something that went wrong. A hole can happen
   * with all of them at zero -- each face laid is fine, there are just not
   * enough of them to fill the area -- and this is the only reading that
   * shows it. Held against the rings' own area rather than reported alone,
   * because the number means nothing without what it was supposed to be.
   */
  readonly coveredArea?: number;
  /** Why generated cells never became faces. See `terrain-fill.ts`'s `QuadDrops`. */
  readonly quadDrops?: {
    readonly avoided: number;
    readonly unnamed: number;
    readonly degenerate: number;
    readonly retained: number;
    readonly coveredByStanding: number;
  };
}

/** Plan-view area of a ring of constraint points, unsigned. */
function ringArea(points: readonly { readonly x: number; readonly z: number }[]): number {
  let twice = 0;
  for (let index = 0; index < points.length; index += 1) {
    const from = points[index]!;
    const to = points[(index + 1) % points.length]!;
    twice += from.x * to.z - to.x * from.z;
  }
  return Math.abs(twice) / 2;
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
    areaPedida: round(
      report.boundary.reduce((sum, ring) => sum + ringArea(ring.points), 0) -
        report.holes.reduce((sum, ring) => sum + ringArea(ring.points), 0),
    ),
    areaCoberta: round(report.coveredArea ?? 0),
    celulasEvitadas: report.quadDrops?.avoided ?? 0,
    celulasSemNo: report.quadDrops?.unnamed ?? 0,
    celulasDegeneradas: report.quadDrops?.degenerate ?? 0,
    celulasSobreChaoRetido: report.quadDrops?.retained ?? 0,
    areaJaDePe: round(report.quadDrops?.coveredByStanding ?? 0),
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
    // Which way each ring runs. Mixed signs among the holes is the condition
    // under which the ground rule cancels and plans over standing ground.
    sentidoBoundary: orientations(report.boundary),
    sentidoHoles: orientations(report.holes),
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
    pousosNoContorno: report.landings ?? 0,
    dentesNaCostura: report.unstitched ?? 0,
    dentesSemAresta: report.droppedNoEdge ?? 0,
    dentesPorCantoTomado: report.snapsLost ?? 0,
    pousosEmCantoJaCompartilhado: report.droppedAtCorner ?? 0,
    pousosDegenerados: report.droppedDegenerate ?? 0,
    nosNovosDeclarados: report.declaredNodes,
    facesRegistradas: report.built,
    facesRegeneradas: report.regenerated ?? 0,
    facesPerdidas: report.refusedFaces,
    colisoesNoProprioPatch: (report.selfClashes ?? []).length,
    perdidasDentroDeFuro: report.refusedInHole ?? 0,
    regeneradasApagadas: report.regeneratedCleared ?? 0,
    regeneracoesFalhas: [...(report.regenerateFailures ?? [])].slice(0, 3),
    perdidasHorarias: report.refusedClockwise ?? 0,
    registradasHorarias: report.builtClockwise ?? 0,
    motivos: [...(report.refusals ?? [])].slice(0, 3),
  };

  // Ground missing from the area asked for, as a fraction of it. A face or so
  // of slack is the boundary being walked as chords; a tenth of the area gone
  // is a hole somebody can see.
  // Ground the fill owed: the rings' area, less the part of it that was
  // already standing. A cell dropped for sitting on a face that stays covers
  // ground nobody is missing.
  const areaDevida = Math.max(0, contorno.areaPedida - contorno.areaJaDePe);
  const faltando = areaDevida > 0 ? (areaDevida - contorno.areaCoberta) / areaDevida : 0;
  const wrong =
    report.refusedFaces > 0 ||
    report.unadopted > 0 ||
    (report.unstitched ?? 0) > 0 ||
    faltando > 0.05 ||
    (report.quadDrops?.unnamed ?? 0) > 0 ||
    (report.quadDrops?.degenerate ?? 0) > 0 ||
    contorno.razaoSegmentoPorFace < 2;
  // In the text of the line, not only in the object beside it. A console
  // collapses the object, and every number that decides anything here was
  // being read by someone who had to expand it first -- which meant the
  // deciding number was, in practice, never read.
  const line =
    `${TERRAIN_PREFIX} ${report.what}: ${geracao.faces} faces de ~${geracao.faceLadoObtido} ` +
    `(pedido ${report.faceSideAsked}), ${mescla.facesPerdidas} perdidas, ` +
    `${mescla.nosNaoCosturados} junções abertas, ${mescla.dentesNaCostura} dentes ` +
    `(${mescla.dentesSemAresta} sem aresta, ${mescla.dentesPorCantoTomado} canto tomado, de ${mescla.pousosNoContorno} pousos), ` +
    `${mescla.facesRegeneradas} regeneradas (${mescla.regeneradasApagadas} apagadas de fato), ` +
    `${mescla.colisoesNoProprioPatch} colisões no próprio patch ` +
    `| perdidas: ${mescla.perdidasDentroDeFuro} dentro de furo, ` +
    `${mescla.perdidasHorarias}/${report.refusedFaces} horárias ` +
    `(registradas ${mescla.registradasHorarias}/${report.built} horárias) ` +
    `| contorno ${contorno.pontos} pts ` +
    `(${contorno.pontosComNo} com nó, min traço ${contorno.minimoDoTraco}, ` +
    `min existente ${contorno.minimoDoQueJaExiste}, razão ${contorno.razaoSegmentoPorFace}) ` +
    `| anéis ${contorno.aneisBoundary}+${contorno.aneisHoles} ` +
    `sentido ${contorno.sentidoBoundary}/${contorno.sentidoHoles} ` +
    `| área ${contorno.areaCoberta} de ${round(areaDevida)} devida ` +
    `(${contorno.areaPedida} pedida, ${contorno.areaJaDePe} já de pé) ` +
    `(${Math.round(faltando * 100)}% sem chão) ` +
    `| células descartadas: ${contorno.celulasEvitadas} evitadas, ` +
    `${contorno.celulasSobreChaoRetido} sobre chão retido, ` +
    `${contorno.celulasSemNo} sem nó, ${contorno.celulasDegeneradas} degeneradas`;
  if (wrong) console.warn(line, { contorno, geracao, mescla });
  else console.info(line, { contorno, geracao, mescla });

  // Every distinct refusal, as its own plain line. A refusal is the engine
  // telling this side that it planned ground where ground already stood, and
  // its wording names the edge that decided it -- which is the whole
  // diagnosis for terrain that will not join.
  for (const clash of (report.selfClashes ?? []).slice(0, 3)) {
    console.warn(`${TERRAIN_PREFIX} ${report.what}: colisão interna -- ${clash}`);
  }
  for (const why of new Set(report.regenerateFailures ?? [])) {
    console.warn(`${TERRAIN_PREFIX} ${report.what}: NAO apagou o que ia regerar -- ${why}`);
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
