import type { CanvasPortDefinition } from "./contracts.js";

/** Smallest comfortable pointer target for a port, in CSS pixels. */
const MINIMUM_HIT_SIZE = 18;

/** How a rendered port responds to the pointer. */
export interface CanvasSocketPointerPolicy {
  /** Whether the port accepts pointer input at all. */
  readonly interactive: boolean;
  /** Width and height of the port's pointer target, in CSS pixels. */
  readonly hitSize: number;
}

/**
 * Decides whether a port can be grabbed, and how large its target is.
 *
 * A port only accepts pointer input when it declares itself a magnet, which is
 * exactly what that flag means in {@link CanvasPortDefinition}: it may take
 * part in user-drawn connections. A decorative port on a read-only canvas
 * stays transparent to the pointer so it cannot intercept clicks meant for the
 * node beneath it.
 *
 * The target is always at least {@link MINIMUM_HIT_SIZE} across, independently
 * of how large the port is drawn. A port rendered as a five-pixel dot is a
 * ten-pixel target, which is too small to grab reliably — especially on a
 * surface that also pans and zooms under the same pointer.
 *
 * @param definition - Port as its consumer declared it.
 * @returns Whether the port is grabbable, and its pointer target size.
 */
export function resolveCanvasSocketPointerPolicy(
  definition: CanvasPortDefinition,
): CanvasSocketPointerPolicy {
  const diameter = (definition.presentation?.radius ?? 4) * 2;
  return Object.freeze({
    interactive: definition.magnet === true,
    hitSize: Math.max(diameter, MINIMUM_HIT_SIZE),
  });
}
