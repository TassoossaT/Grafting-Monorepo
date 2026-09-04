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
    }
  | { readonly type: "node-removed"; readonly nodeRef: NodeRef };

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
  return applyMapProjectionDeltas(current, [delta]);
}

/** Applies one mutation's deltas while cloning each backing map at most once. */
export function applyMapProjectionDeltas(
  current: MapProjection,
  deltas: readonly MapProjectionDelta[],
): MapProjection {
  let byId: Map<SurfaceRef, SurfaceProjection> | undefined;
  let nodePositions: Map<NodeRef, NodePositionEntry> | undefined;
  let revision = current.revision;

  for (const delta of deltas) {
    if (delta.type === "node-moved") {
      const entry = createNodePositionEntry(delta);
      const previous = (nodePositions ?? current.nodePositions).get(entry.nodeRef);
      if (previous !== undefined && entry.revision <= previous.revision) {
        throw new Error(`node "${entry.nodeRef}" move revision must increase`);
      }
      nodePositions ??= new Map(current.nodePositions);
      nodePositions.set(entry.nodeRef, entry);
      revision += 1;
      continue;
    }

    if (delta.type === "node-removed") {
      const live = nodePositions ?? current.nodePositions;
      if (!live.has(delta.nodeRef)) continue;
      nodePositions ??= new Map(current.nodePositions);
      nodePositions.delete(delta.nodeRef);
      revision += 1;
      continue;
    }

    if (delta.type === "surface-removed") {
      const live = byId ?? current.byId;
      const previous = live.get(delta.surfaceRef);
      if (previous === undefined) continue;
      if (!Number.isInteger(delta.revision) || delta.revision <= previous.revision) {
        throw new Error(`surface "${delta.surfaceRef}" removal revision must increase`);
      }
      byId ??= new Map(current.byId);
      byId.delete(delta.surfaceRef);
      revision += 1;
      continue;
    }

    const surface = createSurfaceProjection(delta.surface);
    const previous = (byId ?? current.byId).get(surface.surfaceRef);
    if (previous !== undefined && sameSurface(previous, surface)) continue;
    if (previous !== undefined && surface.revision <= previous.revision) {
      throw new Error(`surface "${surface.surfaceRef}" revision must increase`);
    }
    byId ??= new Map(current.byId);
    byId.set(surface.surfaceRef, surface);
    revision += 1;
  }

  if (byId === undefined && nodePositions === undefined) return current;
  return Object.freeze({
    byId: byId ?? current.byId,
    nodePositions: nodePositions ?? current.nodePositions,
    revision,
  });
}
