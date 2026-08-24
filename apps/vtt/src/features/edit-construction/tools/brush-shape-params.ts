import type { BrushShape } from "../modes/surface-edit-contract.ts";
import type { BrushShapeParams } from "./tool-types.ts";

/** Converts editable shape parameters into the immutable semantic brush contract. */
export function resolveBrushShape(params: BrushShapeParams): BrushShape {
  const rotationRadians = (params.rotationDegrees * Math.PI) / 180;
  if (params.shape === "square") return { kind: "square", size: params.radius * 2, rotationRadians };
  if (params.shape === "hexagon") return { kind: "hexagon", radius: params.radius, rotationRadians };
  return { kind: "circle", radius: params.radius };
}
