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
  const resolved = resolveCurves(port, spans, tolerance);
  const outlines = sampleRibbons(port, spans.map((span, i) => ({
    curve: resolved[i]!.curves[0]!,
    ...spanOffsets(span.handles, defaults),
    parameters: parametersFor?.(resolved[i]!, i),
  })), tolerance);
  return spans.map((_, i) => ({ resolved: resolved[i]!, outline: outlines[i]! }));
}
