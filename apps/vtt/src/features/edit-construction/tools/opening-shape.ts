import { RECTANGLE_OPENING_SHAPE, type OpeningShape, type OpeningSide } from "./tool-types.ts";

/** Where an opening's shape lives in its region's property bag. */
export const OPENING_SHAPE_PROP = "openingShape";

const SIDES: readonly OpeningSide[] = ["top", "right", "bottom", "left"];

export function isRectangleShape(shape: OpeningShape | undefined): boolean {
  return shape === undefined || (!shape.ellipse && SIDES.every((side) => !(shape.radii[side] > 0)));
}

/** The shape stored in a region's property bag; a missing or malformed entry is a rectangle. */
export function shapeFromProps(props: Readonly<Record<string, unknown>> | undefined): OpeningShape {
  const raw = props?.[OPENING_SHAPE_PROP];
  if (raw === null || typeof raw !== "object") return RECTANGLE_OPENING_SHAPE;
  const entry = raw as { readonly ellipse?: unknown; readonly radii?: Record<string, unknown> };
  const radius = (side: OpeningSide) => {
    const value = entry.radii?.[side];
    return typeof value === "number" && value > 0 ? value : 0;
  };
  return { ellipse: entry.ellipse === true, radii: { top: radius("top"), right: radius("right"), bottom: radius("bottom"), left: radius("left") } };
}

/** The property-bag entries an opening with `shape` stores; none for a rectangle. */
export function shapeProps(shape: OpeningShape | undefined): Record<string, unknown> {
  if (shape === undefined || isRectangleShape(shape)) return {};
  return { [OPENING_SHAPE_PROP]: { ellipse: shape.ellipse, radii: { ...shape.radii } } };
}

export function sameShape(a: OpeningShape | undefined, b: OpeningShape | undefined): boolean {
  const left = a ?? RECTANGLE_OPENING_SHAPE;
  const right = b ?? RECTANGLE_OPENING_SHAPE;
  if (isRectangleShape(left) && isRectangleShape(right)) return true;
  if (left.ellipse || right.ellipse) return left.ellipse === right.ellipse;
  return SIDES.every((side) => Math.abs((left.radii[side] ?? 0) - (right.radii[side] ?? 0)) < 1e-9);
}
