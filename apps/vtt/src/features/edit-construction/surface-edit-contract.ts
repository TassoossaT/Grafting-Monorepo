import type { ConstructionOperationContext, RevisionPrecondition } from "./construction-operations.ts";

/** A product-owned scope supported by a surface edit mode. */
export type SurfaceEditTargetScope = "brush-region" | "surface" | "edge" | "node" | "cloud";

/** A world-space pointer sample collected for one brush gesture. */
export interface BrushGestureSample {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A renderer-neutral external brush footprint. */
export type BrushShape =
  | { readonly kind: "circle"; readonly radius: number }
  | { readonly kind: "square"; readonly size: number; readonly rotationRadians: number }
  | { readonly kind: "hexagon"; readonly radius: number; readonly rotationRadians: number };

/** The complete world-space sweep supplied by one gesture. */
export interface BrushGestureRegion {
  readonly samples: readonly BrushGestureSample[];
}

/** Parameters for the initial shallow path formation. */
export interface PathFormationParameters {
  readonly width: number;
  readonly depth: number;
  readonly falloff: number;
  readonly strength: number;
}

/** App-owned metadata for a mode, without renderer or Rust types. */
export interface SurfaceEditModeDefinition {
  readonly id: string;
  readonly sourceSurfaceType: string;
  readonly label: string;
  readonly supportedTargetScopes: readonly SurfaceEditTargetScope[];
  readonly effectKinds: readonly string[];
  readonly transformerCapability: string;
  readonly scopePolicy: "local" | "explicit-global";
  readonly previewPolicy: "gesture-preview" | "none";
}

/** One semantic path-paint intent. It contains no graph mutations. */
export interface PathBrushEffect extends ConstructionOperationContext {
  readonly kind: "surface.path-brush@1";
  readonly targetScope: "brush-region";
  readonly targetType: "path";
  readonly brushShape: BrushShape;
  readonly brushRegion: BrushGestureRegion;
  readonly parameters: PathFormationParameters;
  readonly expected: readonly RevisionPrecondition[];
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${field} must not be empty`);
  return normalized;
}

function finite(value: number, field: string): number {
  if (!Number.isFinite(value)) throw new Error(`${field} must be finite`);
  return value;
}

function positive(value: number, field: string): number {
  if (finite(value, field) <= 0) throw new Error(`${field} must be positive`);
  return value;
}

function freezeShape(shape: BrushShape): BrushShape {
  if (shape.kind === "circle") return Object.freeze({ kind: shape.kind, radius: positive(shape.radius, "brushShape.radius") });
  if (shape.kind === "square") return Object.freeze({ kind: shape.kind, size: positive(shape.size, "brushShape.size"), rotationRadians: finite(shape.rotationRadians, "brushShape.rotationRadians") });
  return Object.freeze({ kind: shape.kind, radius: positive(shape.radius, "brushShape.radius"), rotationRadians: finite(shape.rotationRadians, "brushShape.rotationRadians") });
}

/**
 * Creates one immutable effect for a future release-to-confirm boundary.
 * It deliberately does not resolve geometry or mutate graph topology.
 */
export function createPathBrushEffect(
  payload: Omit<PathBrushEffect, keyof ConstructionOperationContext | "kind" | "targetScope" | "targetType" | "expected">,
  context: ConstructionOperationContext,
  expected: readonly RevisionPrecondition[] = [],
): PathBrushEffect {
  if (payload.brushRegion.samples.length === 0) throw new Error("brushRegion.samples must not be empty");
  const samples = payload.brushRegion.samples.map((sample) => Object.freeze({ x: finite(sample.x, "sample.x"), y: finite(sample.y, "sample.y"), z: finite(sample.z, "sample.z") }));
  const revisions = expected.map((item) => {
    if (!Number.isInteger(item.revision) || item.revision < 0) throw new Error("expected.revision must be a non-negative integer");
    return Object.freeze({ scope: required(item.scope, "expected.scope"), revision: item.revision });
  });
  return Object.freeze({
    operationId: required(context.operationId, "operationId"), tableId: required(context.tableId, "tableId"), initiatedBy: required(context.initiatedBy, "initiatedBy"),
    kind: "surface.path-brush@1", targetScope: "brush-region", targetType: "path", brushShape: freezeShape(payload.brushShape),
    brushRegion: Object.freeze({ samples: Object.freeze(samples) }),
    parameters: Object.freeze({ width: positive(payload.parameters.width, "parameters.width"), depth: positive(payload.parameters.depth, "parameters.depth"), falloff: positive(payload.parameters.falloff, "parameters.falloff"), strength: positive(payload.parameters.strength, "parameters.strength") }),
    expected: Object.freeze(revisions),
  });
}
