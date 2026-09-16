import type {
  ConstructionContourAnswer,
  ConstructionContourQuery,
  ConstructionEdgeGeometry,
  ConstructionPosition,
} from "@/ports";

/**
 * Where a boundary edge's curve actually runs -- asked, never recomputed.
 *
 * The engine owns a curve's shape: it is what stores the geometry, validates
 * it, splits it and triangulates the face it bounds. So every question about
 * that shape is asked of the engine, in one batched crossing, and this module
 * is the only place the app phrases one.
 *
 * **Height rides along.** A boundary edge curves in XZ only, so the engine
 * answers in XZ and the height between the two anchors is interpolated here,
 * the way a boundary has always meant it.
 */

/** What answering a curve question needs: the engine's own contour query. */
export interface ContourPort {
  queryContours(queries: readonly ConstructionContourQuery[]): readonly ConstructionContourAnswer[];
}

const xz = (position: ConstructionPosition): readonly [number, number] => [position.x, position.z];

function query(
  geometry: ConstructionEdgeGeometry,
  start: ConstructionPosition,
  end: ConstructionPosition,
  question: ConstructionContourQuery["question"],
): ConstructionContourQuery {
  return { geometry, from: xz(start), to: xz(end), question };
}

function points(answer: ConstructionContourAnswer | undefined): readonly (readonly [number, number])[] {
  return answer?.kind === "points" ? answer.points : [];
}

function scalars(answer: ConstructionContourAnswer | undefined): readonly number[] {
  return answer?.kind === "scalars" ? answer.values : [];
}

/** One edge, as every question about it is asked. */
export interface ContourSpan {
  readonly geometry: ConstructionEdgeGeometry;
  readonly start: ConstructionPosition;
  readonly end: ConstructionPosition;
}

/** Positions at `at`, with the height each parameter carries between the anchors. */
export function evaluateContour(
  port: ContourPort,
  span: ContourSpan,
  at: readonly number[],
): readonly ConstructionPosition[] {
  if (at.length === 0) return [];
  const [answer] = port.queryContours([query(span.geometry, span.start, span.end, { kind: "evaluate", at })]);
  return points(answer).map(([x, z], index) => ({
    x,
    y: span.start.y + (span.end.y - span.start.y) * (at[index] ?? 0),
    z,
  }));
}

/** Each span's own length, in one crossing. */
export function contourLengths(port: ContourPort, spans: readonly ContourSpan[]): readonly number[] {
  if (spans.length === 0) return [];
  return port
    .queryContours(spans.map((span) => query(span.geometry, span.start, span.end, { kind: "length" })))
    .map((answer) => scalars(answer)[0] ?? 0);
}

/** For each span, where `point` sits on it: the parameter and that position. */
export function closestOnContours(
  port: ContourPort,
  spans: readonly ContourSpan[],
  point: ConstructionPosition,
): readonly { readonly t: number; readonly position: readonly [number, number] }[] {
  if (spans.length === 0) return [];
  return port
    .queryContours(spans.map((span) => query(span.geometry, span.start, span.end, { kind: "closestPoint", point: xz(point) })))
    .map((answer) => (answer.kind === "closest" ? { t: answer.t, position: answer.position } : { t: 0, position: [0, 0] as const }));
}

/** The parameters sitting these distances along one span. */
export function parametersAtDistance(
  port: ContourPort,
  span: ContourSpan,
  distance: readonly number[],
): readonly number[] {
  if (distance.length === 0) return [];
  const [answer] = port.queryContours([query(span.geometry, span.start, span.end, { kind: "parameterAtDistance", distance })]);
  return scalars(answer);
}

/** The span's own geometry between two of its parameters, walked forward. */
export function subContour(
  port: ContourPort,
  span: ContourSpan,
  t0: number,
  t1: number,
): ConstructionEdgeGeometry {
  const [answer] = port.queryContours([query(span.geometry, span.start, span.end, { kind: "subGeometry", t0, t1 })]);
  return answer?.kind === "geometry" ? answer.geometry : span.geometry;
}

/** The signed angle an arc turns through, positive counter-clockwise; zero for anything else. */
export function arcSweepOf(port: ContourPort, span: ContourSpan): number {
  return arcSweepsOf(port, [span])[0] ?? 0;
}

/** Each span's own sweep, in one crossing. */
export function arcSweepsOf(port: ContourPort, spans: readonly ContourSpan[]): readonly number[] {
  if (spans.length === 0) return [];
  return port
    .queryContours(spans.map((span) => query(span.geometry, span.start, span.end, { kind: "arcSweep" })))
    .map((answer) => scalars(answer)[0] ?? 0);
}
