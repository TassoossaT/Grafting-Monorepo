import type { BezierPort, ConstructionPosition, CubicBezier, CurveHandles, CurvePoint, CurveResult } from "@/ports";

/**
 * The one place the app speaks to the Rust bezier engine in geometric terms:
 * fitting curves through anchors, resolving stored handles, sampling a ribbon
 * either side of a curve, and unioning ribbons in plan.
 *
 * Product-free on purpose. A road network and a sloped platform are both
 * callers deciding *which* curves and *how wide*; neither owns the curve
 * operations, and neither re-derives them. Every call here is batched --
 * one engine crossing per request, however many curves it carries.
 */

export const curvePoint = (p: ConstructionPosition): CurvePoint => [p.x, p.y, p.z];
export const curvePosition = (p: CurvePoint): ConstructionPosition => ({ x: p[0], y: p[1], z: p[2] });

/** The smooth curve through `points`, one cubic per consecutive pair. */
export function automaticCurve(port: Pick<BezierPort, "curveBatch">, points: readonly ConstructionPosition[], tolerance: number): CurveResult {
  return port.curveBatch({ tolerance, commands: [{ kind: "automatic", points: points.map(curvePoint) }] })[0]!;
}

/** Explicit cubics for stored handles between their two anchors. */
export function resolveCurves(
  port: Pick<BezierPort, "curveBatch">,
  spans: readonly { readonly handles: CurveHandles; readonly start: ConstructionPosition; readonly end: ConstructionPosition }[],
  tolerance: number,
): readonly CurveResult[] {
  if (spans.length === 0) return [];
  return port.curveBatch({ tolerance, commands: spans.map((span) => ({
    kind: "resolve" as const, handles: span.handles, start: curvePoint(span.start), end: curvePoint(span.end),
  })) });
}

export interface RibbonRequest {
  readonly curve: CubicBezier;
  /** Lateral offsets `[min, max]` at the curve start. */
  readonly offsets: readonly [number, number];
  /** Offsets at the curve end, when the ribbon tapers. */
  readonly endOffsets?: readonly [number, number];
  /** Take the cross-sections at these curve parameters instead of adaptive samples. */
  readonly parameters?: readonly number[];
}

/**
 * Each curve's ribbon outline: the `min` side walked forward, then the `max`
 * side walked back. Every sample keeps its curve height; the cross-section
 * is always horizontal.
 */
export function sampleRibbons(port: Pick<BezierPort, "curveBatch">, requests: readonly RibbonRequest[], tolerance: number): readonly (readonly ConstructionPosition[])[] {
  if (requests.length === 0) return [];
  return port.curveBatch({ tolerance, commands: requests.map((request) => ({
    kind: "ribbon" as const, curve: request.curve, offsets: request.offsets, endOffsets: request.endOffsets, parameters: request.parameters,
  })) }).map((result) => (result.ribbon?.outer ?? []).map(curvePosition));
}

/** A ribbon outline split back into its paired cross-sections, start to end. */
export function ribbonSections(outline: readonly ConstructionPosition[]): readonly { readonly min: ConstructionPosition; readonly max: ConstructionPosition }[] {
  const count = outline.length / 2;
  return Array.from({ length: count }, (_, i) => ({ min: outline[i]!, max: outline[outline.length - 1 - i]! }));
}

/** The plan-view union of ribbon outlines, as `[x, z]` shapes of rings. */
export function unionRibbonOutlines(port: Pick<BezierPort, "planarBoolean">, outlines: readonly (readonly ConstructionPosition[])[]): [number, number][][][] {
  return port.planarBoolean({ operation: "union", subject: outlines.map((outline) => [outline.map((p) => [p.x, p.z] as const)]), clip: [] })
    .map((shape) => shape.map((ring) => ring.map((p) => [p[0], p[1]] as [number, number])));
}
