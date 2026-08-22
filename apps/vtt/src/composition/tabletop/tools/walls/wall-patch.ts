import type {
  ConstructionEdgeGeometry,
  ConstructionEdgeId,
  ConstructionNodeId,
  ConstructionOrientedEdgeUse,
  ConstructionPatch,
  ConstructionPatchEdge,
  ConstructionPatchRegion,
  ConstructionPosition,
} from "@/ports";

/**
 * One extremity of a wall run: the two nodes of that extremity's own
 * vertical edge, bottom and top.
 *
 * A wall is four vertices and four edges, and the four vertices are the four
 * extremities -- two columns, this one and the next. Whatever else ends up
 * along an edge later (a T-junction insert splitting it into a series of
 * micro-edges) changes none of that: what separates one wall from another is
 * a division running side to side, never a vertex sitting on the way.
 *
 * The height of the wall is the length of this column's own vertical edge,
 * which is the distance between `bottom` and `top`. There is no stored
 * height anywhere -- the graph holds the two nodes and their connection, and
 * the distance is a consequence.
 */
export interface WallColumn {
  readonly bottomNodeId: ConstructionNodeId;
  readonly topNodeId: ConstructionNodeId;
  readonly bottom: ConstructionPosition;
  readonly top: ConstructionPosition;
}

/**
 * A whole wall run, ready to be declared: the columns it passes through, and
 * the contour geometry of each step between them, in the direction the run
 * travels.
 *
 * `closed` makes the last column step back onto the first -- which is all a
 * tower or a house outline is. There is no separate closed-shape builder and
 * no preset-specific geometry: a preset only decides where the columns are
 * and what each step curves like.
 */
export interface WallContour {
  readonly columns: readonly WallColumn[];
  /** Geometry of the step from column `i` to column `i + 1`, in that direction. */
  readonly geometries: readonly ConstructionEdgeGeometry[];
  readonly closed: boolean;
}

const LINE: ConstructionEdgeGeometry = { kind: "line" };

/** The same physical curve seen from the other end -- an arc keeps its center and flips its sweep, a chord is symmetric. */
export function reverseGeometry(geometry: ConstructionEdgeGeometry): ConstructionEdgeGeometry {
  if (geometry.kind === "line") return geometry;
  return { kind: "arc", center: geometry.center, clockwise: !geometry.clockwise };
}

/**
 * What the graph already holds, so a run can tell a boundary it may join
 * from one it must keep to itself.
 *
 * An edge bounds at most two faces, one on each side, and the engine
 * refuses a third use or a second one facing the same way. That rule is
 * about a *surface*; it is not about walls, and any number of walls may
 * legitimately meet at one column.
 */
export interface EdgeClaims {
  /** Every direction each boundary edge is currently walked in, by edge id. */
  readonly existing: ReadonlyMap<ConstructionEdgeId, readonly boolean[]>;
  /** Namespace for an edge this run has to keep to itself. Must be unique per run. */
  readonly runPrefix: string;
}

/**
 * Collects the edges a contour needs, naming each one after the *pair of
 * nodes* it runs between rather than after whichever face declared it first.
 *
 * Lexicographic order picks the same representative from either side, which
 * is what lets two panels meeting at a corner reference one vertical edge
 * used twice instead of two coincident edges used once each.
 *
 * Sharing is an optimisation, though, never the connection itself. What
 * joins two walls is referencing the same *nodes*; an edge only bounds two
 * faces, so a column where a third panel arrives -- or where two arrive
 * facing the same way -- simply has no room left on that edge. When that
 * happens this mints a run-private edge over the very same nodes instead.
 * The walls stay joined, because they were joined by the column, and
 * nothing is silently dropped for want of a name.
 */
class BoundaryEdges {
  readonly #tableId: string;
  readonly #claims: EdgeClaims;
  readonly #edges = new Map<ConstructionEdgeId, ConstructionPatchEdge>();
  readonly #claimed = new Map<ConstructionEdgeId, boolean[]>();

  constructor(tableId: string, claims: EdgeClaims) {
    this.#tableId = tableId;
    this.#claims = claims;
  }

