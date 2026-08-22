import type {
  ConstructionEdgeGeometry,
  ConstructionNodeId,
  ConstructionOrientedEdgeUse,
  ConstructionPatch,
  ConstructionPatchRegion,
  ConstructionPosition,
} from "@/ports";

import { createBoundaryEdges, reverseGeometry, type EdgeSharing } from "../core/boundary-edges.ts";

export { reverseGeometry };

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
  sharing: EdgeSharing,
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

  const edges = createBoundaryEdges(tableId, sharing);
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
      edges.use(to.bottomNodeId, to.topNodeId),
      edges.use(to.topNodeId, from.topNodeId, reverseGeometry(geometry)),
      edges.use(from.topNodeId, from.bottomNodeId),
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
