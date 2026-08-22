/**
 * Townscaper-style irregular quad grid.
 *
 * The substrate the buildable area sits on. Everything else in the generation
 * pipeline — the WFC solve, the stacked-layer elevation, the decoration pass —
 * assumes a grid of roughly-square cells that is *not* a regular lattice. This
 * builds that grid.
 *
 * The organic quality does not come from the solve that runs later. It comes
 * from here: pairing triangles at random before quadrangulating gives cells
 * that vary in size and orientation, and relaxation then pulls them back
 * toward squares without restoring the regularity. Build the solve on a plain
 * square grid and it works perfectly and looks like a chessboard.
 *
 * The algorithm follows the sequence documented in Boris The Brave's Sylves
 * tutorial (<https://boristhebrave.com/docs/sylves/1/articles/tutorials/townscaper.html>),
 * itself a walkthrough of Oskar Stålberg's technique. Written from that
 * description rather than adapted from any implementation's source, so no
 * third-party code is carried in — see the trial's own notes for why that
 * mattered here.
 *
 * Ported verbatim from `apps/architecture-studio/src/vtt/irregular-grid.ts`
 * (2026-08-08 lab trial, tested, never wired to any UI) into `composition/tabletop/tools/`
 * so `terrain-sculpt-tool.ts` can submit its output as graph nodes/surfaces
 * through `ConstructionSessionPort`'s existing generic operations. No change
 * to the algorithm itself -- apps/architecture-studio and apps/vtt are
 * separate Nx apps with no cross-app import path today, so this is a copy,
 * not a shared package.
 *
 * PENDING (not scheduled): this stays TypeScript, unlike every other
 * procedural generator in the app (`generateTerrainCell`/`generatePathExtrusion` are
 * Rust/WASM). See `terrain-sculpt-tool.ts`'s own module doc for the port
 * plan -- this file's own share of it is close to a direct translation,
 * `apps/architecture-studio/test/irregular-grid.test.mjs` already specifies
 * the behavior to port against.
 */

/** A point on the grid plane. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** A face as indices into a vertex list, in cyclic order. */
export type Face = readonly number[];

/** A face known to have exactly four vertices. */
export type Quad = readonly [number, number, number, number];

/** A mesh of arbitrary faces, the intermediate form before quadrangulation. */
export interface FaceMesh {
  readonly vertices: readonly Vec2[];
  readonly faces: readonly Face[];
}

/** The finished all-quad grid. */
export interface QuadMesh {
  readonly vertices: readonly Vec2[];
  readonly quads: readonly Quad[];
}

/** Deterministic 0..1 source, so a given seed always yields the same grid. */
export type Random = () => number;

/**
 * Seeded generator.
 *
 * Determinism is not a convenience here. The map is replicated authoritative
 * state, so two hosts generating "the same" grid must produce identical
 * vertices, and a grid that depends on `Math.random` cannot be regenerated
 * from a saved seed.
 */
export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SQRT3_OVER_2 = Math.sqrt(3) / 2;

/** Options for {@link buildTriangleHex}. */
export interface TriangleHexOptions {
  /** Triangles along one hexagon edge. Sylves' walkthrough uses `4`. */
  readonly trianglesPerSide: number;
  /** Edge length of one equilateral triangle. Defaults to `0.5`. */
  readonly triangleSide?: number;
}

/**
 * Step 1 — a hexagon filled with equilateral triangles.
 *
 * A hexagon rather than a square because hexagons tile the plane while each
 * one stays a self-contained chunk, which is what later lets the grid extend
 * indefinitely with each chunk seeded from its own coordinates.
 */
