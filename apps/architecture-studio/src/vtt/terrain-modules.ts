/**
 * Stage 4 content: the terrain modules a tileset is composed from, and how a
 * chosen orientation becomes geometry.
 *
 * This is deliberately *not* in `libs/domains/procgen/tileset-wfc`. That crate
 * assigns modules to cells and has no concept of terrain; a tileset is content,
 * and content belongs to its consumer. Dungeon rooms would be a different file
 * against the same crate.
 *
 * # A module is a corner-height profile, or an authored mesh
 *
 * A terrain module gives a height at each of the unit cell's four corners. A
 * flat top is `[1, 1, 1, 1]`; a ramp is `[1, 1, 0, 0]`. That choice is what
 * makes the pieces meet: {@link placeModule} maps the unit cell onto the quad
 * bilinearly, and along a shared edge the result depends only on that edge's
 * two corners -- so two neighbours agreeing on the two heights along their
 * shared edge produce a continuous surface, whatever their other corners do.
 *
 * Corner heights cannot describe an underside, so a module may instead carry
 * geometry authored in the unit cell. See {@link ModuleShape}; the seam-free
 * meeting above still holds, because it is a property of the bilinear map
 * rather than of how the geometry was produced.
 *
 * Agreeing is the socket's job, and sockets are authored rather than derived.
 * Deriving them from the corner heights would make every tileset trivially
 * consistent and remove the thing worth experimenting with; the point of the
 * lab trial is to let a socket scheme be wrong in an interesting way and be
 * seen to be wrong.
 *
 * # Rotation is applied to the unit cell, not to the sockets
 *
 * The solver returns how many turns a cell's module took. Here that turn is
 * applied to the module's own `(u, v)` coordinates, which carries the corner
 * heights around with them. The two must agree: `rotateUnitCell` sends the
 * unit cell's edge `i` to edge `i + 1`, matching the crate's convention that
 * one turn moves the socket on face `i` to face `i + 1`.
 */

import type { ModuleMesh, ModuleVertex } from "./module-placement.ts";

/** Faces per module: four lateral slots, then up and down. */
export const MODULE_FACES = 6;

/** How many corners a module gives a height for. */
export const MODULE_CORNERS = 4;

/**
 * What a module's geometry actually is.
 *
 * # Why this is a union and not four corner heights
 *
 * A corner-height profile describes a *surface*: one height per corner, a top,
 * and a skirt dropped from it. That is a heightfield idea, and it survived into
 * a world whose occupancy is now a set of cells rather than a column height. It
 * cannot describe an underside, so it cannot describe an overhang's ceiling, an
 * arch, or a balcony seen from below -- however freely the occupancy is edited.
 *
 * So a module either keeps that vocabulary, which is still the right one for
 * terrain, or carries an authored mesh in unit-cell space, which is the
 * vocabulary a facade tileset needs. {@link placeModule} already accepted
 * arbitrary geometry; only the generation of it was pinned to heights.
 */
export type ModuleShape =
  /** A top surface at four corner heights, closed by a skirt. Terrain. */
  | { readonly kind: "corner-heights"; readonly corners: readonly number[] }
  /**
   * Geometry authored in the unit cell, used as given. A piece rather than a
   * surface: it owns its own underside, so it draws wherever it lands rather
   * than only where it happens to be a roof.
   */
  | { readonly kind: "mesh"; readonly mesh: ModuleMesh };

/** One authored piece of terrain. */
export interface TerrainModule {
  /** Shown in the composer; also what a solved cell is reported as. */
  readonly name: string;
  /** Render colour, so a solved map is legible at a glance. */
  readonly colour: number;
  /** One socket per face: four lateral in cyclic order, then up, then down. */
  readonly sockets: readonly number[];
  /** The geometry this module stands for. */
  readonly shape: ModuleShape;
  /** Relative likelihood of the module. Shared across its orientations. */
  readonly weight: number;
  /** False draws nothing at all -- how "open air" is expressed. */
  readonly visible: boolean;
}

/**
 * Whether a module describes a surface, and so is drawn only where it roofs
 * something, or a piece, which is drawn wherever the solver puts it.
 *
 * The renderer needs this and cannot guess it: drawing a surface at every cell
 * puts coplanar tops inside a column, and drawing a piece only at roofs makes
 * an overhang's ceiling vanish.
 */
export function isSurface(module: TerrainModule): boolean {
  return module.shape.kind === "corner-heights";
}

/**
 * Turns a unit-cell coordinate one quarter turn.
 *
 * Sends `(u, 0)` to `(1, u)`: the bottom edge becomes the right edge, so edge
 * `i` becomes edge `i + 1`. That is the crate's socket convention, and the two
 * being the same rotation is what keeps a solved map's geometry consistent
 * with the constraints that produced it.
 */
