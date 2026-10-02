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

/** A byte count as megabytes, one decimal. */
export function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
