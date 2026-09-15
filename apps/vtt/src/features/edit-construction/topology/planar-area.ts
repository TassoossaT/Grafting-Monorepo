import polygonClipping from "polygon-clipping";
import type { Geom, MultiPolygon } from "polygon-clipping";

import type { ConstructionPlanarShape } from "@/ports";

/**
 * Plan-view areas in this app's own terms, and the one module that talks to
 * the polygon boolean library behind them.
 *
 * Every other module speaks `PlanarArea` and calls the functions here; none
 * imports the library or its types, so replacing it -- with the engine's own
 * `planarBoolean`, say -- is a change to this file alone
 * (`test/third-party-seams.test.mjs` holds that).
 */

/** One `[x, z]` point. */
export type PlanarPoint = readonly [number, number];
/** A ring of points; a closed ring repeats its first point last. */
export type PlanarRing = readonly PlanarPoint[];
/** One polygon: its outer ring first, then any holes. Same shape as the engine's planar shape. */
export type PlanarPolygon = ConstructionPlanarShape;
/** Any number of disjoint polygons. */
export type PlanarArea = readonly PlanarPolygon[];

const asGeom = (value: PlanarPolygon | PlanarArea): Geom => value as unknown as Geom;
const fromLibrary = (value: MultiPolygon): PlanarArea => value;

/** The union of every polygon or area given. Throws where the library cannot resolve the input. */
export function planarUnion(first: PlanarPolygon | PlanarArea, ...rest: readonly (PlanarPolygon | PlanarArea)[]): PlanarArea {
  return fromLibrary(polygonClipping.union(asGeom(first), ...rest.map(asGeom)));
}

/** `subject` with every clip taken out of it. Throws where the library cannot resolve the input. */
export function planarDifference(subject: PlanarPolygon | PlanarArea, ...clips: readonly (PlanarPolygon | PlanarArea)[]): PlanarArea {
  return fromLibrary(polygonClipping.difference(asGeom(subject), ...clips.map(asGeom)));
}
