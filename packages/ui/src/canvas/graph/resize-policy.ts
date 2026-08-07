/** A rendered size in CSS pixels. */
export interface CanvasSize {
  /** Rendered width. */
  readonly width: number;
  /** Rendered height. */
  readonly height: number;
}

/** Smallest size a node may be dragged down to, before a consumer's own limits. */
const MINIMUM_SIDE = 48;

/**
 * Computes a node's size while its resize handle is being dragged.
 *
 * The shape is preserved: a node keeps the proportions its view was designed
 * for, and the drag only chooses how large it is. Whichever axis the pointer
 * moved further along, relative to that side's length, wins — so dragging
 * mostly sideways feels like it controls width even though both change.
 *
 * The pointer moves in screen pixels while the node is measured in canvas
 * pixels, so the delta is divided by the current scale. Without that, resizing
 * a zoomed-out node would race away from the cursor.
 *
 * @param start - Size when the drag began.
 * @param delta - Pointer movement since then, in screen pixels.
 * @param scale - Current canvas scale, where one is unzoomed.
 * @returns The size to render, never smaller than a usable minimum.
 */
export function resizeFromDrag(
  start: CanvasSize,
  delta: { readonly dx: number; readonly dy: number },
  scale: number,
): CanvasSize {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const width = Math.max(1, start.width);
  const height = Math.max(1, start.height);

  const widthFactor = (width + delta.dx / safeScale) / width;
  const heightFactor = (height + delta.dy / safeScale) / height;
  // The axis the pointer committed to more strongly drives the result; taking
  // the larger factor outright would make an upward drag grow the node.
  const factor = Math.abs(widthFactor - 1) >= Math.abs(heightFactor - 1) ? widthFactor : heightFactor;

  const floor = Math.max(MINIMUM_SIDE / width, MINIMUM_SIDE / height);
  const bounded = Math.max(floor, factor);
  return Object.freeze({
    width: Math.round(width * bounded),
    height: Math.round(height * bounded),
  });
}