export function rotateUnitCell(u: number, v: number, turns: number): { u: number; v: number } {
  let [x, y] = [u, v];
  for (let turn = 0; turn < ((turns % 4) + 4) % 4; turn += 1) {
    [x, y] = [1 - y, x];
  }
  return { u: x, v: y };
}

/** The unit cell's corners, in the cyclic order a quad lists its own. */
const CORNER_UV: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

/** Options controlling how much of a module's sides are drawn. */
export interface MeshOptions {
  /**
   * Height the skirt drops to, in cell heights. Defaults to `0`, the module's
   * own floor.
   *
   * Only the top of a column is drawn now that the solver works on the shell,
   * so its skirt has to reach the ground rather than stopping one cell down --
   * otherwise a raised column reads as a floating sheet. Passing the column's
   * layer here is what makes it a column again.
   */
  readonly skirtBottom?: number;
}

/**
 * Builds a module's geometry in unit-cell space, already turned.
 *
 * For a corner-height module the top surface is the profile and a skirt drops
 * from each edge to {@link MeshOptions.skirtBottom}, so a raised cell reads as
 * a solid column rather than a floating sheet. For an authored mesh the
 * geometry is used as given and only turned: it owns its own underside, so
 * `skirtBottom` has nothing to act on and is ignored.
 *
 * Rotation is the same quarter turn in both cases -- {@link rotateUnitCell} is
 * orientation-preserving, so an authored mesh's winding survives it and a
 * turned piece is not inside out.
 *
 * @throws RangeError if a corner-height module does not give exactly four
 * heights, since a partial profile would silently render as a hole.
 */
