import { formatLength, fromMetres } from "../../../../features/edit-construction/index.ts";
import { MAX_ITEM_PROTRACTORS, MAX_TEETH, PROTRACTOR_STEP_DEGREES, frameOf, linesOf, protractorOf, teethSpacing, type RulerLine, type RulerView } from "./ruler-preview.ts";
import { metersFor, type RulerFeedback } from "./ruler-session.ts";

/**
 * The numbers the ruler writes on the map: what the readout at the pointer
 * says once, written where it belongs -- the value at the teeth, the length of
 * a line along it, the angle at the protractor's marks. Where they go is
 * decided here, from the very lines and protractors the ruler draws, so a
 * number never stands off from the mark it names. Pure: it says what to write
 * and where; a renderer writes it.
 */

/** One number to write on the map. */
export interface MapLabel {
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly text: string;
  /** How tall it is written, in metres: the same few pixels at every zoom. */
  readonly height: number;
}

/** How tall a number is on the screen, in pixels. */
const LABEL_PX = 13;
/** What it is, in metres, when the scale is unknown. */
const LABEL_FALLBACK = 0.3;
/** About how wide a number on the screen is, in pixels: teeth numbered closer than this would run together. */
const NUMBER_PX = 40;
/** The most numbers written at once: more is a page of figures, not a ruler. */
export const MAX_MAP_LABELS = 48;
/** The teeth between two numbers on a line, in the order tried. */
const EVERY = [5, 10, 20, 50, 100];

const DEGREE = Math.PI / 180;

/** A value in the table's unit with no trailing zeros: 5, 0.5, 12.25. */
export const compact = (value: number): string => value.toFixed(2).replace(/\.?0+$/, "");

type Point = { readonly x: number; readonly y: number; readonly z: number };

/** Every number the ruler writes for `feedback`, nearest the line being drawn first, no more than {@link MAX_MAP_LABELS}. */
export function mapLabelsOf(feedback: RulerFeedback, metersPerPixel: number | undefined, view: RulerView | undefined): readonly MapLabel[] {
  if (!view || view.numbers === false) return [];
  const height = metersFor(metersPerPixel, LABEL_PX, LABEL_FALLBACK, [0.06, 0.9]);
  const labels: MapLabel[] = [];
  const write = (position: Point, text: string): void => { if (labels.length < MAX_MAP_LABELS) labels.push({ position, text, height }); };
  const spacing = teethSpacing(metersPerPixel, view.unit, view.lengthStep);
  // Teeth numbered often enough to read: never closer, on the screen, than a number is wide.
  const every = EVERY.find((k) => metersPerPixel === undefined || (k * spacing) / metersPerPixel >= NUMBER_PX) ?? EVERY[EVERY.length - 1]!;
  let itemProtractors = 0;
  for (const line of linesOf(feedback)) {
    const { length, u, n } = frameOf(line);
    if (length < 1e-6) continue;
    // Numbers stand off to one side of the line, never on it.
    const side = (at: number, away: number): Point => ({ x: line.anchor.x + u.x * at + n.x * away, y: line.anchor.y + u.y * at, z: line.anchor.z + u.z * at + n.z * away });
    const toothReach = metersFor(metersPerPixel, 6, 0.2, [0.04, 0.8]);

    // The value at the teeth: every few, counted out from the item the line comes out of.
    const teeth = Math.min(MAX_TEETH, Math.floor(length / spacing + 1e-9));
    if (line.teeth !== false) for (let i = every; i <= teeth; i += every) write(side(spacing * i, toothReach + height * 0.8), compact(fromMetres(spacing * i, view.unit)));
    // How long it is, along it.
    const said = line.change ? `${line.change.name} ${line.change.meters >= 0 ? "+" : "−"}${formatLength(Math.abs(line.change.meters), view.unit)}` : formatLength(length, view.unit);
    write(side(length / 2, toothReach + height * 1.6), said);

    // The angles of the protractor round its item: at the quarter turns of the eighths, and at the line itself.
    const wanted = line.protractor && view.protractor !== false && (!line.stroke || itemProtractors++ < MAX_ITEM_PROTRACTORS);
    const protractor = wanted ? protractorOf(line.anchor, line.tip, line.zero, metersPerPixel) : undefined;
    if (protractor) {
      const out = protractor.radius + protractor.tick(16) + height * 0.9;
      for (let k = protractor.first; k <= protractor.last; k += 1) {
        const degrees = k * PROTRACTOR_STEP_DEGREES;
        if (Math.abs(degrees % 45) < 1e-9) write(protractor.at(degrees, out), `${((degrees % 360) + 360) % 360}°`);
      }
      const heading = Math.atan2(line.tip.z - line.anchor.z, line.tip.x - line.anchor.x);
      const relative = ((((heading - line.zero) / DEGREE + 180) % 360) + 360) % 360 - 180;
      write(protractor.at(relative, out + height * 1.3), `${compact(Math.round(relative * 10) / 10)}°`);
    }
  }
  return labels;
}

export type { RulerLine };
