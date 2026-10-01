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

/**
 * What a handle is measured against while it is dragged -- declared with its
 * kind, as {@link HANDLE_MEASUREMENT} is:
 *
 * - `"grab"`: where it was grabbed. A whole structure carried across the
 *   ground is read by how far, and which way, it went.
 * - `"edges"`: the sides it edits. A vertex is read by the sides that leave
 *   it, from their far ends -- which stay -- to where the vertex now stands:
 *   their lengths, their angles, parallel to the structure's other sides,
 *   square to them. Never from where the vertex began, which is gone as soon
 *   as it moves.
 * - `"grade"`: the runs beside it, in height. A top is read by how steeply
 *   the run to each neighbour climbs.
 * - `"none"`: nothing near it -- a height, a turn, a radius, a click.
 */
export type HandleReference = "grab" | "edges" | "grade" | "none";

export const HANDLE_REFERENCE: Readonly<Record<GlobalHandleKind, HandleReference>> = {
  pivot: "grab",
  rotate: "none",
  height: "none",
  turns: "none",
  radius: "none",
  origin: "grab",
  destination: "grab",
  originHeight: "none",
  destinationHeight: "none",
  side: "none",
  corner: "edges",
  foot: "edges",
  top: "grade",
  detach: "none",
  rise: "none",
  slope: "none",
  seam: "none",
  insert: "edges",
};