export function buildTriangleHex(options: TriangleHexOptions): FaceMesh {
  const side = options.triangleSide ?? 0.5;
  const perSide = options.trianglesPerSide;
  if (!Number.isInteger(perSide) || perSide < 1) {
    throw new RangeError(`trianglesPerSide must be a positive integer; received ${perSide}`);
  }

  const hexRadius = perSide * side;
  const apothem = hexRadius * SQRT3_OVER_2;

  // Lattice basis. `b` is 60 degrees from `a`, which is what makes every
  // lattice triangle equilateral.
  const ax = side;
  const bx = side / 2;
  const by = side * SQRT3_OVER_2;

  const vertices: Vec2[] = [];
  const index = new Map<string, number>();
  const vertexAt = (i: number, j: number): number => {
    const key = `${i},${j}`;
    const existing = index.get(key);
    if (existing !== undefined) return existing;
    const next = vertices.length;
    vertices.push({ x: i * ax + j * bx, y: j * by });
    index.set(key, next);
    return next;
  };

  const faces: Face[] = [];
  const span = perSide + 1;
  for (let j = -span; j <= span; j += 1) {
    for (let i = -span; i <= span; i += 1) {
      // Each lattice cell holds one upward and one downward triangle.
      const upward: [number, number][] = [
        [i, j],
        [i + 1, j],
        [i, j + 1],
      ];
      const downward: [number, number][] = [
        [i + 1, j],
        [i + 1, j + 1],
        [i, j + 1],
      ];
      for (const corners of [upward, downward]) {
        const points = corners.map(([ci, cj]) => ({ x: ci * ax + cj * bx, y: cj * by }));
        if (!insideHexagon(centroidOf(points), apothem)) continue;
        faces.push(corners.map(([ci, cj]) => vertexAt(ci, cj)));
      }
    }
  }

  return { vertices, faces };
}

/**
 * A regular hexagon has three distinct edge normals, so three tests decide
 * containment rather than six.
 */
function insideHexagon(point: Vec2, apothem: number): boolean {
  const epsilon = apothem * 1e-9;
  for (const angle of [Math.PI / 6, Math.PI / 2, (5 * Math.PI) / 6]) {
    const projection = Math.abs(point.x * Math.cos(angle) + point.y * Math.sin(angle));
    if (projection > apothem + epsilon) return false;
  }
  return true;
}

function centroidOf(points: readonly Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return { x: x / points.length, y: y / points.length };
}

/**
 * Step 2 — randomly merge adjacent triangles into rhombi.
 *
 * This is the step that makes the result irregular, and it is purely
 * aesthetic: whatever stays unpaired is handled by {@link ortho} anyway. The
 * matching is greedy over a shuffled order, which leaves some triangles
 * unpaired by construction — that variation is the point, so no attempt is
 * made to maximise the matching.
 */
export function pairTriangles(mesh: FaceMesh, random: Random): FaceMesh {
  const edgeOwners = new Map<string, number[]>();
  mesh.faces.forEach((face, faceIndex) => {
    for (const [a, b] of edgesOf(face)) {
      const key = edgeKey(a, b);
      const owners = edgeOwners.get(key);
      if (owners) owners.push(faceIndex);
      else edgeOwners.set(key, [faceIndex]);
    }
  });

  const merged = new Array<boolean>(mesh.faces.length).fill(false);
  const faces: Face[] = [];

  for (const faceIndex of shuffledIndices(mesh.faces.length, random)) {
    if (merged[faceIndex]) continue;
    const face = mesh.faces[faceIndex];
    if (face === undefined) continue;

    let partner: { index: number; shared: [number, number] } | undefined;
    for (const [a, b] of shuffle(edgesOf(face), random)) {
      const owners = edgeOwners.get(edgeKey(a, b)) ?? [];
      const other = owners.find((candidate) => candidate !== faceIndex && !merged[candidate]);
      if (other !== undefined) {
        partner = { index: other, shared: [a, b] };
        break;
      }
    }

    if (partner === undefined) {
      merged[faceIndex] = true;
      faces.push(face);
      continue;
    }

    const partnerFace = mesh.faces[partner.index];
    if (partnerFace === undefined) continue;
    merged[faceIndex] = true;
    merged[partner.index] = true;
    faces.push(mergeAcrossEdge(face, partnerFace, partner.shared));
  }

  return { vertices: mesh.vertices, faces };
}

/**
 * Joins two triangles sharing an edge into one four-sided face.
 *
 * Walks the first triangle from its unshared vertex and substitutes the other
 * triangle's unshared vertex for the shared edge, which preserves winding —
 * a merged face with reversed winding would survive quadrangulation and only
 * surface later as a backwards-facing cell.
 */