  /** Whether `edgeId` can take one more use walked this way -- counting what the graph holds and what this run has already claimed. */
  #hasRoom(edgeId: ConstructionEdgeId, reversed: boolean): boolean {
    const graphUses = this.#claims.existing.get(edgeId) ?? [];
    const runUses = this.#claimed.get(edgeId) ?? [];
    const uses = [...graphUses, ...runUses];
    if (uses.length >= 2) return false;
    return uses[0] === undefined || uses[0] !== reversed;
  }

  /** Declares (or reuses) the edge between `from` and `to`, given that edge's geometry walked `from` -> `to`, and returns the use that walks it in that direction. */
  use(
    from: ConstructionNodeId,
    to: ConstructionNodeId,
    geometry: ConstructionEdgeGeometry,
  ): ConstructionOrientedEdgeUse {
    const forward = from < to;
    const start = forward ? from : to;
    const end = forward ? to : from;
    const reversed = !forward;

    let edgeId: ConstructionEdgeId = `${this.#tableId}:seg:${start}~${end}`;
    if (!this.#hasRoom(edgeId, reversed)) {
      edgeId = `${this.#claims.runPrefix}:seg:${start}~${end}`;
      for (let suffix = 2; !this.#hasRoom(edgeId, reversed); suffix += 1) {
        edgeId = `${this.#claims.runPrefix}:seg:${start}~${end}:${suffix}`;
      }
    }

    this.#claimed.set(edgeId, [...(this.#claimed.get(edgeId) ?? []), reversed]);
    if (!this.#edges.has(edgeId)) {
      this.#edges.set(edgeId, {
        edgeId,
        startNodeId: start,
        endNodeId: end,
        geometry: forward ? geometry : reverseGeometry(geometry),
      });
    }
    return { edgeId, reversed };
  }

  all(): readonly ConstructionPatchEdge[] {
    return [...this.#edges.values()];
  }
}

/**
 * Turns a wall run into one patch: every node it introduces, the shared
 * edges between them, and one upright panel per step.
 *
 * Each panel is declared in the order base, far column, top, near column --
 * the two columns being the vertical edges. That ordering is not decoration:
 * it is what makes a curved panel readable as a ruled strip downstream
 * instead of a ring some projection has to guess a plane for.
 *
 * Everything about what a wall *is* lives here, in TypeScript. The engine is
 * told which nodes exist, which edges connect them, and which faces sit over
 * those edges -- it is never told that any of it is a wall.
 */
export function wallPatch(
  tableId: string,
  contour: WallContour,
  surfaceType: string,
  claims: EdgeClaims,
  physical = true,
): ConstructionPatch {
  const { columns, geometries, closed } = contour;
  const stepCount = closed ? columns.length : columns.length - 1;
  if (stepCount < 1) return { nodes: [], edges: [], regions: [] };

  const nodes: { readonly id: ConstructionNodeId; readonly position: ConstructionPosition }[] = [];
  for (const column of columns) {
    nodes.push({ id: column.bottomNodeId, position: column.bottom });
    nodes.push({ id: column.topNodeId, position: column.top });
  }

  const edges = new BoundaryEdges(tableId, claims);
  const regions: ConstructionPatchRegion[] = [];

  for (let step = 0; step < stepCount; step += 1) {
    const from = columns[step];
    const to = columns[(step + 1) % columns.length];
    const geometry = geometries[step];
    if (from === undefined || to === undefined || geometry === undefined) continue;
    // A step onto the very column it left has no panel -- two coincident
    // corners of a stroke that never moved, not a wall of zero width.
    if (from.bottomNodeId === to.bottomNodeId) continue;

    const boundary: readonly ConstructionOrientedEdgeUse[] = [
      edges.use(from.bottomNodeId, to.bottomNodeId, geometry),
      edges.use(to.bottomNodeId, to.topNodeId, LINE),
      edges.use(to.topNodeId, from.topNodeId, reverseGeometry(geometry)),
      edges.use(from.topNodeId, from.bottomNodeId, LINE),
    ];
    regions.push({
      regionId: [from.bottomNodeId, to.bottomNodeId, to.topNodeId, from.topNodeId].join("|"),
      boundary,
      surfaceType,
      physical,
    });
  }

  return { nodes, edges: edges.all(), regions };
}
