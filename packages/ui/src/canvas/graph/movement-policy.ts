/** A point on the canvas surface. */
export interface CanvasPoint {
  /** Horizontal coordinate. */
  readonly x: number;
  /** Vertical coordinate. */
  readonly y: number;
}

/**
 * Decides whether a reported translation is news for the consumer.
 *
 * The renderer reports every translation, including the ones this adapter
 * performs itself while adding or updating a node. Passing those on as user
 * movement closes a loop: the consumer records a move, re-renders, calls
 * `updateNode`, which translates again, which reports again. A programmatic
 * translation always lands exactly on the coordinates the caller supplied, so
 * a position that already matches the caller's own node carries no
 * information and is withheld.
 *
 * A user who drags a node back to the exact coordinates it started from is
 * therefore also not reported, which is correct: nothing moved.
 *
 * @param known - Coordinates the caller last supplied for the node, if it is
 * still rendered.
 * @param reported - Coordinates the renderer just reported.
 * @returns Whether the consumer should be told.
 */
export function isReportableMovement(
  known: CanvasPoint | undefined,
  reported: CanvasPoint,
): boolean {
  if (known === undefined) return false;
  return known.x !== reported.x || known.y !== reported.y;
}