function mergeAcrossEdge(a: Face, b: Face, shared: [number, number]): Face {
  const apex = a.find((vertex) => vertex !== shared[0] && vertex !== shared[1]);
  const opposite = b.find((vertex) => vertex !== shared[0] && vertex !== shared[1]);
  if (apex === undefined || opposite === undefined) return a;

  // Order the shared pair as the first triangle sees it, so the result keeps
  // that triangle's orientation.
  const position = a.indexOf(apex);
  const first = a[(position + 1) % a.length];
  const second = a[(position + 2) % a.length];
  if (first === undefined || second === undefined) return a;
  return [apex, first, opposite, second];
}

/**
 * Step 3 — Conway's ortho operator: every face becomes quads.
 *
 * A face of `n` sides yields `n` quads, each spanning one corner, the two
 * adjacent edge midpoints, and the face centre. A triangle becomes three
 * quads and a rhombus four, so nothing has to be done about faces that never
 * found a partner — the mesh is all-quad regardless of how the pairing went.
 */
export function ortho(mesh: FaceMesh): QuadMesh {
  const vertices: Vec2[] = [...mesh.vertices];
  const quads: Quad[] = [];

  for (const face of mesh.faces) {
    const points = face.map((vertex) => mesh.vertices[vertex]).filter(isVec2);
    if (points.length !== face.length) continue;

    const centre = vertices.length;
    vertices.push(centroidOf(points));

    // Midpoints are emitted per face and deduplicated later by `weld`;
    // computing them once globally would need an edge table that the weld
    // step already amounts to.
    const midpoints = face.map((vertex, position) => {
      const next = face[(position + 1) % face.length];
      const from = mesh.vertices[vertex];
      const to = next === undefined ? undefined : mesh.vertices[next];
      if (from === undefined || to === undefined) return -1;
      const index = vertices.length;
      vertices.push({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
      return index;
    });

    face.forEach((vertex, position) => {
      const ahead = midpoints[position];
      const behind = midpoints[(position - 1 + face.length) % face.length];
      if (ahead === undefined || behind === undefined || ahead < 0 || behind < 0) return;
      quads.push([vertex, ahead, centre, behind]);
    });
  }

  return { vertices, quads };
}

/**
 * Step 4 — merge coincident vertices.
 *
 * Required before relaxation rather than merely tidy: each face produced its
 * own copy of every shared edge midpoint, and until those are one vertex,
 * smoothing moves each copy independently and tears the mesh apart.
 */
export function weld(mesh: QuadMesh, epsilon = 1e-6): QuadMesh {
  const vertices: Vec2[] = [];
  const lookup = new Map<string, number>();
  const remap = new Map<number, number>();

  mesh.vertices.forEach((vertex, index) => {
    const key = `${Math.round(vertex.x / epsilon)},${Math.round(vertex.y / epsilon)}`;
    const existing = lookup.get(key);
    if (existing !== undefined) {
      remap.set(index, existing);
      return;
    }
    const next = vertices.length;
    vertices.push(vertex);
    lookup.set(key, next);
    remap.set(index, next);
  });

  const quads = mesh.quads
    .map((quad) => quad.map((vertex) => remap.get(vertex) ?? vertex) as unknown as Quad)
    // A quad whose corners collapsed onto each other is degenerate and would
    // contribute a zero-area cell to every later stage.
    .filter((quad) => new Set(quad).size === 4);

  return { vertices, quads };
}

/** Options for {@link relax}. */
export interface RelaxOptions {
  /** Smoothing passes. Around `10`-`20` settles this grid. Defaults to `12`. */
  readonly iterations?: number;
  /** Fraction of the way to the target each pass moves a vertex. Defaults to `0.5`. */
  readonly strength?: number;
  /**
   * Whether vertices on the outer boundary stay put. Defaults to `true`.
   *
   * A single chunk relaxed without pinning rounds off, because nothing outside
   * pulls back. Townscaper avoids this by relaxing across overlapping
   * neighbourhoods instead; pinning is the honest single-chunk stand-in, and
   * what a chunked implementation replaces.
   */
  readonly pinBoundary?: boolean;
}

/**
 * Step 5 — pull every cell toward a square without regularising the grid.
 *
 * For each quad the best-fit square sharing its centre is found by rotating
 * each corner back by its own quarter-turn and averaging: in a true square all
 * four land on the same point, so how far they disagree is exactly how far the
 * cell is from square. Corners then move toward where that square puts them.
 *
 * Because every vertex is pulled by all the cells it belongs to, the result is
 * a compromise — cells become square-ish while the irregular layout survives.
 * Averaging positions toward neighbours instead (ordinary Laplacian smoothing)
 * would shrink the mesh and say nothing about the shape of a cell.
 */
export function relax(mesh: QuadMesh, options: RelaxOptions = {}): QuadMesh {
  const iterations = options.iterations ?? 12;
  const strength = options.strength ?? 0.5;
  const pinned = options.pinBoundary === false ? new Set<number>() : boundaryVertices(mesh);

  let current = mesh.vertices.map((vertex) => ({ ...vertex }));

  for (let pass = 0; pass < iterations; pass += 1) {
    const sumX = new Float64Array(current.length);
    const sumY = new Float64Array(current.length);
    const counts = new Int32Array(current.length);

    for (const quad of mesh.quads) {
      const corners = quad.map((index) => current[index]).filter(isVec2);
      if (corners.length !== 4) continue;
      const centre = centroidOf(corners);

      // Average the corners after undoing each one's quarter-turn.
      let frameX = 0;
      let frameY = 0;
      corners.forEach((corner, position) => {
        const dx = corner.x - centre.x;
        const dy = corner.y - centre.y;
        const angle = (position * Math.PI) / 2;
        frameX += dx * Math.cos(angle) - dy * Math.sin(angle);
        frameY += dx * Math.sin(angle) + dy * Math.cos(angle);
      });
      frameX /= 4;
      frameY /= 4;

      quad.forEach((index, position) => {
        const angle = (-position * Math.PI) / 2;
        sumX[index] += centre.x + (frameX * Math.cos(angle) - frameY * Math.sin(angle));
        sumY[index] += centre.y + (frameX * Math.sin(angle) + frameY * Math.cos(angle));
        counts[index] += 1;
      });
    }

    current = current.map((vertex, index) => {
      const count = counts[index] ?? 0;
      if (count === 0 || pinned.has(index)) return vertex;
      const targetX = (sumX[index] ?? 0) / count;
      const targetY = (sumY[index] ?? 0) / count;
      return {
        x: vertex.x + (targetX - vertex.x) * strength,
        y: vertex.y + (targetY - vertex.y) * strength,
      };
    });
  }

  return { vertices: current, quads: mesh.quads };
}

/** Vertices on an edge belonging to exactly one quad. */
export function boundaryVertices(mesh: QuadMesh): Set<number> {
  const counts = new Map<string, number>();
  for (const quad of mesh.quads) {
    for (const [a, b] of edgesOf(quad)) {
      const key = edgeKey(a, b);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const boundary = new Set<number>();
  for (const quad of mesh.quads) {
    for (const [a, b] of edgesOf(quad)) {
      if (counts.get(edgeKey(a, b)) === 1) {
        boundary.add(a);
        boundary.add(b);
      }
    }
  }
  return boundary;
}

/** Options for {@link buildIrregularQuadGrid}. */
export interface IrregularQuadGridOptions extends TriangleHexOptions, RelaxOptions {
  readonly seed: number;
}

/** Runs the five steps in order. The whole technique, start to finish. */
export function buildIrregularQuadGrid(options: IrregularQuadGridOptions): QuadMesh {
  const random = createRandom(options.seed);
  const triangles = buildTriangleHex(options);
  const paired = pairTriangles(triangles, random);
  return relax(weld(ortho(paired)), options);
}

// ------------------------------------------------------------------ helpers

function edgesOf(face: Face): [number, number][] {
  return face.map((vertex, position) => {
    const next = face[(position + 1) % face.length] ?? vertex;
    return [vertex, next] as [number, number];
  });
}

/** Undirected, so the two faces sharing an edge agree on its name. */
function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function shuffledIndices(length: number, random: Random): number[] {
  return shuffle(
    Array.from({ length }, (_, index) => index),
    random,
  );
}

function shuffle<T>(items: readonly T[], random: Random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = result[i];
    const b = result[j];
    if (a !== undefined && b !== undefined) {
      result[i] = b;
      result[j] = a;
    }
  }
  return result;
}

function isVec2(value: Vec2 | undefined): value is Vec2 {
  return value !== undefined;
}
