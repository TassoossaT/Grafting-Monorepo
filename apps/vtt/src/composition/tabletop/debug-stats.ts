/**
 * The numbers the debug panel shows, worked out apart from the panel and from
 * the clock, so each can be tested with plain values.
 */

/** What the frame meter reports for a window of frames. */
export interface FrameStats {
  /** Frames drawn per second over the window. */
  readonly fps: number;
  /** The mean time one frame took, in milliseconds. */
  readonly meanMs: number;
  /** The longest single frame in the window, in milliseconds -- where a stutter shows. */
  readonly worstMs: number;
}

/** How long a window of frames lasts before it is reported and a new one begins. */
export const FRAME_WINDOW_MS = 500;

/**
 * Measures frames as they arrive: give it each frame's timestamp and it
 * answers with the stats of the window that just closed, or `undefined` while
 * the window is still filling.
 */
export function createFrameMeter(windowMs: number = FRAME_WINDOW_MS): (now: number) => FrameStats | undefined {
  let last: number | undefined;
  let windowStart = 0;
  let frames = 0;
  let total = 0;
  let worst = 0;
  return (now) => {
    if (last === undefined) {
      last = now;
      windowStart = now;
      return undefined;
    }
    const frame = now - last;
    last = now;
    frames += 1;
    total += frame;
    worst = Math.max(worst, frame);
    const elapsed = now - windowStart;
    if (elapsed < windowMs) return undefined;
    const stats: FrameStats = { fps: (frames * 1000) / elapsed, meanMs: total / frames, worstMs: worst };
    windowStart = now;
    frames = 0;
    total = 0;
    worst = 0;
    return stats;
  };
}

/** How many faces of one structure type there are. */
export interface TypeCount {
  readonly type: string;
  readonly count: number;
}

/** What the map is made of, counted. */
export interface MapCounts {
  readonly vertices: number;
  /** Every distinct edge: the ones faces are bounded by, and the graph's own durable ones (a spine segment) that no face bounds. */
  readonly edges: number;
  /** Of those, the edges that bound two or more faces: the seams where structures are joined. */
  readonly sharedEdges: number;
  readonly faces: number;
  /** Faces by structure type, the most numerous first. */
  readonly byType: readonly TypeCount[];
}

/** One face, as far as counting it needs: its type and the edges its loops walk. */
export interface CountedFace {
  readonly surfaceType: string;
  readonly outerLoops: readonly (readonly { readonly edgeId: string }[])[];
  readonly holes: readonly (readonly { readonly edgeId: string }[])[];
}

/**
 * Counts a graph's vertices and edges and the faces standing on it, with the
 * faces told apart by type. The graph's own edge list holds only its durable
 * generic edges; the edges a face is bounded by live in the face's loops, so
 * both are counted, each edge once.
 */
export function countMap(
  graph: { readonly nodes: readonly unknown[]; readonly edges: readonly { readonly edgeId: string }[] },
  faces: readonly CountedFace[],
): MapCounts {
  const byType = new Map<string, number>();
  const uses = new Map<string, number>();
  for (const face of faces) {
    byType.set(face.surfaceType, (byType.get(face.surfaceType) ?? 0) + 1);
    for (const loop of [...face.outerLoops, ...face.holes]) {
      for (const use of loop) uses.set(use.edgeId, (uses.get(use.edgeId) ?? 0) + 1);
    }
  }
  const distinct = new Set([...uses.keys(), ...graph.edges.map((edge) => edge.edgeId)]);
  return {
    vertices: graph.nodes.length,
    edges: distinct.size,
    sharedEdges: [...uses.values()].filter((count) => count > 1).length,
    faces: faces.length,
    byType: [...byType].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
  };
}

/** A point, as far as telling whether it moved needs. */
interface PrintedPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** One edge's walk along a face's loop, as far as telling it apart needs. */
export interface PrintedEdgeUse {
  readonly edgeId: string;
  readonly reversed: boolean;
  readonly startNodeId: string;
  readonly endNodeId: string;
  readonly geometry: unknown;
}

