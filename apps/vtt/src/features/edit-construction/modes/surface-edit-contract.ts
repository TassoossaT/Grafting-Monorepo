import type { PathFormationRecipe } from "../structure-types/path/path-recipe.ts";
import type { ConstructionPosition, CubicBezier, CurvePoint } from "@/ports";

/**
 * A revision an effect expects to still be current when it lands.
 *
 * Nothing supplies one today -- every effect is built with an empty list --
 * so this is the shape a concurrent-edit check would take, not a check that
 * runs.
 */
export interface RevisionPrecondition {
  readonly scope: string;
  readonly revision: number;
}

/** Who asked for an effect, and on which table. Only `operationId` crosses to the engine; the rest is for undo/redo bookkeeping and attribution. */
export interface ConstructionOperationContext {
  readonly operationId: string;
  readonly tableId: string;
  readonly initiatedBy: string;
}

/**
 * A product-owned scope supported by a surface edit mode -- *what a mode
 * accepts as a target*.
 *
 * Not to be confused with `structure-types`' own `EditScope`, which is *how
 * far one role's op reaches* once a target has been grabbed. A mode can
 * accept a `"node"` target whose role nevertheless reaches the whole cloud;
 * the two answer different questions and share only the word.
 */
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

/** A generic construction element the brush observed while sweeping. */
export interface BrushElementObservation {
  readonly point: ConstructionPosition;
  readonly nodeId?: string;
  readonly surfaceRef?: string;
}

/** VTT-selected profile for a generic path-sweep formation. */
export type PathFormationParameters = PathFormationRecipe;

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
  /** Explicit pen controls, preserved without fitting the stroke. */
  readonly authoredCurves?: readonly CubicBezier[];
  /** Editing policy for newly authored spans; omitted preserves explicit controls. */
  readonly curveMode?: "automatic" | "free";
  /** Raw brush observations, never pre-interpreted as path topology. */
  readonly observedElements: readonly BrushElementObservation[];
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

function freezeFormation(parameters: PathFormationParameters): PathFormationParameters {
  if (!Number.isFinite(parameters.miterLimit) || parameters.miterLimit < 1) throw new Error("parameters.miterLimit must be at least one");
  if (parameters.profile.length < 2) throw new Error("parameters.profile must have at least two points");
  const profile = parameters.profile.map((point, index) => {
    const lateralOffset = finite(point.lateralOffset, `parameters.profile[${index}].lateralOffset`);
    const elevation = finite(point.elevation, `parameters.profile[${index}].elevation`);
    if (elevation < 0) throw new Error("parameters.profile elevation must not be negative");
    if (index > 0 && lateralOffset <= parameters.profile[index - 1]!.lateralOffset) throw new Error("parameters.profile must be strictly ordered");
    return Object.freeze({ lateralOffset, elevation });
  });
  return Object.freeze({ kind: parameters.kind, profile: Object.freeze(profile), miterLimit: parameters.miterLimit });
}

function optionalId(value: string | undefined, field: string): string | undefined {
  return value === undefined ? undefined : required(value, field);
}

function freezeObservedElements(elements: readonly BrushElementObservation[] | undefined): readonly BrushElementObservation[] {
  return Object.freeze((elements ?? []).map((element, index) => Object.freeze({
    point: Object.freeze({
      x: finite(element.point.x, `observedElements[${index}].point.x`),
      y: finite(element.point.y, `observedElements[${index}].point.y`),
      z: finite(element.point.z, `observedElements[${index}].point.z`),
    }),
    nodeId: optionalId(element.nodeId, `observedElements[${index}].nodeId`),
    surfaceRef: optionalId(element.surfaceRef, `observedElements[${index}].surfaceRef`),
  })));
}

/**
 * Creates one immutable effect for a future release-to-confirm boundary.
 * It deliberately does not resolve geometry or mutate graph topology.
 */
export function createPathBrushEffect(
  payload: Omit<PathBrushEffect, keyof ConstructionOperationContext | "kind" | "targetScope" | "targetType" | "expected" | "observedElements"> &
    Partial<Pick<PathBrushEffect, "observedElements">>,
  context: ConstructionOperationContext,
  expected: readonly RevisionPrecondition[] = [],
): PathBrushEffect {
  if (payload.brushRegion.samples.length === 0) throw new Error("brushRegion.samples must not be empty");
  if (payload.curveMode !== undefined && payload.curveMode !== "automatic" && payload.curveMode !== "free") throw new Error("invalid curveMode");
  if (payload.curveMode === "automatic" && payload.authoredCurves === undefined) throw new Error("automatic curveMode requires authoredCurves");
  const samples = payload.brushRegion.samples.map((sample) => Object.freeze({ x: finite(sample.x, "sample.x"), y: finite(sample.y, "sample.y"), z: finite(sample.z, "sample.z") }));
  const revisions = expected.map((item) => {
    if (!Number.isInteger(item.revision) || item.revision < 0) throw new Error("expected.revision must be a non-negative integer");
    return Object.freeze({ scope: required(item.scope, "expected.scope"), revision: item.revision });
  });
  return Object.freeze({
    operationId: required(context.operationId, "operationId"),
    tableId: required(context.tableId, "tableId"),
    initiatedBy: required(context.initiatedBy, "initiatedBy"),
    kind: "surface.path-brush@1",
    targetScope: "brush-region",
    targetType: "path",
    brushShape: freezeShape(payload.brushShape),
    brushRegion: Object.freeze({ samples: Object.freeze(samples) }),
    ...(payload.authoredCurves === undefined ? {} : { authoredCurves: freezeAuthoredCurves(payload.authoredCurves) }),
    ...(payload.curveMode === undefined ? {} : { curveMode: payload.curveMode }),
    observedElements: freezeObservedElements(payload.observedElements),
    parameters: freezeFormation(payload.parameters),
    expected: Object.freeze(revisions),
  });
}

/** Validates and freezes wire coordinates without computing curve geometry. */
function freezeAuthoredCurves(curves: readonly CubicBezier[]): readonly CubicBezier[] {
  if (!Array.isArray(curves) || curves.length === 0 || curves.length > 4096) throw new Error("authoredCurves must contain 1..4096 segments");
  const frozen = curves.map((curve) => {
    if (!Array.isArray(curve?.points) || curve.points.length !== 4) throw new Error("a cubic must have four points");
    const points = curve.points.map((point: CurvePoint) => {
      if (!Array.isArray(point) || point.length !== 3 || point.some((value) => !Number.isFinite(value) || Math.abs(value) > 1e12)) throw new Error("invalid cubic coordinate");
      return Object.freeze([...point]) as CurvePoint;
    }) as unknown as CubicBezier["points"];
    return Object.freeze({ points: Object.freeze(points) });
  });
  for (let i = 1; i < frozen.length; i++) {
    if (frozen[i - 1]!.points[3].some((value, axis) => value !== frozen[i]!.points[0][axis])) throw new Error("authoredCurves must be connected");
  }
  return Object.freeze(frozen);
}
