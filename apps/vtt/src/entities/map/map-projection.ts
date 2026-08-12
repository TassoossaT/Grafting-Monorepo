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

export interface MapProjection {
  readonly byId: ReadonlyMap<SurfaceRef, SurfaceProjection>;
  readonly revision: number;
}

export type MapProjectionDelta =
  | { readonly type: "surface-upserted"; readonly surface: SurfaceProjection }
  | { readonly type: "surface-removed"; readonly surfaceRef: SurfaceRef; readonly revision: number };

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

export function createMapProjection(surfaces: readonly SurfaceProjection[] = []): MapProjection {
  const byId = new Map<SurfaceRef, SurfaceProjection>();
  for (const candidate of surfaces) {
    const surface = createSurfaceProjection(candidate);
    if (byId.has(surface.surfaceRef)) {
      throw new Error(`duplicate surfaceRef "${surface.surfaceRef}"`);
    }
    byId.set(surface.surfaceRef, surface);
  }
  return Object.freeze({ byId, revision: 0 });
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
  if (delta.type === "surface-removed") {
    const previous = current.byId.get(delta.surfaceRef);
    if (previous === undefined) return current;
    if (!Number.isInteger(delta.revision) || delta.revision <= previous.revision) {
      throw new Error(`surface "${delta.surfaceRef}" removal revision must increase`);
    }
    const byId = new Map(current.byId);
    byId.delete(delta.surfaceRef);
    return Object.freeze({ byId, revision: current.revision + 1 });
  }

  const surface = createSurfaceProjection(delta.surface);
  const previous = current.byId.get(surface.surfaceRef);
  if (previous !== undefined && sameSurface(previous, surface)) return current;
  if (previous !== undefined && surface.revision <= previous.revision) {
    throw new Error(`surface "${surface.surfaceRef}" revision must increase`);
  }

  const byId = new Map(current.byId);
  byId.set(surface.surfaceRef, surface);
  return Object.freeze({ byId, revision: current.revision + 1 });
}
