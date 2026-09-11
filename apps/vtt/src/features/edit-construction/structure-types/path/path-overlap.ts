import type { ConstructionPosition, ConstructionRegionTopology } from "@/ports";

/**
 * How far a new run may travel inside standing path before it stops being a
 * crossing and starts being a duplicate, measured in the run's own widths.
 *
 * **Why a length and not a fraction.** A fraction of the stroke punishes
 * short strokes for nothing: a four-metre road crossed squarely by a
 * six-metre one spends two thirds of the shorter run inside the longer, and
 * that is an ordinary junction. What actually separates the two cases is how
 * far the new spine runs *within* the old surface, and that has a scale of
 * its own -- a square crossing spends about one width inside, and the more
 * the two runs line up the further it goes: at thirty degrees it is two
 * widths, at twenty about three. Past that the runs are no longer crossing,
 * they are sharing a route.
 */
const OVERLAP_WIDTHS_ALLOWED = 3;

/**
 * How much of `spine` runs inside standing path surface, in world units.
 *
 * Measured on the centre line rather than by intersecting footprints,
 * because the centre line is what distinguishes the two cases. Two roads
 * crossing overlap in area exactly as much as two roads sharing a route do
 * for a short enough stroke; only the spine says whether the new run passed
 * *through* the old one or went *along* it.
 */
export function lengthInsideStandingPath(
  spine: readonly ConstructionPosition[],
  topologies: readonly ConstructionRegionTopology[],
): number {
  const faces = topologies
    .filter((topology) => topology.surfaceType === "path")
    .map(ringsOf)
    .filter((face): face is Face => face !== undefined);
  if (faces.length === 0) return 0;

  let inside = 0;
  for (let index = 0; index + 1 < spine.length; index += 1) {
    const from = spine[index]!;
    const to = spine[index + 1]!;
    // The midpoint stands for the step. A step is a curve sample, far
    // shorter than a road is wide, so nothing of interest happens between
    // its ends that its middle does not report.
    const midX = (from.x + to.x) / 2;
    const midZ = (from.z + to.z) / 2;
    if (faces.some((face) => covers(face, midX, midZ))) {
      inside += Math.hypot(to.x - from.x, to.z - from.z);
    }
  }
  return inside;
}

/**
 * Why this stroke may not be committed over what is already there, or
 * `undefined` when it may.
 *
 * A crossing is not refused: two runs meeting is a junction, and the whole
 * contour engine is built to fuse them. What is refused is a run laid
 * *along* one already standing, which builds a second road in the same place
 * as the first and leaves the pair stacked.
 */
export function overlapRefusal(
  spine: readonly ConstructionPosition[],
  topologies: readonly ConstructionRegionTopology[],
  width: number,
): string | undefined {
  if (spine.length < 2 || width <= 0) return undefined;
  const inside = lengthInsideStandingPath(spine, topologies);
  if (inside <= width * OVERLAP_WIDTHS_ALLOWED) return undefined;
  return "Esta via corre por cima de outra já existente; atravesse-a para criar um cruzamento, ou desenhe ao lado.";
}

interface Face {
  readonly outer: readonly (readonly [number, number])[];
  readonly holes: readonly (readonly (readonly [number, number])[])[];
}

function ringsOf(topology: ConstructionRegionTopology): Face | undefined {
  const positions = new Map(topology.nodes.map((node) => [node.id, node.position]));
  const ringFor = (
    loop: readonly { readonly startNodeId: string; readonly endNodeId: string; readonly reversed: boolean }[],
  ): readonly (readonly [number, number])[] | undefined => {
    if (loop.length < 3) return undefined;
    const ring: [number, number][] = [];
    for (const use of loop) {
      const at = positions.get(use.reversed ? use.endNodeId : use.startNodeId);
      if (at === undefined) return undefined;
      ring.push([at.x, at.z]);
    }
    return ring;
  };
  const outer = topology.outerLoops[0] === undefined ? undefined : ringFor(topology.outerLoops[0]);
  if (outer === undefined) return undefined;
  return {
    outer,
    holes: topology.holes
      .map(ringFor)
      .filter((ring): ring is readonly (readonly [number, number])[] => ring !== undefined),
  };
}

/** Inside the face proper: within its outer ring and outside every hole of it. */
function covers(face: Face, x: number, z: number): boolean {
  if (!inRing(face.outer, x, z)) return false;
  return !face.holes.some((hole) => inRing(hole, x, z));
}

function inRing(ring: readonly (readonly [number, number])[], x: number, z: number): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [currentX, currentZ] = ring[index]!;
    const [previousX, previousZ] = ring[previous]!;
    if (currentZ > z === previousZ > z) continue;
    if (x < ((previousX - currentX) * (z - currentZ)) / (previousZ - currentZ) + currentX) {
      inside = !inside;
    }
  }
  return inside;
}
