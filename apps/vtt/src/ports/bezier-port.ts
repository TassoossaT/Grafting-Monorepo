import type { ConstructionPlanarRequest, ConstructionPlanarShape } from "./construction-session-port.ts";
/** Explicit wire values owned by Grafting; all curve calculations run in Rust. */
export type CurvePoint = readonly [number, number, number];
export interface CubicBezier { readonly points: readonly [CurvePoint, CurvePoint, CurvePoint, CurvePoint] }
export type CurveHandleMode = "automatic" | "aligned" | "mirrored" | "free";
/**
 * The plan shape a span keeps whatever its anchors do; absent is a free cubic.
 * A shaped span climbs linearly between its anchors. `positive` turns from
 * +X towards +Z; `center` is `[x, z]`.
 */
export type SpanGeometry = { readonly kind: "line" } | { readonly kind: "arc"; readonly center: readonly [number, number]; readonly positive: boolean };
export interface CurveHandles {
  readonly start: CurvePoint;
  readonly end: CurvePoint;
  readonly mode: CurveHandleMode;
  readonly bandOffsets: readonly number[];
  readonly endBandOffsets?: readonly number[];
  /** The structure type generated along this spine span; a span with no owner generates nothing. */
  readonly surfaceType?: string;
  /** Keeps the span straight or circular when its anchors move; see {@link SpanGeometry}. */
  readonly geometry?: SpanGeometry;
}
export type CurveCommand =
  | { readonly kind: "interpretStroke"; readonly points: readonly CurvePoint[]; readonly correction: number; readonly curved: boolean }
  | { readonly kind: "automatic"; readonly points: readonly CurvePoint[] }
  | { readonly kind: "fit"; readonly points: readonly CurvePoint[]; readonly cornerDegrees?: number }
  | { readonly kind: "join"; readonly sections: readonly (readonly [CurvePoint, CurvePoint])[] }
  | { readonly kind: "ribbon"; readonly curve: CubicBezier; readonly offsets: readonly [number, number]; readonly endOffsets?: readonly [number, number]; readonly parameters?: readonly number[] }
  | { readonly kind: "sample"; readonly curves: readonly CubicBezier[] }
  | { readonly kind: "split"; readonly curve: CubicBezier; readonly t: number; readonly profile?: CurveHandles }
  | { readonly kind: "merge"; readonly curve: CubicBezier; readonly next: CubicBezier }
  | { readonly kind: "pull"; readonly curve: CubicBezier; readonly t: number; readonly target: CurvePoint }
  | { readonly kind: "handle"; readonly curve: CubicBezier; readonly index: 1 | 2; readonly target: CurvePoint; readonly mode: CurveHandleMode; readonly opposite: CurvePoint | null }
  | { readonly kind: "nearest"; readonly curve: CubicBezier; readonly point: CurvePoint }
  | { readonly kind: "resolve"; readonly handles: CurveHandles; readonly start: CurvePoint; readonly end: CurvePoint }
  /** A circular arc in plan around `center` (whose y is the start height), climbing `rise` linearly over the signed `sweep` (radians, +X towards +Z), in quarter-turn spans whose handles carry their arc. */
  | { readonly kind: "helix"; readonly center: CurvePoint; readonly radius: number; readonly startAngle: number; readonly sweep: number; readonly rise: number }
  /** The arc from `start` through `through` to `end` in plan, in quarter-turn spans (one straight span when in line), climbing linearly; the handles carry each span's shape. */
  | { readonly kind: "arcThrough"; readonly start: CurvePoint; readonly through: CurvePoint; readonly end: CurvePoint }
  /** A chain, in order, with its heights redistributed from `start` to `end` at one constant grade by plan length; the plan is untouched. */
  | { readonly kind: "grade"; readonly curves: readonly CubicBezier[]; readonly start: number; readonly end: number };
export interface CurveBatch { readonly tolerance: number; readonly commands: readonly CurveCommand[] }
export interface CurveResult {
  readonly linear?: readonly boolean[];
  readonly ribbon: { readonly outer: readonly CurvePoint[] } | null;
  readonly curves: readonly CubicBezier[];
  readonly handles: readonly CurveHandles[];
  readonly samples: readonly (readonly { readonly t: number; readonly position: CurvePoint }[])[];
  readonly lengths: readonly number[];
  readonly parameter: number | null;
  readonly opposite: CurvePoint | null;
}
export interface CurveNetworkNode { readonly id: string; readonly position: CurvePoint }
export interface CurveNetworkEdge { readonly edgeId: string; readonly startNodeId: string; readonly endNodeId: string; readonly curve: CurveHandles }
export interface CurveNetworkRequest {
  readonly nodes: readonly CurveNetworkNode[];
  readonly edges: readonly CurveNetworkEdge[];
  readonly addedNodes: readonly CurveNetworkNode[];
  readonly addedEdges: readonly CurveNetworkEdge[];
  readonly nodePrefix: string;
  readonly snapTolerance: number;
  readonly heightTolerance: number;
  readonly tolerance: number;
}
export interface CurveNetworkPatch {
  readonly nodes: readonly CurveNetworkNode[];
  readonly edges: readonly CurveNetworkEdge[];
  readonly removedEdgeIds: readonly string[];
}
export interface BezierPort {
  planarBoolean(request: ConstructionPlanarRequest): readonly ConstructionPlanarShape[];
  curveBatch(request: CurveBatch): readonly CurveResult[];
  curveNetwork(request: CurveNetworkRequest): CurveNetworkPatch;
}