export function moduleMesh(
  module: TerrainModule,
  turns: number,
  options: MeshOptions = {},
): ModuleMesh {
  if (module.shape.kind === "mesh") {
    const authored = module.shape.mesh;
    return {
      vertices: authored.vertices.map((vertex) => {
        const turned = rotateUnitCell(vertex.u, vertex.v, turns);
        return { u: turned.u, v: turned.v, height: vertex.height };
      }),
      indices: authored.indices,
    };
  }

  const corners = module.shape.corners;
  const skirtBottom = options.skirtBottom ?? 0;
  if (corners.length !== MODULE_CORNERS) {
    throw new RangeError(
      `module "${module.name}" gives ${corners.length} corner heights, not ${MODULE_CORNERS}`,
    );
  }

  const vertices: ModuleVertex[] = [];
  const indices: number[] = [];

  // The top: one vertex per corner, at that corner's height, rotated.
  CORNER_UV.forEach(([u, v], corner) => {
    const turned = rotateUnitCell(u, v, turns);
    vertices.push({ u: turned.u, v: turned.v, height: corners[corner] as number });
  });
  indices.push(0, 1, 2, 0, 2, 3);

  // The skirt: each top edge dropped to the base. Emitted as its own vertices
  // rather than reusing the top's, so the two surfaces can shade separately.
  for (let corner = 0; corner < MODULE_CORNERS; corner += 1) {
    const next = (corner + 1) % MODULE_CORNERS;
    const a = rotateUnitCell(...(CORNER_UV[corner] as [number, number]), turns);
    const b = rotateUnitCell(...(CORNER_UV[next] as [number, number]), turns);
    const base = vertices.length;
    vertices.push(
      { u: a.u, v: a.v, height: corners[corner] as number },
      { u: b.u, v: b.v, height: corners[next] as number },
      { u: b.u, v: b.v, height: skirtBottom },
      { u: a.u, v: a.v, height: skirtBottom },
    );
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  return { vertices, indices: Uint32Array.from(indices) };
}

/**
 * Packs the modules' sockets and weights into the flat arrays the wasm
 * boundary takes.
 *
 * @throws RangeError if a module declares the wrong number of faces or a
 * weight the solver cannot use. Rejecting here names the module; letting it
 * through surfaces as an opaque error from across the boundary.
 */
export function flattenModules(modules: readonly TerrainModule[]): {
  sockets: Uint32Array;
  weights: Float32Array;
} {
  const sockets = new Uint32Array(modules.length * MODULE_FACES);
  const weights = new Float32Array(modules.length);
  modules.forEach((module, index) => {
    if (module.sockets.length !== MODULE_FACES) {
      throw new RangeError(
        `module "${module.name}" declares ${module.sockets.length} faces, not ${MODULE_FACES}`,
      );
    }
    if (!Number.isFinite(module.weight) || module.weight <= 0) {
      throw new RangeError(`module "${module.name}" has a weight of ${module.weight}`);
    }
    module.sockets.forEach((socket, face) => {
      sockets[index * MODULE_FACES + face] = socket;
    });
    weights[index] = module.weight;
  });
  return { sockets, weights };
}

/** Packs socket compatibility into the flat pair array the boundary takes. */
export function flattenCompatibility(
  pairs: readonly (readonly [number, number])[],
): Uint32Array {
  const flat = new Uint32Array(pairs.length * 2);
  pairs.forEach(([left, right], index) => {
    flat[index * 2] = left;
    flat[index * 2 + 1] = right;
  });
  return flat;
}

/**
 * Socket ids used by the starting tileset, named for what they mean.
 *
 * `RISE` and `FALL` are separate on purpose. A neighbour traverses the shared
 * edge in the opposite direction, so an edge that rises in my corner order
 * falls in theirs -- a single `STEP` socket meeting itself would let a ramp
 * meet another ramp climbing the same way and open a cliff between them.
 */
/**
 * `AIR` is what a face meets when there is nothing across it -- the top of a
 * cliff, the rim, the space over a hole. It exists because the solver used to
 * be *silent* about those faces rather than constrained on them, which left the
 * visible surface the freest part of the map. A tileset can now say "this piece
 * may not be exposed"; the starting one mostly declines to, on purpose.
 */
export const SOCKET = {
  LOW: 0,
  HIGH: 1,
  RISE: 2,
  FALL: 3,
  GROUND: 4,
  SKY: 5,
  AIR: 6,
  UNDER: 7,
} as const;

/**
 * The module every air cell is pinned to. Found by name rather than by index so
 * reordering the composer's list cannot silently pin air to terrain.
 */
export const EMPTY_MODULE_NAME = "empty";

/**
 * Builds a closed box in the unit cell: a top, four sides, and -- the point of
 * it -- a bottom.
 *
 * Winding is taken from the corner-height path rather than reasoned about. The
 * top reuses that path's top quad exactly, the sides reuse its skirt pattern,
 * and the bottom is the top reversed. Copying geometry that is known to light
 * correctly is cheaper than getting handedness right from first principles, and
 * harder to get subtly wrong.
 */
function unitBox(bottom: number, top: number): ModuleMesh {
  const vertices: ModuleVertex[] = [];
  const indices: number[] = [];

  CORNER_UV.forEach(([u, v]) => vertices.push({ u, v, height: top }));
  indices.push(0, 1, 2, 0, 2, 3);

  for (let corner = 0; corner < MODULE_CORNERS; corner += 1) {
    const next = (corner + 1) % MODULE_CORNERS;
    const [au, av] = CORNER_UV[corner] as [number, number];
    const [bu, bv] = CORNER_UV[next] as [number, number];
    const base = vertices.length;
    vertices.push(
      { u: au, v: av, height: top },
      { u: bu, v: bv, height: top },
      { u: bu, v: bv, height: bottom },
      { u: au, v: av, height: bottom },
    );
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const base = vertices.length;
  CORNER_UV.forEach(([u, v]) => vertices.push({ u, v, height: bottom }));
  indices.push(base, base + 2, base + 1, base, base + 3, base + 2);

  return { vertices, indices: Uint32Array.from(indices) };
}

/**
 * A starting point for the composer, not a recommendation.
 *
 * Four terrain modules over seven sockets, plus the pinned `empty` that stands
 * for air: enough for a solved map to look like something, small enough to hold
 * in your head while editing. Sockets here
 * happen to describe the corner heights faithfully -- `flat` is `HIGH` on
 * every side, `ramp` rises on one and falls on the opposite -- so the starting
 * map is geometrically continuous, and every departure from that is one you
 * made deliberately in the composer.
 *
 * Two properties worth knowing before editing:
 *
 * - `flat` is symmetric and expands to one variant; `ramp` and `corner` are
 *   asymmetric and expand to four each. You do not author the rotations.
 * - all-`flat` is always a solution, so the starting tileset cannot be
 *   unsatisfiable. Remove `flat` and that guarantee goes with it.
 *
 * The vertical direction is deliberately unconstrained: every module shows
 * `SKY` upward and `GROUND` downward, and those are the only vertical pair, so
 * stacking never rejects anything. Constraining it is a decision for the
 * composer, not a default worth baking in.
 */
export const STARTING_TILESET: readonly TerrainModule[] = [
  {
    name: "flat",
    colour: 0x7fa86a,
    sockets: [SOCKET.HIGH, SOCKET.HIGH, SOCKET.HIGH, SOCKET.HIGH, SOCKET.SKY, SOCKET.GROUND],
    shape: { kind: "corner-heights", corners: [1, 1, 1, 1] },
    weight: 6,
    visible: true,
  },
  {
    name: "hollow",
    colour: 0x6f8fb0,
    sockets: [SOCKET.LOW, SOCKET.LOW, SOCKET.LOW, SOCKET.LOW, SOCKET.SKY, SOCKET.GROUND],
    shape: { kind: "corner-heights", corners: [0, 0, 0, 0] },
    weight: 3,
    visible: true,
  },
  {
    name: "ramp",
    colour: 0xc2a76a,
    sockets: [SOCKET.RISE, SOCKET.HIGH, SOCKET.FALL, SOCKET.LOW, SOCKET.SKY, SOCKET.GROUND],
    shape: { kind: "corner-heights", corners: [0, 1, 1, 0] },
    weight: 2,
    visible: true,
  },
  {
    name: "corner",
    colour: 0xb98b6a,
    sockets: [SOCKET.RISE, SOCKET.HIGH, SOCKET.HIGH, SOCKET.FALL, SOCKET.SKY, SOCKET.GROUND],
    shape: { kind: "corner-heights", corners: [0, 1, 1, 1] },
    weight: 2,
    visible: true,
  },
  {
    // Never chosen: every air cell is pinned to it. Its weight is therefore
    // irrelevant, and its sockets are the whole of its content.
    name: EMPTY_MODULE_NAME,
    colour: 0x000000,
    sockets: [SOCKET.AIR, SOCKET.AIR, SOCKET.AIR, SOCKET.AIR, SOCKET.AIR, SOCKET.AIR],
    shape: { kind: "corner-heights", corners: [0, 0, 0, 0] },
    weight: 1,
    visible: false,
  },
  {
    // The module the corner-height vocabulary cannot express, and the reason
    // this file now has a union: a closed box, so it has a ceiling. Its `UNDER`
    // socket meets only `AIR`, which makes it the *only* legal choice where a
    // cell has nothing beneath it -- and illegal everywhere else, so it never
    // competes with `flat` on ordinary ground.
    name: "slab",
    colour: 0x8f7fa8,
    sockets: [SOCKET.HIGH, SOCKET.HIGH, SOCKET.HIGH, SOCKET.HIGH, SOCKET.SKY, SOCKET.UNDER],
    shape: { kind: "mesh", mesh: unitBox(0, 1) },
    weight: 1,
    visible: true,
  },
];

/**
 * Socket compatibility for {@link STARTING_TILESET}. Symmetric; list once.
 *
 * `AIR` meets `HIGH`, `RISE` and `FALL`, so any of those may be a cliff face,
 * and all-`flat` remains a solution however the terrain steps. It deliberately
 * does **not** meet `LOW`: `hollow` is a depression, and a depression with one
 * side open to nothing is not a depression. That single omission is the whole
 * demonstration that exposure is now expressible -- undo it in the composer and
 * hollows return to the cliff edges, which is worth seeing once.
 */
export const STARTING_COMPATIBILITY: readonly (readonly [number, number])[] = [
  [SOCKET.LOW, SOCKET.LOW],
  [SOCKET.HIGH, SOCKET.HIGH],
  [SOCKET.RISE, SOCKET.FALL],
  [SOCKET.GROUND, SOCKET.SKY],
  [SOCKET.AIR, SOCKET.AIR],
  [SOCKET.AIR, SOCKET.HIGH],
  [SOCKET.AIR, SOCKET.RISE],
  [SOCKET.AIR, SOCKET.FALL],
  // Air resting on a solid top. Not the reverse: `GROUND` meets only `SKY`, so
  // a corner-height module may not float with nothing under it -- it has no
  // underside to show, and would read as a sheet hanging in the air.
  [SOCKET.AIR, SOCKET.SKY],
  // A ceiling, and only over air. Together with the line above this is what
  // forces `slab` exactly where an overhang exists and forbids it elsewhere.
  [SOCKET.AIR, SOCKET.UNDER],
];

/**
 * The height along a module's lateral edge `face`, as the pair of corner
 * heights in that module's own cyclic order.
 *
 * Exists so the composer can show whether an authored socket actually matches
 * the geometry it labels -- the mismatch this file deliberately allows.
 *
 * `null` for an authored mesh: a socket there labels how the piece meets its
 * neighbour, which arbitrary geometry gives no single pair of heights to check
 * against. Silence is the honest answer; inventing a pair would let the
 * composer flag correct tilesets as inconsistent.
 */
export function edgeProfile(
  module: TerrainModule,
  face: number,
): readonly [number, number] | null {
  if (module.shape.kind !== "corner-heights") return null;
  const corners = module.shape.corners;
  const from = corners[face % MODULE_CORNERS] as number;
  const to = corners[(face + 1) % MODULE_CORNERS] as number;
  return [from, to];
}
