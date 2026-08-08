/**
 * Stage 4 content: the terrain modules a tileset is composed from, and how a
 * chosen orientation becomes geometry.
 *
 * This is deliberately *not* in `libs/domains/procgen/tileset-wfc`. That crate
 * assigns modules to cells and has no concept of terrain; a tileset is content,
 * and content belongs to its consumer. Dungeon rooms would be a different file
 * against the same crate.
 *
 * # A module is a corner-height profile
 *
 * Each module gives a height at each of the unit cell's four corners. A flat
 * top is `[1, 1, 1, 1]`; a ramp is `[1, 1, 0, 0]`. That choice is what makes
 * the pieces meet: {@link placeModule} maps the unit cell onto the quad
 * bilinearly, and along a shared edge the result depends only on that edge's
 * two corners -- so two neighbours agreeing on the two heights along their
 * shared edge produce a continuous surface, whatever their other corners do.
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

/** One authored piece of terrain. */
export interface TerrainModule {
  /** Shown in the composer; also what a solved cell is reported as. */
  readonly name: string;
  /** Render colour, so a solved map is legible at a glance. */
  readonly colour: number;
  /** One socket per face: four lateral in cyclic order, then up, then down. */
  readonly sockets: readonly number[];
  /** Height at each unit-cell corner, in cell heights. */
  readonly corners: readonly number[];
  /** Relative likelihood of the module. Shared across its orientations. */
  readonly weight: number;
  /** False draws nothing at all -- how "open air" is expressed. */
  readonly visible: boolean;
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

/**
 * Builds a module's geometry in unit-cell space, already turned.
 *
 * The top surface is the corner-height profile; a skirt drops from each edge
 * to `0` so a raised cell reads as a solid box rather than a floating sheet.
 * Both are emitted for every visible module: which faces are genuinely exposed
 * is stage 2's problem, and the trial is about the tile decision, not about
 * triangle count.
 *
 * @throws RangeError if the module does not give exactly four corner heights,
 * since a partial profile would silently render as a hole in the surface.
 */
export function moduleMesh(module: TerrainModule, turns: number): ModuleMesh {
  if (module.corners.length !== MODULE_CORNERS) {
    throw new RangeError(
      `module "${module.name}" gives ${module.corners.length} corner heights, not ${MODULE_CORNERS}`,
    );
  }

  const vertices: ModuleVertex[] = [];
  const indices: number[] = [];

  // The top: one vertex per corner, at that corner's height, rotated.
  CORNER_UV.forEach(([u, v], corner) => {
    const turned = rotateUnitCell(u, v, turns);
    vertices.push({ u: turned.u, v: turned.v, height: module.corners[corner] as number });
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
      { u: a.u, v: a.v, height: module.corners[corner] as number },
      { u: b.u, v: b.v, height: module.corners[next] as number },
      { u: b.u, v: b.v, height: 0 },
      { u: a.u, v: a.v, height: 0 },
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
export const SOCKET = { LOW: 0, HIGH: 1, RISE: 2, FALL: 3, GROUND: 4, SKY: 5 } as const;

/**
 * A starting point for the composer, not a recommendation.
 *
 * Four modules over six sockets: enough for a solved map to look like
 * something, small enough to hold in your head while editing. Sockets here
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
    corners: [1, 1, 1, 1],
    weight: 6,
    visible: true,
  },
  {
    name: "hollow",
    colour: 0x6f8fb0,
    sockets: [SOCKET.LOW, SOCKET.LOW, SOCKET.LOW, SOCKET.LOW, SOCKET.SKY, SOCKET.GROUND],
    corners: [0, 0, 0, 0],
    weight: 3,
    visible: true,
  },
  {
    name: "ramp",
    colour: 0xc2a76a,
    sockets: [SOCKET.RISE, SOCKET.HIGH, SOCKET.FALL, SOCKET.LOW, SOCKET.SKY, SOCKET.GROUND],
    corners: [0, 1, 1, 0],
    weight: 2,
    visible: true,
  },
  {
    name: "corner",
    colour: 0xb98b6a,
    sockets: [SOCKET.RISE, SOCKET.HIGH, SOCKET.HIGH, SOCKET.FALL, SOCKET.SKY, SOCKET.GROUND],
    corners: [0, 1, 1, 1],
    weight: 2,
    visible: true,
  },
];

/** Socket compatibility for {@link STARTING_TILESET}. Symmetric; list once. */
export const STARTING_COMPATIBILITY: readonly (readonly [number, number])[] = [
  [SOCKET.LOW, SOCKET.LOW],
  [SOCKET.HIGH, SOCKET.HIGH],
  [SOCKET.RISE, SOCKET.FALL],
  [SOCKET.GROUND, SOCKET.SKY],
];

/**
 * The height along a module's lateral edge `face`, as the pair of corner
 * heights in that module's own cyclic order.
 *
 * Exists so the composer can show whether an authored socket actually matches
 * the geometry it labels -- the mismatch this file deliberately allows.
 */
export function edgeProfile(module: TerrainModule, face: number): readonly [number, number] {
  const from = module.corners[face % MODULE_CORNERS] as number;
  const to = module.corners[(face + 1) % MODULE_CORNERS] as number;
  return [from, to];
}
