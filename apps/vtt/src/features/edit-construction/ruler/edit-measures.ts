import type { ConstructionPosition } from "@/ports";

import type { PlanVector, RulerMeasure } from "./resolve.ts";

/**
 * What an edit by a handle is measured as. Every handle of every structure
 * says which of these it is -- never a type -- and the ruler writes the
 * numbers: the exact size an edit leaves, not only how much it changed, so
 * what is dragged can be set to a size, not guessed at.
 */
export type EditMeasureKind =
  /** Carried across the ground, and perhaps up: how far, from where it began. */
  | { readonly kind: "move" }
  /** A side pushed out or in along `direction`. */
  | { readonly kind: "side"; readonly direction: PlanVector }
  /** Raised or lowered: how high what is edited stands now. `base` is the height it rises from. */
  | { readonly kind: "height"; readonly base: number }
  /** A slope's rise: how much it climbs more or less. */
  | { readonly kind: "slope" }
  /** A radius pushed out or in along `direction`. */
  | { readonly kind: "radius"; readonly direction: PlanVector }
  /** Turned about its pivot, by `angle` radians. */
  | { readonly kind: "turn"; readonly angle: number };

/** The kinds of measurement, by name: what a handle declares it measures. */
export type EditMeasureName = EditMeasureKind["kind"];

/** The measurement named `name`, with what it needs: the direction a side or a radius is pushed along, the base a height is above, the angle turned. */
export function editMeasureOf(name: EditMeasureName, using: { readonly direction: PlanVector; readonly base: number; readonly angle: number }): EditMeasureKind {
  switch (name) {
    case "move": return { kind: "move" };
    case "side": return { kind: "side", direction: using.direction };
    case "height": return { kind: "height", base: using.base };
    case "slope": return { kind: "slope" };
    case "radius": return { kind: "radius", direction: using.direction };
    case "turn": return { kind: "turn", angle: using.angle };
  }
}

const EPSILON = 1e-4;
const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

/** What to say of an edit that moved a handle from `from` to `at`, as the ruler's measures. */
export function measuresOfEdit(what: EditMeasureKind, from: ConstructionPosition, at: ConstructionPosition): readonly RulerMeasure[] {
  const delta = { x: at.x - from.x, y: at.y - from.y, z: at.z - from.z };
  switch (what.kind) {
    case "move": {
      const measures: RulerMeasure[] = [];
      const meters = Math.hypot(delta.x, delta.z);
      if (meters > EPSILON) measures.push({ kind: "change", name: "desloc.", meters, from, to: at });
      if (Math.abs(delta.y) > EPSILON) measures.push({ kind: "change", name: "Δ altura", meters: delta.y });
      return measures;
    }
    case "side":
      return [{ kind: "change", name: "lado", meters: delta.x * what.direction.x + delta.z * what.direction.z, from, to: at }];
    case "height":
      return [{ kind: "height", meters: at.y - what.base, level: at.y, foot: { x: at.x, y: what.base, z: at.z }, top: at }, { kind: "was", name: "altura", was: from.y - what.base, now: at.y - what.base }, { kind: "change", name: "Δ", meters: delta.y, from, to: at }];
    case "slope":
      return [{ kind: "change", name: "inclinação", meters: delta.y, from, to: at }];
    case "radius":
      return [{ kind: "change", name: "raio", meters: delta.x * what.direction.x + delta.z * what.direction.z, from, to: at }];
    case "turn":
      return [{ kind: "angle", degrees: toDegrees(what.angle), name: "giro" }];
  }
}

/** The lowest height among `heights` -- the base a structure rises from; `fallback` when there are none. */
export function baseHeight(heights: Iterable<number>, fallback: number): number {
  let low = Infinity;
  for (const y of heights) if (y < low) low = y;
  return Number.isFinite(low) ? low : fallback;
}
