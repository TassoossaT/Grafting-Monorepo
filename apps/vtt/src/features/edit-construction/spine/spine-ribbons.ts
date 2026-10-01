import type { BezierPort, ConstructionPosition, CurveHandles, CurveResult } from "@/ports";

import { resolveCurves, sampleRibbons } from "../topology/bezier-curve.ts";

/**
 * The one ribbon generator every spine-built type shares: a span's stored
 * handles resolved into its cubic, and that cubic swept sideways by the
 * span's own profile into a ribbon outline.
 *
 * Owners differ only in what they make of the ribbons -- a road unions them
 * in plan into contour faces, a sloped platform keeps one face per span --
 * never in how a ribbon is obtained. Both engine crossings are batched over
 * every span at once.
 */

/** One span to sweep: its handles between its two anchors. */
export interface SpineRibbonSpan {
  readonly handles: CurveHandles;
  readonly start: ConstructionPosition;
  readonly end: ConstructionPosition;
}

/** One swept span: the resolved curve and its outline, `min` side forward then `max` side back. */
export interface SpineRibbon {
  readonly resolved: CurveResult;
  readonly outline: readonly ConstructionPosition[];
}

// Derived samples belong to this port's lifetime, never to confirmed graph
// state. Exact authoring/profile inputs name a reusable segment; a change to
// either anchor, handles, profile or resolution asks Rust to sweep it again.
const derivedSegments = new WeakMap<object, Map<string, SpineRibbon>>();
const MAX_DERIVED_SEGMENTS = 256;

/**
 * The lateral extent `[min, max]` a span's profile reaches at its start and
 * its end, falling back to `defaults` where the span authored none.
 */
export function spanOffsets(
  handles: Pick<CurveHandles, "bandOffsets" | "endBandOffsets"> | undefined,
  defaults: readonly number[],
): { readonly offsets: readonly [number, number]; readonly endOffsets: readonly [number, number] } {
  const profile = handles?.bandOffsets.length ? handles.bandOffsets : defaults;
  const end = handles?.endBandOffsets?.length ? handles.endBandOffsets : profile;
  return { offsets: [Math.min(...profile), Math.max(...profile)], endOffsets: [Math.min(...end), Math.max(...end)] };
}

/**
 * Every span resolved and swept into its ribbon.
 *
 * @param parametersFor where to take each span's cross-sections, given its
 * resolved curve; `undefined` lets the engine sample adaptively.
 */
export function spineRibbons(
  port: Pick<BezierPort, "curveBatch">,
  spans: readonly SpineRibbonSpan[],
  defaults: readonly number[],
  tolerance: number,
  parametersFor?: (resolved: CurveResult, index: number) => readonly number[] | undefined,
): readonly SpineRibbon[] {
  const cache = derivedSegments.get(port) ?? new Map<string, SpineRibbon>();
  derivedSegments.set(port, cache);
  const keys = spans.map((span) => JSON.stringify([span, defaults, tolerance]));
  // Custom station policies can depend on consumer state. Their output is not
  // inferred from authoring inputs and therefore is evaluated on every call.
  const missing = spans.map((span, i) => ({ span, i }))
    .filter(({ i }) => parametersFor !== undefined || !cache.has(keys[i]!));
  const resolved = resolveCurves(port, missing.map(({ span }) => span), tolerance);
  const outlines = sampleRibbons(port, missing.map(({ span, i }, j) => ({
    curve: resolved[j]!.curves[0]!,
    ...spanOffsets(span.handles, defaults),
    parameters: parametersFor?.(resolved[j]!, i),
  })), tolerance);
  const generated = new Map(missing.map(({ i }, j) => [i, { resolved: resolved[j]!, outline: outlines[j]! }]));
  const result = spans.map((_, i) => generated.get(i) ?? cache.get(keys[i]!)!);
  if (parametersFor === undefined) {
    result.forEach((segment, i) => {
      cache.delete(keys[i]!);
      cache.set(keys[i]!, segment);
    });
    while (cache.size > MAX_DERIVED_SEGMENTS) cache.delete(cache.keys().next().value!);
  }
  return result;
}
