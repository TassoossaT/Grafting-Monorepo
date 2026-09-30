import type { ConstructionEdgeSnapshot } from "@/ports";

/** Assigns a symmetric profile to an authored span without changing its shape. */
export function withSpanWidth(curve: NonNullable<ConstructionEdgeSnapshot["curve"]>, width: number, endWidth?: number): NonNullable<ConstructionEdgeSnapshot["curve"]> {
  if (!Number.isFinite(width) || width <= 0 || (endWidth !== undefined && (!Number.isFinite(endWidth) || endWidth <= 0))) throw Error("Informe uma largura positiva.");
  return { ...curve, bandOffsets: [-width / 2, width / 2],
    endBandOffsets: endWidth === undefined || endWidth === width ? undefined : [-endWidth / 2, endWidth / 2] };
}
