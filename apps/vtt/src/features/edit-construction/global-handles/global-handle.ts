import type {
  ApplyPatchReplacementRequest,
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
  | { readonly kind: "wind"; readonly angle: number }
  /** Take an end to `at`; `under` is the surface the pointer is on, which a landing prefers. */
  | { readonly kind: "place"; readonly at: ConstructionPosition; readonly under?: ConstructionSurfaceKey }
  /** Take an end off whatever it is welded to, leaving it where it stands. */
  | { readonly kind: "detach" }
  /** Delete the whole structure, taking it off whatever it is welded to first. */
  | { readonly kind: "remove" };

/**
 * What a provider makes of an intent, in the terms the edit is carried out
 * in:
 *
 * - spine: a spine graph patch its owner regenerates from;
 * - region-move: the whole cloud seeded at `seed` moved by `delta` -- through
 *   the type's own role policy, so its solver and validation apply;
 * - vertices: explicit node positions and edge geometry;
 * - replace: faces swapped for new ones in one patch replacement -- a
 *   structure rebuilt, and the floors it welds into or leaves.
 */
export type GlobalHandleEdit =
  | {
      readonly kind: "spine";
      readonly owner: string;
      readonly graphPatch: ConstructionGraphPatch;
      /**
       * Faces the patch moves along with the spine without regenerating them
       * -- the floors welded to its ends, carried whole. Their welds stay as
       * they are, and each answers its own move (a grounded floor re-cuts).
       */
      readonly carries?: readonly ConstructionSurfaceKey[];
    }
  | { readonly kind: "region-move"; readonly seed: ConstructionSurfaceKey; readonly delta: ConstructionPosition }
  | {
      readonly kind: "vertices";
      readonly moves: readonly { readonly nodeId: string; readonly position: ConstructionPosition }[];
      readonly retypes: readonly { readonly edgeId: string; readonly geometry: ConstructionEdgeGeometry }[];
    }
  | { readonly kind: "replace"; readonly request: ApplyPatchReplacementRequest }
  /**
   * The structure's faces deleted, after `release` -- a replacement taking
   * its ends off the floors they are welded into -- when it has one.
   */
  | { readonly kind: "remove"; readonly surfaceKeys: readonly ConstructionSurfaceKey[]; readonly release?: ApplyPatchReplacementRequest };

/** Something a picked handle offers besides dragging it -- a button, say. */
export interface GlobalHandleAction {
  /** Names the action to whatever runs it. */
  readonly id: string;
  readonly label: string;
  readonly intent: GlobalHandleIntent;
}

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
  /** What else `handle` offers as it stands now. */
  actions?(scene: GlobalHandleScene, handle: GlobalHandle): readonly GlobalHandleAction[];
}
