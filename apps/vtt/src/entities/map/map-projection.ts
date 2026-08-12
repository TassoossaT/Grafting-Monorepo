export type SurfaceRef = string;
export type NodeRef = string;
export type MapId = string;

export interface SurfaceProjection {
  readonly surfaceRef: SurfaceRef;
  readonly orderedNodeRefs: readonly NodeRef[];
  readonly type: string;
  readonly physical: boolean;
  readonly revision: number;
}

export interface NodePosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface NodePositionEntry {
  readonly nodeRef: NodeRef;
  readonly position: NodePosition;
  readonly revision: number;
}

export interface MapProjection {
  readonly byId: ReadonlyMap<SurfaceRef, SurfaceProjection>;
  /**
   * Live node positions, keyed by {@link NodeRef} -- what edit-mode picking
   * and drag-to-move need and `SurfaceProjection` alone cannot give (its
   * `orderedNodeRefs` are bare ids, not positions). Populated from
   * `ConstructionSessionPort.getNodePositions()` at map load, then kept
   * current by `node-moved` deltas.
   */
  readonly nodePositions: ReadonlyMap<NodeRef, NodePositionEntry>;
  readonly revision: number;
}

export type MapProjectionDelta =
  | { readonly type: "surface-upserted"; readonly surface: SurfaceProjection }
  | { readonly type: "surface-removed"; readonly surfaceRef: SurfaceRef; readonly revision: number }
  | {
      readonly type: "node-moved";
      readonly nodeRef: NodeRef;
      readonly position: NodePosition;
      readonly revision: number;
    };

/**
 * Derives a stable {@link SurfaceRef} from a surface's canonical node-set
 * identity. Sorted + joined so two callers presenting the same node set in
 * a different order agree on the same ref -- mirroring
 * `grafting-graph-core::SurfaceKey`'s own order-independence. Per
 * `docs/architecture/vtt-product-model.md` §4.1, a `SurfaceRef` is "derived
 * by an adapter from canonical node-set identity"; this is that pure
 * derivation, called from the adapter layer.
 */
export function surfaceRefFromNodeSet(nodeRefs: readonly NodeRef[]): SurfaceRef {
  return [...nodeRefs].sort().join(",");
}

function nonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${field} must not be empty`);
  return normalized;
}

export function createSurfaceProjection(input: SurfaceProjection): SurfaceProjection {
  if (input.orderedNodeRefs.length === 0) {
    throw new Error("orderedNodeRefs must not be empty");
  }
  if (!Number.isInteger(input.revision) || input.revision < 0) {
    throw new Error("revision must be a non-negative integer");
  }
  const orderedNodeRefs = input.orderedNodeRefs.map((id, index) =>
    nonEmpty(id, `orderedNodeRefs[${index}]`),
  );
  return Object.freeze({
    surfaceRef: nonEmpty(input.surfaceRef, "surfaceRef"),
    orderedNodeRefs: Object.freeze(orderedNodeRefs),
    type: nonEmpty(input.type, "type"),
    physical: input.physical,
    revision: input.revision,
  });
}

function finite(value: number, field: string): number {
  if (!Number.isFinite(value)) throw new Error(`${field} must be finite`);
  return value;
}

function createNodePositionEntry(input: NodePositionEntry): NodePositionEntry {
  if (!Number.isInteger(input.revision) || input.revision < 0) {
    throw new Error("revision must be a non-negative integer");
  }
  return Object.freeze({
    nodeRef: nonEmpty(input.nodeRef, "nodeRef"),
    position: Object.freeze({
      x: finite(input.position.x, "position.x"),
      y: finite(input.position.y, "position.y"),
      z: finite(input.position.z, "position.z"),
    }),
    revision: input.revision,
  });
}

export function createMapProjection(
  surfaces: readonly SurfaceProjection[] = [],
  nodePositions: readonly NodePositionEntry[] = [],
): MapProjection {
  const byId = new Map<SurfaceRef, SurfaceProjection>();
  for (const candidate of surfaces) {
    const surface = createSurfaceProjection(candidate);
    if (byId.has(surface.surfaceRef)) {
      throw new Error(`duplicate surfaceRef "${surface.surfaceRef}"`);
    }
    byId.set(surface.surfaceRef, surface);
  }

  const nodePositionsById = new Map<NodeRef, NodePositionEntry>();
  for (const candidate of nodePositions) {
    const entry = createNodePositionEntry(candidate);
    if (nodePositionsById.has(entry.nodeRef)) {
      throw new Error(`duplicate nodeRef "${entry.nodeRef}"`);
    }
    nodePositionsById.set(entry.nodeRef, entry);
  }

  return Object.freeze({ byId, nodePositions: nodePositionsById, revision: 0 });
}

function sameSurface(left: SurfaceProjection, right: SurfaceProjection): boolean {
  return (
    left.surfaceRef === right.surfaceRef &&
    left.type === right.type &&
    left.physical === right.physical &&
    left.revision === right.revision &&
    left.orderedNodeRefs.length === right.orderedNodeRefs.length &&
    left.orderedNodeRefs.every((id, index) => id === right.orderedNodeRefs[index])
  );
}

export function applyMapProjectionDelta(
  current: MapProjection,
  delta: MapProjectionDelta,
): MapProjection {
  if (delta.type === "node-moved") {
    const entry = createNodePositionEntry({
      nodeRef: delta.nodeRef,
      position: delta.position,
      revision: delta.revision,
    });
    const previous = current.nodePositions.get(entry.nodeRef);
    if (previous !== undefined && entry.revision <= previous.revision) {
      throw new Error(`node "${entry.nodeRef}" move revision must increase`);
    }
    if (
      previous !== undefined &&
      previous.revision === entry.revision &&
      previous.position.x === entry.position.x &&
      previous.position.y === entry.position.y &&
      previous.position.z === entry.position.z
    ) {
      return current;
    }
    const nodePositions = new Map(current.nodePositions);
    nodePositions.set(entry.nodeRef, entry);
    return Object.freeze({ byId: current.byId, nodePositions, revision: current.revision + 1 });
  }

  if (delta.type === "surface-removed") {
    const previous = current.byId.get(delta.surfaceRef);
    if (previous === undefined) return current;
    if (!Number.isInteger(delta.revision) || delta.revision <= previous.revision) {
      throw new Error(`surface "${delta.surfaceRef}" removal revision must increase`);
    }
    const byId = new Map(current.byId);
    byId.delete(delta.surfaceRef);
    return Object.freeze({ byId, nodePositions: current.nodePositions, revision: current.revision + 1 });
  }

  const surface = createSurfaceProjection(delta.surface);
  const previous = current.byId.get(surface.surfaceRef);
  if (previous !== undefined && sameSurface(previous, surface)) return current;
  if (previous !== undefined && surface.revision <= previous.revision) {
    throw new Error(`surface "${surface.surfaceRef}" revision must increase`);
  }

  const byId = new Map(current.byId);
  byId.set(surface.surfaceRef, surface);
  return Object.freeze({ byId, nodePositions: current.nodePositions, revision: current.revision + 1 });
}
