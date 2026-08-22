import { resolveBrushShape } from "@/features/edit-construction";
import type { BrushShape, PreviewDescriptor, ToolParamsFor } from "@/features/edit-construction";
import type { ConstructionPosition } from "@/ports";

import type { ConstructionTool, ToolContext, ToolGesture } from "./tool-context.ts";
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
  readonly shape: BrushShape;
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

export interface BrushToolSpec<Id extends BrushableToolId> {
  readonly id: Id;
  defaultParams(): ToolParamsFor<Id>;
  previewColor(params: ToolParamsFor<Id>): number;
  /**
   * The only place domain semantics live: what the swept region means, and
   * which backend call applies it. Called exactly once, on pointer release,
   * with the whole gesture's region -- never incrementally, never per-cell,
   * never per-segment. Recomputing over the full region on every commit is
   * fine; the brush never tracks what was already applied.
   */
  applyRegion(region: BrushRegion, ctx: ToolContext, params: ToolParamsFor<Id>): void;
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
  const regionFor = (gesture: ToolGesture, params: ToolParamsFor<Id>): BrushRegion => ({
    samples: gesture.samples.map((sample) => sample.point),
    shape: resolveBrushShape(params),
  });

  return {
    id: spec.id,
    defaultParams: spec.defaultParams,

    previewFor(gesture: ToolGesture, params: ToolParamsFor<Id>): PreviewDescriptor | undefined {
      const region = regionFor(gesture, params);
      return brushSweptRegionFill(region.samples, outlineShapeFor(region.shape), spec.previewColor(params));
    },

    // Presence of this hook makes the generic dispatcher capture and sample the drag; the region is only ever read on release.
    onPointerMove(): void {},

    onPointerUp(ctx: ToolContext, gesture: ToolGesture, params: ToolParamsFor<Id>): void {
      spec.applyRegion(regionFor(gesture, params), ctx, params);
    },
  };
}
