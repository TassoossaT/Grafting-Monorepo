import type { ConstructionPlanarRequest, ConstructionPlanarShape } from "./construction-session-port.ts";
/** Explicit wire values owned by Grafting; all curve calculations run in Rust. */
export type CurvePoint = readonly [number, number, number];
export interface CubicBezier { readonly points: readonly [CurvePoint, CurvePoint, CurvePoint, CurvePoint] }
export type CurveHandleMode = "automatic" | "aligned" | "mirrored" | "free";
export interface CurveHandles {
  readonly start: CurvePoint;
  readonly end: CurvePoint;
  readonly mode: CurveHandleMode;
  readonly bandOffsets: readonly number[];
  readonly endBandOffsets?: readonly number[];
}
export type CurveCommand =
  | { readonly kind: "automatic" | "fit"; readonly points: readonly CurvePoint[] }
  | { readonly kind: "join"; readonly sections: readonly (readonly [CurvePoint, CurvePoint])[] }
  | { readonly kind: "ribbon"; readonly curve: CubicBezier; readonly offsets: readonly [number, number]; readonly endOffsets?: readonly [number, number] }
  | { readonly kind: "sample"; readonly curves: readonly CubicBezier[] }
  | { readonly kind: "split"; readonly curve: CubicBezier; readonly t: number; readonly profile?: CurveHandles }
  | { readonly kind: "merge"; readonly curve: CubicBezier; readonly next: CubicBezier }
  | { readonly kind: "pull"; readonly curve: CubicBezier; readonly t: number; readonly target: CurvePoint }
  | { readonly kind: "handle"; readonly curve: CubicBezier; readonly index: 1 | 2; readonly target: CurvePoint; readonly mode: CurveHandleMode; readonly opposite: CurvePoint | null }
  | { readonly kind: "nearest"; readonly curve: CubicBezier; readonly point: CurvePoint }
  | { readonly kind: "resolve"; readonly handles: CurveHandles; readonly start: CurvePoint; readonly end: CurvePoint };
export interface CurveBatch { readonly tolerance: number; readonly commands: readonly CurveCommand[] }
export interface CurveResult {
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
  /**
   * Whether a weld this call makes may give the two curves it joins a shared
   * tangent. Defaults to on: a drawn run is a reading of a gesture, and two
   * strokes meant as one road should come back as one road. Off for a run
   * whose anchors were authored, where the shape is not an inference to be
   * improved.
   */
  readonly smoothWelds?: boolean;
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
