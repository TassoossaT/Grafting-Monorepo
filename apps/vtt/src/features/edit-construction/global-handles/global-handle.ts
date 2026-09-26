import type {
  BezierPort,
  ConstructionEdgeGeometry,
  ConstructionGraphPatch,
  ConstructionGraphSnapshot,
  ConstructionPosition,
  ConstructionRegionTopology,
  ConstructionSurfaceKey,
} from "@/ports";

import type { GlobalHandleKind } from "./global-handle-ids.ts";
import type { HandleMotion } from "./handle-motion.ts";

/** What a global handle's provider reads: the table as it stands, and the engine's own cloud query. */
export interface GlobalHandleScene {
  readonly graph: ConstructionGraphSnapshot;
  readonly topologies: readonly ConstructionRegionTopology[];
  /** Which surfaces form one cloud with `seed` (`ADR-0022`) -- the engine decides, never a copy of its rule. */
  readonly cloudFor: (request: { readonly seed: ConstructionSurfaceKey; readonly surfaceType: string }) => { readonly surfaceKeys: readonly ConstructionSurfaceKey[] };
}

/** One whole-structure handle, where it stands, and what it acts on. */
export interface GlobalHandle {
  readonly id: string;
  readonly kind: GlobalHandleKind;
  readonly position: ConstructionPosition;
  /** What the structure moves and turns round. */
  readonly pivot: ConstructionPosition;
  /** The structure's type. */
  readonly owner: string;
  /** Which provider made it -- and plans its edits. */
  readonly provider: string;
  /** Every node of the structure, lowest id first. */
  readonly nodeIds: readonly string[];
  /** A spiral's centre, when the structure is one -- what a turns handle winds round. */
  readonly center?: readonly [number, number];
  /** How the handle moves while dragged -- the path its gesture keeps it on. */
  readonly motion: HandleMotion;
}

/** What a gesture on a global handle asks for, whatever the structure. */
export type GlobalHandleIntent =
  | { readonly kind: "move"; readonly delta: ConstructionPosition }
  | { readonly kind: "rotate"; readonly angle: number }
  | { readonly kind: "height"; readonly dy: number }
  | { readonly kind: "wind"; readonly angle: number };

/**
 * What a provider makes of an intent, in the terms the edit is carried out
 * in:
 *
 * - spine: a spine graph patch its owner regenerates from;
 * - region-move: the whole cloud seeded at `seed` moved by `delta` -- through
 *   the type's own role policy, so its solver and validation apply;
 * - vertices: explicit node positions and edge geometry.
 */
export type GlobalHandleEdit =
  | { readonly kind: "spine"; readonly owner: string; readonly graphPatch: ConstructionGraphPatch }
  | { readonly kind: "region-move"; readonly seed: ConstructionSurfaceKey; readonly delta: ConstructionPosition }
  | {
      readonly kind: "vertices";
      readonly moves: readonly { readonly nodeId: string; readonly position: ConstructionPosition }[];
      readonly retypes: readonly { readonly edgeId: string; readonly geometry: ConstructionEdgeGeometry }[];
    };

/**
 * One way structures are built -- from a spine, from a cloud of regions --
 * and so one way their global handles stand and edit. A new way of
 * building gets its handles by adding a provider; nothing that shows or
 * drags them changes.
 */
export interface GlobalHandleProvider {
  readonly name: string;
  /** Every handle of every kind this provider places, before any type's declaration filters them. */
  handles(scene: GlobalHandleScene): readonly GlobalHandle[];
  /** What `intent` on `handle` edits; `undefined` when it edits nothing. Throws to refuse. */
  plan(scene: GlobalHandleScene, handle: GlobalHandle, intent: GlobalHandleIntent, port: Pick<BezierPort, "curveBatch">, operationId: string): GlobalHandleEdit | undefined;
}
