import type { BezierPort, ConstructionPosition, CurvePoint } from "@/ports";
import type { PreviewDescriptor } from "@/features/edit-construction";

import { brushSweptRegionFill } from "../tools/shapes/preview-shapes.ts";

/**
 * The ghost for a road stroke: the run as it will be built, not the disc the
 * hand swept.
 *
 * **What this replaces.** A road brush is drawn like an area brush -- press,
 * drag a circle -- but a road is not an area. It is a centre line with a
 * cross-section the subtype fixes, and the brush's own radius has nothing to
 * do with how wide it comes out. Showing the swept disc therefore previewed
 * a shape the tool never builds: the user aimed at a fat smear of hand
 * tremor and received a fitted curve at the road's own width, and the two
 * could differ by a long way on a shaky stroke. That mismatch is most of why
 * the tool reads as "built from an area instead of from the spine".
 *
 * So the ghost is built the way the commit is: the same fit the commit runs,
 * swept at the road's own half-width. What you aim at is what you get, and
 * the brush radius goes back to meaning only what it should -- how literally
 * to take the hand.
 *
 * Returns `undefined` for a stroke the fit cannot take yet (a tap, or one
 * that has not travelled), leaving the generic swept ghost to stand in until
 * there is a curve to show.
 */
export function pathStrokePreview(
  port: BezierPort,
  samples: readonly ConstructionPosition[],
  tolerance: number,
  halfWidth: number,
  color: number,
): PreviewDescriptor | undefined {
  if (samples.length < 2) return undefined;
  const points: CurvePoint[] = samples.map((sample) => [sample.x, sample.y, sample.z]);
  let polyline: ConstructionPosition[];
  try {
    // The same fit the commit runs, at the same accuracy, so the ghost cannot
    // drift from the product by construction rather than by anyone
    // remembering to keep two numbers in step.
    const [fitted] = port.curveBatch({
      tolerance: Math.max(tolerance, 0.025),
      commands: [{ kind: "fit", points }],
    });
    if (fitted === undefined) return undefined;
    polyline = fitted.samples.flatMap((span, index) =>
      (index === 0 ? span : span.slice(1)).map((sample) => ({
        x: sample.position[0],
        y: sample.position[1],
        z: sample.position[2],
      })),
    );
  } catch {
    // A stroke the fit refuses mid-drag is a transient state, not an error to
    // surface: fall back to the generic ghost rather than blanking the
    // preview or throwing out of a pointer handler.
    return undefined;
  }
  if (polyline.length < 2) return undefined;
  return brushSweptRegionFill(polyline, { kind: "circle", radius: halfWidth }, color);
}
