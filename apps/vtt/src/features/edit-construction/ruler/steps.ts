import { DEFAULT_MEASURE_UNIT, MEASURE_UNITS, toMetres, type MeasureUnitId } from "./measure-unit.ts";

/**
 * The easy numbers a length lands on, so nothing is left at 2.99, 2.98 or
 * 2.97. The step is the table's choice -- a fixed one, or `"auto"`, which
 * follows the zoom: the coarsest round number that still stands well apart on
 * the screen. A step is never a grid: it catches within a reach, softer than
 * a join, so what is placed by joining to something keeps its own distances.
 */

export const AUTO_LENGTH_STEP = "auto" as const;

/** What the table asks of its round number: a step in its unit, 0 for none, or `"auto"`. */
export type LengthStepSetting = number | typeof AUTO_LENGTH_STEP;

/** The round numbers a step may be, in the table's unit. */
export const NICE_STEPS: readonly number[] = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];

/** How far apart, on the screen, two neighbouring round numbers are at least, when the step follows the zoom: close enough to be strong, far enough to be told apart. */
export const AUTO_STEP_PIXELS = 30;
/** How near, on the screen, a length must come to a round number to land on it: stronger than any join's reach. */
export const ROUND_REACH_PIXELS = 24;
/** What a round number's reach never exceeds, as a share of the step: a length between two of them stays free. */
export const ROUND_REACH_SHARE = 0.4;

/** The smallest round number, in metres, that stands at least `minPixels` apart on the screen; one unit when the scale is unknown. */
export function niceStep(metersPerPixel: number | undefined, unit: MeasureUnitId | undefined, minPixels: number): number {
  const unitMeters = (MEASURE_UNITS[unit ?? DEFAULT_MEASURE_UNIT] ?? MEASURE_UNITS[DEFAULT_MEASURE_UNIT]).metres;
  if (metersPerPixel === undefined || !(metersPerPixel > 0)) return unitMeters;
  for (const step of NICE_STEPS) if ((step * unitMeters) / metersPerPixel >= minPixels) return step * unitMeters;
  return NICE_STEPS[NICE_STEPS.length - 1]! * unitMeters;
}

/** The step, in metres, `setting` asks for at this zoom; `undefined` when the table chose none. */
export function lengthStepOf(setting: LengthStepSetting, metersPerPixel: number | undefined, unit: MeasureUnitId | undefined): number | undefined {
  if (setting === AUTO_LENGTH_STEP) return niceStep(metersPerPixel, unit, AUTO_STEP_PIXELS);
  return setting > 0 ? toMetres(setting, unit) : undefined;
}

/** How near a round number of `step` a length must come to land on it, given what `reach` metres is on the screen. */
export const roundReach = (step: number, reach: number): number => Math.min(reach, step * ROUND_REACH_SHARE);
