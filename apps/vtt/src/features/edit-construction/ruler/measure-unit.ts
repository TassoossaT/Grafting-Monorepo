/**
 * The unit every length is shown in -- the table's own choice. Lengths are
 * kept in metres everywhere else; this is the only place that knows any other
 * unit, so a measure, a panel and a tool all read one answer.
 */
export type MeasureUnitId = "m" | "ft" | "sq";

export interface MeasureUnit {
  readonly id: MeasureUnitId;
  readonly label: string;
  readonly symbol: string;
  /** How many metres one of this unit is. */
  readonly metres: number;
  /** Digits shown after the point. */
  readonly digits: number;
}

/** A square is 5 ft -- the tabletop's usual cell. */
export const MEASURE_UNITS: Readonly<Record<MeasureUnitId, MeasureUnit>> = {
  m: { id: "m", label: "Metros", symbol: "m", metres: 1, digits: 2 },
  ft: { id: "ft", label: "Pés", symbol: "ft", metres: 0.3048, digits: 1 },
  sq: { id: "sq", label: "Quadrados", symbol: "q", metres: 1.524, digits: 1 },
};

export const DEFAULT_MEASURE_UNIT: MeasureUnitId = "m";

/** The unit named, or the default one when none is -- a ruler is never brought down by a missing choice. */
const specOf = (unit: MeasureUnitId | undefined): MeasureUnit => MEASURE_UNITS[unit ?? DEFAULT_MEASURE_UNIT] ?? MEASURE_UNITS[DEFAULT_MEASURE_UNIT];

export const isMeasureUnitId = (value: unknown): value is MeasureUnitId => typeof value === "string" && Object.hasOwn(MEASURE_UNITS, value);

/** `metres` in `unit`. */
export const fromMetres = (metres: number, unit?: MeasureUnitId): number => metres / specOf(unit).metres;

/** `value` of `unit`, in metres. */
export const toMetres = (value: number, unit?: MeasureUnitId): number => value * specOf(unit).metres;

/** `metres` written in `unit`: "3.05 m", "10.0 ft". A trailing zero fraction is kept so a changing length does not jitter in width. */
export function formatLength(metres: number, unit: MeasureUnitId = DEFAULT_MEASURE_UNIT): string {
  const spec = specOf(unit);
  return `${fromMetres(metres, unit).toFixed(spec.digits)} ${spec.symbol}`;
}