/** One face, as far as telling whether it changed needs. */
export interface PrintedFace {
  readonly surfaceKey: readonly string[];
  readonly surfaceType: string;
  readonly outerLoops: readonly (readonly PrintedEdgeUse[])[];
  readonly holes: readonly (readonly PrintedEdgeUse[])[];
  readonly nodes: readonly { readonly id: string; readonly position: PrintedPoint }[];
  readonly props?: unknown;
  readonly profile?: unknown;
}

/** The graph, as far as telling whether it changed needs. */
export interface PrintedGraph {
  readonly nodes: readonly { readonly id: string; readonly position: PrintedPoint; readonly pin?: unknown }[];
  readonly edges: readonly { readonly edgeId: string; readonly startNodeId: string; readonly endNodeId: string; readonly curve?: unknown }[];
}

/**
 * The map reduced to one string per element, under the element's own
 * identity: a vertex by its id, an edge by its id, a face by its node set.
 * Two prints of the same element differ exactly when the element changed.
 */
export interface MapFingerprint {
  readonly vertices: ReadonlyMap<string, string>;
  readonly edges: ReadonlyMap<string, string>;
  readonly faces: ReadonlyMap<string, { readonly type: string; readonly print: string }>;
}

/** The fingerprint of a map with nothing on it: what the first read of a table is compared with. */
export const EMPTY_FINGERPRINT: MapFingerprint = { vertices: new Map(), edges: new Map(), faces: new Map() };

/** Below a tenth of a millimetre, a vertex has not moved. */
const POSITION_DIGITS = 4;

function printPoint(point: PrintedPoint): string {
  return `${point.x.toFixed(POSITION_DIGITS)},${point.y.toFixed(POSITION_DIGITS)},${point.z.toFixed(POSITION_DIGITS)}`;
}

/** An edge use turned back to the edge's own direction, so the two faces walking one edge print it alike. */
function printEdgeUse(use: PrintedEdgeUse, at: (nodeId: string) => string): string {
  const [start, end] = use.reversed ? [use.endNodeId, use.startNodeId] : [use.startNodeId, use.endNodeId];
  return `${start}@${at(start)}>${end}@${at(end)}|${JSON.stringify(use.reversed ? reverseGeometry(use.geometry) : use.geometry)}`;
}

/** The same curve walked the other way: an arc turns the other way round, a cubic swaps its handles. */
function reverseGeometry(geometry: unknown): unknown {
  if (typeof geometry !== "object" || geometry === null) return geometry;
  const shape = geometry as { readonly kind?: string; readonly clockwise?: boolean; readonly handle1?: unknown; readonly handle2?: unknown };
  if (shape.kind === "arc") return { ...shape, clockwise: !shape.clockwise };
  if (shape.kind === "bezier") return { ...shape, handle1: shape.handle2, handle2: shape.handle1 };
  return geometry;
}

/**
 * Prints every vertex, edge and face of the map. An edge or face prints the
 * positions of its own vertices, so moving a vertex shows as a change of the
 * edges and faces it bends, not only of the vertex.
 */
