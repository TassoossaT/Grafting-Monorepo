/** A point in viewport coordinates. */
export interface MagneticPoint {
  /** Horizontal coordinate. */
  readonly x: number;
  /** Vertical coordinate. */
  readonly y: number;
}

/** A port a dropped connection could snap to. */
export interface MagneticCandidate {
  /** Node the port belongs to. */
  readonly nodeId: string;
  /** Renderer-owned key of the port's socket. */
  readonly key: string;
  /** Which side of the node the port is on. */
  readonly side: "input" | "output";
  /** Centre of the port in viewport coordinates. */
  readonly center: MagneticPoint;
}

/**
 * Picks the port a connection should snap to when it is released.
 *
 * Enlarging the drop area is what makes connecting bearable when a port is
 * small or the surface is zoomed out: the user aims at a region rather than at
 * a dot. Only candidates the caller has already accepted are considered, so
 * "nearest" can never mean "nearest invalid" — a connection still lands only
 * where it was allowed to.
 *
 * Distance is measured squared to avoid a square root per candidate, and ties
 * resolve to the first candidate given, which keeps the result stable for the
 * same input rather than depending on iteration accidents.
 *
 * @param pointer - Where the connection was released.
 * @param candidates - Ports that would accept this connection, already filtered.
 * @param radius - Largest distance in CSS pixels that still snaps.
 * @returns The port to connect to, or `null` when none is close enough.
 */
export function findMagneticTarget(
  pointer: MagneticPoint,
  candidates: readonly MagneticCandidate[],
  radius: number,
): MagneticCandidate | null {
  if (radius <= 0) return null;
  const limit = radius * radius;
  let best: MagneticCandidate | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const dx = candidate.center.x - pointer.x;
    const dy = candidate.center.y - pointer.y;
    const distance = dx * dx + dy * dy;
    if (distance > limit || distance >= bestDistance) continue;
    best = candidate;
    bestDistance = distance;
  }

  return best;
}
