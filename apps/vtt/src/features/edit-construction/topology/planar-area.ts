import type { ConstructionPlanarRequest, ConstructionPlanarShape } from "@/ports";

/**
 * Plan-view areas in this app's own terms, and the one module that runs a
 * boolean on them.
 *
 * The engine owns the boolean, as it owns every other heavy geometric
 * calculation (`graph-core`'s `planar_boolean`). This module is the seam: it
 * speaks `PlanarArea` to the app, closes and opens rings across the
 * boundary, and is the only place a second implementation could ever be
 * swapped back in (`test/third-party-seams.test.mjs`).
 *
 * **Rings.** The app carries closed rings, first point repeated last, which
 * is what a ring walked as a polygon means here. The engine takes and
 * returns open rings, so the conversion happens here and nowhere else.
 */

/** One `[x, z]` point. */
export type PlanarPoint = readonly [number, number];
/** A ring of points; a closed ring repeats its first point last. */
export type PlanarRing = readonly PlanarPoint[];
/** One polygon: its outer ring first, then any holes. */
export type PlanarPolygon = ConstructionPlanarShape;
/** Any number of disjoint polygons. */
export type PlanarArea = readonly PlanarPolygon[];

/** What a boolean needs: the engine's planar operation. */
export interface PlanarPort {
  planarBoolean(request: ConstructionPlanarRequest): readonly ConstructionPlanarShape[];
}

function isClosed(ring: PlanarRing): boolean {
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first !== undefined && last !== undefined && first[0] === last[0] && first[1] === last[1];
}

/** The same ring as the engine wants it: no repeated closing point. */
function opened(ring: PlanarRing): PlanarRing {
  return isClosed(ring) && ring.length > 1 ? ring.slice(0, -1) : ring;
}

/** The same ring as the app carries it: closed by repeating its first point. */
function closed(ring: PlanarRing): PlanarRing {
  const first = ring[0];
  if (first === undefined || isClosed(ring)) return ring;
  return [...ring, first];
}

const toEngine = (areas: readonly (PlanarPolygon | PlanarArea)[]): ConstructionPlanarShape[] =>
  areas.flatMap((area) => (isArea(area) ? area : [area]))
    .map((polygon) => polygon.map(opened).filter((ring) => ring.length >= 3))
    .filter((polygon) => polygon.length > 0);

const fromEngine = (shapes: readonly ConstructionPlanarShape[]): PlanarArea =>
  shapes.map((shape) => shape.map(closed));

/** A polygon is rings of points; an area is polygons. The first ring's first entry tells them apart. */
function isArea(value: PlanarPolygon | PlanarArea): value is PlanarArea {
  const first = value[0];
  if (first === undefined) return false;
  const inner = (first as PlanarRing | PlanarPolygon)[0];
  return Array.isArray(inner) && Array.isArray((inner as unknown as PlanarRing)[0]);
}

/** The union of every polygon or area given. */
export function planarUnion(
  port: PlanarPort,
  first: PlanarPolygon | PlanarArea,
  ...rest: readonly (PlanarPolygon | PlanarArea)[]
): PlanarArea {
  const subject = toEngine([first]);
  const clip = toEngine(rest);
  if (subject.length === 0) return fromEngine(clip);
  return fromEngine(port.planarBoolean({ operation: "union", subject, clip }));
}

/** `subject` with every clip taken out of it. */
export function planarDifference(
  port: PlanarPort,
  subject: PlanarPolygon | PlanarArea,
  ...clips: readonly (PlanarPolygon | PlanarArea)[]
): PlanarArea {
  const subjectShapes = toEngine([subject]);
  const clip = toEngine(clips);
  if (subjectShapes.length === 0) return [];
  if (clip.length === 0) return fromEngine(subjectShapes);
  return fromEngine(port.planarBoolean({ operation: "difference", subject: subjectShapes, clip }));
}
