import { RULER_KINDS, type RulerKind } from "./resolve.ts";
import { AUTO_LENGTH_STEP, type LengthStepSetting } from "./steps.ts";

/**
 * What a table asks of its ruler: which ways of catching are on, how coarse
 * the angles it offers are, and the round number lengths are made to land on.
 * The table's own choice, so one value read by every tool and every readout.
 */
export interface RulerSettings {
  /** Ways of catching left out. */
  readonly disabled: ReadonlySet<RulerKind>;
  /** The angular step of the protractor, in degrees: a direction lands on a multiple of it. */
  readonly angleStep: number;
  /** The round number a length lands on: a step in the table's unit (1 means whole units), 0 to leave lengths as they are, or "auto", which follows the zoom. */
  readonly lengthStep: LengthStepSetting;
  /** Whether the numbers are written on the map -- at the teeth, along the lines, round the protractor -- besides the one at the pointer. */
  readonly numbers: boolean;
}

/** The angular steps the table can choose, in degrees. */
export const ANGLE_STEPS: readonly number[] = [5, 10, 15, 30, 45, 90];
/** The round numbers the table can choose, in its unit; 0 is none. */
export const LENGTH_STEPS: readonly number[] = [0, 0.1, 0.25, 0.5, 1, 2, 5, 10];
/** The finer angular step held with Shift, in degrees: the protractor's own graduation. */
export const FINE_ANGLE_STEP = 5;

export const DEFAULT_RULER_SETTINGS: RulerSettings = { disabled: new Set(), angleStep: 15, lengthStep: AUTO_LENGTH_STEP, numbers: true };

const known = new Set<string>(RULER_KINDS);

/** The settings read back from what was stored; anything unreadable is the default, a value out of range is too. The old form -- only the list of what is off -- still reads. */
export function parseRulerSettings(raw: unknown): RulerSettings {
  const disabledOf = (value: unknown): ReadonlySet<RulerKind> =>
    new Set(Array.isArray(value) ? value.filter((kind): kind is RulerKind => typeof kind === "string" && known.has(kind)) : []);
  if (Array.isArray(raw)) return { ...DEFAULT_RULER_SETTINGS, disabled: disabledOf(raw) };
  if (typeof raw !== "object" || raw === null) return DEFAULT_RULER_SETTINGS;
  const record = raw as Record<string, unknown>;
  return {
    disabled: disabledOf(record.disabled),
    angleStep: typeof record.angleStep === "number" && ANGLE_STEPS.includes(record.angleStep) ? record.angleStep : DEFAULT_RULER_SETTINGS.angleStep,
    lengthStep: record.lengthStep === AUTO_LENGTH_STEP || (typeof record.lengthStep === "number" && LENGTH_STEPS.includes(record.lengthStep)) ? (record.lengthStep as LengthStepSetting) : DEFAULT_RULER_SETTINGS.lengthStep,
    numbers: typeof record.numbers === "boolean" ? record.numbers : DEFAULT_RULER_SETTINGS.numbers,
  };
}

/** The settings as they are stored. */
export function serializeRulerSettings(settings: RulerSettings): unknown {
  return { disabled: [...settings.disabled], angleStep: settings.angleStep, lengthStep: settings.lengthStep, numbers: settings.numbers };
}
