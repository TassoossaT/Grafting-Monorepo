import type { BrushShape, PreviewDescriptor, ToolParamsFor } from "@/features/edit-construction";

// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time. A
// type-only `@/` import is fine -- those are erased.
import { resolveBrushShape } from "../../../../features/edit-construction/index.ts";
import type { ConstructionPosition } from "@/ports";

import type { ConstructionTool, PointerSample, ToolContext, ToolGesture } from "./tool-context.ts";
import type { BrushOutlineShape } from "../shapes/preview-shapes.ts";
import { brushSweptRegionFill } from "../shapes/preview-shapes.ts";

/**
 * The one geometric fact a brush produces: its shape plus every sample the
 * gesture has swept through, start to end. No fitting, no element selection,
 * no domain effect -- what the sweep means is entirely up to
 * {@link BrushToolSpec.applyRegion}.
 */
export interface BrushRegion {
  readonly samples: readonly ConstructionPosition[];
  /** Raw construction hits seen during the sweep; the domain assigns meaning. */
  readonly observations: readonly PointerSample[];
  /**
   * The brush footprint, already widened to hold the product -- see
   * {@link expandedToHold}. This is what the ghost is drawn from, which is
   * what makes the ghost an honest envelope rather than a decoration.
   */
  readonly shape: BrushShape;
  /**
   * How far the committed product may be moved off the drawn stroke to
   * straighten it: the brush's own reach, as the user set it.
   *
   * **Not the reach left over after the product takes its share.** That older
   * reading made the brush do two jobs at once, and they pulled against each
   * other: a road two metres wide drawn with a two-metre brush had nothing
   * left and came out following every tremor, so asking for a smoother road
   * meant drawing with a brush far wider than the road for reasons no one
   * could see on screen. The envelope job is gone -- a brush that previews
   * its real product (see {@link BrushToolSpec.previewContour}) shows the
   * truth without having to contain it -- which leaves reach with the single
   * meaning it has for every brush: how literally to take the hand. At zero
   * the stroke is committed as drawn.
   */
  readonly tolerance: number;
}

function outlineShapeFor(shape: BrushShape): BrushOutlineShape {
  if (shape.kind === "circle") return { kind: "circle", radius: shape.radius };
  if (shape.kind === "square") return { kind: "square", radius: shape.size / 2, rotationRadians: shape.rotationRadians };
  return { kind: "hexagon", radius: shape.radius, rotationRadians: shape.rotationRadians };
}

/** Tool ids whose parameters carry a brush shape (radius/rotation/footprint) -- the only ids {@link createBrushTool} can wire up. */
export type BrushableToolId = "path-brush" | "wall-brush";

/**
 * How far a brush shape reaches from its own center. What that reach *means*
 * is the calling tool's business -- a footprint to carve for one, a fitting
 * tolerance for another -- but the number itself is a property of the shape,
 * so it is derived once here rather than per tool.
 */
export function brushReach(shape: BrushShape): number {
  if (shape.kind === "square") return shape.size / 2;
  return shape.radius;
}

/**
 * The same shape, grown just enough that its reach holds a product of
 * `halfWidth`.
 *
 * The brush is an envelope: whatever it paints has to fit inside the ghost
 * the user was shown. So a product wider than the brush does not spill past
 * it -- it pushes the brush open. Asking for a wider road is therefore also
 * asking for a wider brush, and the ghost keeps telling the truth without
 * the tool having to clamp, refuse, or silently narrow what was asked for.
 */
function expandedToHold(shape: BrushShape, halfWidth: number): BrushShape {
  if (brushReach(shape) >= halfWidth) return shape;
  if (shape.kind === "square") return { ...shape, size: halfWidth * 2 };
  return { ...shape, radius: halfWidth };
}

export interface BrushToolSpec<Id extends BrushableToolId> {
  readonly id: Id;
  defaultParams(): ToolParamsFor<Id>;
  previewColor(params: ToolParamsFor<Id>): number;
  /**
   * How far this brush's own product reaches from the stroke it is drawn
   * along -- half a road's full width, shoulders included; zero for a
   * product with no width of its own.
   *
   * Used to keep the brush shape at least as wide as what it builds, so the
   * fallback ghost and the junction snap reach are never narrower than the
   * product. It no longer rations the straightening budget: see
   * {@link BrushRegion.tolerance} for why those two jobs were separated.
   */
  halfWidth(params: ToolParamsFor<Id>): number;
  /**
   * The only place domain semantics live: what the swept region means, and
   * which backend call applies it. Called exactly once, on pointer release,
   * with the whole gesture's region -- never incrementally, never per-cell,
   * never per-segment. Recomputing over the full region on every commit is
   * fine; the brush never tracks what was already applied.
   */
  applyRegion(region: BrushRegion, ctx: ToolContext, params: ToolParamsFor<Id>): void;
  /**
   * An honest preview of what `applyRegion` will actually produce -- the
   * corrected/welded result, not the raw swept envelope. Optional: a brush
   * whose product has no such correction (nothing to fit, nothing to weld)
   * is well represented by the default sweep fill and needs no override.
   * Generic here, not a wall special case, so any brush gets the same real
   * preview by supplying one.
   */
  previewContour?(region: BrushRegion, ctx: ToolContext, params: ToolParamsFor<Id>): PreviewDescriptor | undefined;
}

/**
 * Wires a {@link BrushToolSpec} into a `ConstructionTool`. Shape/size/rotation
 * resolution, pointer batching (the dispatcher's own `gesture.samples`), the
 * generic filled-region preview, and the commit-once-per-gesture contract
 * all live here, once -- every brush shares this instead of reimplementing
 * it, including the preview: what a brush stroke will do depends on what's
 * underneath it, but that's `applyRegion`'s job to sort out at commit time
 * (the same way terrain generation already varies its own outcome by
 * region), not a reason for the preview itself to special-case one tool.
 * Only `applyRegion` differs between brushes; the brush -- preview included
 * -- is the same for all of them.
 */
export function createBrushTool<Id extends BrushableToolId>(spec: BrushToolSpec<Id>): ConstructionTool<Id> {
  const regionFor = (gesture: ToolGesture, params: ToolParamsFor<Id>): BrushRegion => {
    const drawn = resolveBrushShape(params);
    return {
      samples: gesture.samples.map((sample) => sample.point),
      observations: [gesture.start, ...gesture.samples, gesture.current],
      shape: expandedToHold(drawn, spec.halfWidth(params)),
      // The reach the user actually set, not what the expansion grew it to:
      // a product wider than the brush must not silently buy itself a
      // straightening budget the hand never asked for.
      tolerance: Math.max(0, brushReach(drawn)),
    };
  };

  return {
    id: spec.id,
    defaultParams: spec.defaultParams,

    previewFor(gesture: ToolGesture, params: ToolParamsFor<Id>, ctx: ToolContext): PreviewDescriptor | undefined {
      const region = regionFor(gesture, params);
      return (
        spec.previewContour?.(region, ctx, params) ??
        brushSweptRegionFill(region.samples, outlineShapeFor(region.shape), spec.previewColor(params))
      );
    },

    // Presence of this hook makes the generic dispatcher capture and sample the drag; the region is only ever read on release.
    onPointerMove(): void {},

    onPointerUp(ctx: ToolContext, gesture: ToolGesture, params: ToolParamsFor<Id>): void {
      spec.applyRegion(regionFor(gesture, params), ctx, params);
    },
  };
}
