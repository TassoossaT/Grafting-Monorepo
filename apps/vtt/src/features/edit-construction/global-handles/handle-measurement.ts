import type { EditMeasureName } from "../ruler/index.ts";
import type { GlobalHandleKind } from "./global-handle-ids.ts";

/**
 * What a handle measures while it is dragged -- declared here with its kind,
 * so the ruler reads it off the handle and no gesture carries a `switch` of
 * its own. Its movement (`HandleMotion`) says how it moves; this says what is
 * worth knowing of that move: how far it went, how long a side became, how
 * high the structure stands, how much it climbs, how far it turned. `"none"`
 * is a handle that is clicked, not dragged.
 *
 * A height is also what the table's round number lands on: a handle measured
 * as `"height"` is one the ruler rounds.
 */
export const HANDLE_MEASUREMENT: Readonly<Record<GlobalHandleKind, EditMeasureName | "none">> = {
  pivot: "move",
  rotate: "turn",
  height: "height",
  turns: "turn",
  radius: "radius",
  origin: "move",
  destination: "move",
  originHeight: "height",
  destinationHeight: "height",
  side: "side",
  corner: "move",
  foot: "move",
  top: "height",
  detach: "none",
  rise: "height",
  slope: "slope",
  seam: "slope",
  insert: "move",
};
