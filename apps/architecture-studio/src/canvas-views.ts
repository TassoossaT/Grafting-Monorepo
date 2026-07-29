/** Stable application-owned identifiers for canvas composition. */
export const ARCHITECTURE_CANVAS_VIEWS = Object.freeze({
  node: Object.freeze({ entitySummary: "architecture.entity-summary" }),
  edge: Object.freeze({ relation: "architecture.relation" }),
});

/** One authored node size shared with the Rust layout request and node view. */
export const ARCHITECTURE_NODE_SIZE = Object.freeze({ width: 288, height: 84 });

/** Product-owned visual treatments derived from Graph IR node kinds. */
export type ArchitectureNodeTreatment = "project" | "target" | "other";

/** Product-owned data consumed by the Architecture Studio node component. */
export interface ArchitectureNodeViewData {
  readonly title: string;
  readonly description: string;
  readonly treatment: ArchitectureNodeTreatment;
}

/** Product-owned visual treatments derived from Graph IR relation kinds. */
export type ArchitectureEdgeTreatment = "hierarchy" | "dependency" | "reference";

/** Product-owned data consumed by the Architecture Studio edge presenter. */
export interface ArchitectureEdgeViewData {
  readonly label?: string;
  readonly treatment: ArchitectureEdgeTreatment;
}

/** Narrows opaque canvas data at the application composition boundary. */
export function readArchitectureNodeViewData(value: unknown): ArchitectureNodeViewData {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as Partial<ArchitectureNodeViewData>).title !== "string" ||
    typeof (value as Partial<ArchitectureNodeViewData>).description !== "string" ||
    typeof (value as Partial<ArchitectureNodeViewData>).treatment !== "string"
  ) {
    throw new Error("Architecture Studio node view received invalid data");
  }
  return value as ArchitectureNodeViewData;
}

/** Narrows opaque edge data at the application composition boundary. */
export function readArchitectureEdgeViewData(value: unknown): ArchitectureEdgeViewData {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as Partial<ArchitectureEdgeViewData>).treatment !== "string"
  ) {
    throw new Error("Architecture Studio edge view received invalid data");
  }
  return value as ArchitectureEdgeViewData;
}