export function fingerprintMap(graph: PrintedGraph, faces: readonly PrintedFace[]): MapFingerprint {
  const positions = new Map<string, string>();
  const vertices = new Map<string, string>();
  for (const node of graph.nodes) {
    const position = printPoint(node.position);
    positions.set(node.id, position);
    vertices.set(node.id, node.pin === undefined ? position : `${position}|${JSON.stringify(node.pin)}`);
  }
  for (const face of faces) {
    for (const node of face.nodes) if (!positions.has(node.id)) positions.set(node.id, printPoint(node.position));
  }
  const at = (nodeId: string) => positions.get(nodeId) ?? "?";

  const edges = new Map<string, string>();
  for (const edge of graph.edges) {
    edges.set(edge.edgeId, `${edge.startNodeId}@${at(edge.startNodeId)}>${edge.endNodeId}@${at(edge.endNodeId)}|${JSON.stringify(edge.curve ?? null)}`);
  }
  const printedFaces = new Map<string, { readonly type: string; readonly print: string }>();
  for (const face of faces) {
    const loops = [face.outerLoops, face.holes].map((group) =>
      group.map((loop) => loop.map((use) => {
        if (!edges.has(use.edgeId)) edges.set(use.edgeId, printEdgeUse(use, at));
        return `${use.edgeId}${use.reversed ? "-" : "+"}`;
      }).join(" ")).join(" / "));
    const corners = face.nodes.map((node) => `${node.id}@${at(node.id)}`).join(" ");
    const print = `${face.surfaceType}|${loops.join(" # ")}|${corners}|${JSON.stringify(face.props ?? null)}|${JSON.stringify(face.profile ?? null)}`;
    printedFaces.set([...face.surfaceKey].sort().join(","), { type: face.surfaceType, print });
  }
  return { vertices, edges, faces: printedFaces };
}

/** How many elements of one kind a change added, removed and changed in place. */
export interface ElementChange {
  readonly added: number;
  readonly removed: number;
  readonly changed: number;
}

/** The same, for the faces of one structure type. */
export interface TypeChange extends ElementChange {
  readonly type: string;
}

/** What one change did to the map. */
export interface MapChange {
  readonly vertices: ElementChange;
  readonly edges: ElementChange;
  /**
   * A face is known by its node set, so a face that gains or loses a vertex
   * reads as one removed and one added; one whose vertices only move, or
   * whose type or properties change, reads as changed.
   */
  readonly faces: ElementChange;
  /** The faces' change by type, the most touched type first; types the change left alone are not listed. */
  readonly facesByType: readonly TypeChange[];
}

function diffPrints<V>(before: ReadonlyMap<string, V>, after: ReadonlyMap<string, V>, same: (a: V, b: V) => boolean, tally?: (value: V, kind: keyof ElementChange) => void): ElementChange {
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const [id, print] of after) {
    const old = before.get(id);
    if (old === undefined) {
      added += 1;
      tally?.(print, "added");
    } else if (!same(old, print)) {
      changed += 1;
      tally?.(print, "changed");
    }
  }
  for (const [id, print] of before) {
    if (after.has(id)) continue;
    removed += 1;
    tally?.(print, "removed");
  }
  return { added, removed, changed };
}

/** Compares two prints of the map, element by element. */
export function diffMaps(before: MapFingerprint, after: MapFingerprint): MapChange {
  const sameText = (a: string, b: string) => a === b;
  const byType = new Map<string, { added: number; removed: number; changed: number }>();
  const faces = diffPrints(before.faces, after.faces, (a, b) => a.print === b.print, (face, kind) => {
    const line = byType.get(face.type) ?? { added: 0, removed: 0, changed: 0 };
    line[kind] += 1;
    byType.set(face.type, line);
  });
  const touched = (line: ElementChange) => line.added + line.removed + line.changed;
  return {
    vertices: diffPrints(before.vertices, after.vertices, sameText),
    edges: diffPrints(before.edges, after.edges, sameText),
    faces,
    facesByType: [...byType].map(([type, line]) => ({ type, ...line })).sort((a, b) => touched(b) - touched(a) || a.type.localeCompare(b.type)),
  };
}

/** Whether a change left the map exactly as it was. */
export function isNoChange(change: MapChange): boolean {
  return [change.vertices, change.edges, change.faces].every((line) => line.added === 0 && line.removed === 0 && line.changed === 0);
}

/**
 * Names a run of commits in one line: each label once, in the order it first
 * ran, with how many times it ran when that was more than once.
 */
export function nameCommits(labels: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  return [...counts].map(([label, count]) => (count > 1 ? `${label} ×${count}` : label)).join(", ");
}

/** A byte count as megabytes, one decimal. */
export function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
