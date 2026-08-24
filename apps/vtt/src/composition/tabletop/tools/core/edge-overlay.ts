import type { PreviewDescriptor } from "@/features/edit-construction";
import type { ConstructionRegionTopology } from "@/ports";

// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time.
import {
  edgeUseCounts,
  resolvePolicy,
} from "../../../../features/edit-construction/index.ts";
import { reverseGeometry } from "./boundary-edges.ts";
import { arcPointsXZ } from "../shapes/geometry-2d.ts";

/**
 * Every construction edge on the table, grouped by the role its own structure
 * type gives it.
 *
 * Node handles are drawn and edges are not, which leaves the one thing every
 * structure is actually made of invisible: you can see where the vertices are
 * but not how they were joined. A wall's post and its bottom run look the
 * same when only their endpoints show, and so do a path's spine and its rib.
 *
 * **The role comes from the type, the colour comes from here.** What an edge
 * *is* belongs to `structure-types/` -- it is the same table an edit rule
 * asks. What colour to draw it is a viewer's business and no part of the type
 * contract, so the palette lives on this side and an unknown role simply
 * falls back rather than forcing every new type to declare one.
 */

/** A palette keyed by role, with a fallback for a role nothing has named yet. */
export const EDGE_ROLE_COLORS: Readonly<Record<string, number>> = Object.freeze({
  "path-spine-edge": 0xfacc15,
  "path-contour-edge": 0x22d3ee,
  "path-rib-edge": 0xf472b6,
  "panel-bottom-edge": 0x34d399,
  "panel-top-edge": 0x818cf8,
  "panel-post": 0xfb923c,
  "organic-boundary-edge": 0x94a3b8,
  "interior-edge": 0x475569,
});

/**
 * Roles that claim an edge is on the outside of something, and so are only
 * true while it has a face on one side.
 *
 * A type names the role; whether the graph still bears it out is not the
 * type's business, because a type sees one face at a time and this is a
 * question about a pair. Left unchecked it produces the one drawing error
 * that matters here -- a rim line running through the middle of a road, kept
 * by nothing but the addresses its nodes were minted with, long after a
 * junction turned it into an interior seam.
 *
 * Any type may add to this. It is a capability, not a rule about paths.
 */
export const RIM_ROLES: ReadonlySet<string> = new Set([
  "path-contour-edge",
  "panel-bottom-edge",
  "panel-top-edge",
  "organic-boundary-edge",
]);

/** What a rim role becomes once the graph shows a face on both sides. */
export const INTERIOR_EDGE_ROLE = "interior-edge";

/** Drawn for an edge whose role no palette entry names. */
export const EDGE_FALLBACK_COLOR = 0x64748b;

/** The preview channel one role's edges are drawn on. */
export function edgeOverlayChannel(role: string): string {
  return `edges:${role}`;
}

/** One role's edges, as a flat `[x, y, z, x, y, z, ...]` segment list. */
export interface EdgeOverlayGroup {
  readonly role: string;
  readonly color: number;
  readonly positions: Float32Array;
}

/**
 * Groups every edge of every region in `topologies` by role.
 *
 * An edge shared by two faces is drawn once: it is one edge, and drawing it
 * twice would only make a shared boundary look heavier than a free one, which
 * is the opposite of the truth worth seeing.
 *
 * Sharing also settles the role. A type that named an edge as some kind of
 * rim named it from one face, and one face cannot see the other; if the graph
 * shows two, the edge is interior whatever it was called -- see
 * {@link RIM_ROLES}.
 *
 * A curved edge is drawn as the curve. Its two ends are all a segment list
 * can hold, and joining them straight draws the chord -- so every arc in the
 * table read as a straight line, which is exactly the thing the overlay
 * exists to let you check. Flattened here rather than stored flat: the edge
 * is still one edge, and only the drawing of it is subdivided.
 */
export function edgeOverlayOf(
  topologies: readonly ConstructionRegionTopology[],
): readonly EdgeOverlayGroup[] {
  const byRole = new Map<string, number[]>();
  const drawn = new Set<string>();
  const uses = edgeUseCounts(topologies);

  for (const topology of topologies) {
    const positionOf = new Map(topology.nodes.map((node) => [node.id, node.position]));
    for (const loop of [...topology.outerLoops, ...topology.holes]) {
      for (const use of loop) {
        if (drawn.has(use.edgeId)) continue;
        const start = positionOf.get(use.startNodeId);
        const end = positionOf.get(use.endNodeId);
        if (start === undefined || end === undefined) continue;
        drawn.add(use.edgeId);
        const named = resolvePolicy(topology, { kind: "edge", edgeId: use.edgeId }).role;
        // A rim with a face on both sides is not a rim. Demoted rather than
        // dropped: seeing it as an interior seam is exactly how you tell a
        // junction that closed from one that only looks closed.
        const shared = (uses.get(use.edgeId) ?? 0) > 1;
        const role = shared && RIM_ROLES.has(named) ? INTERIOR_EDGE_ROLE : named;
        const into = byRole.get(role) ?? [];
        byRole.set(role, into);
        // Walked, not stored: `startNodeId`/`endNodeId` are the loop's
        // direction while the geometry is the edge's own, so a use walked
        // backwards turns the other way round the same centre.
        const geometry = use.reversed ? reverseGeometry(use.geometry) : use.geometry;
        const along =
          geometry.kind === "arc"
            ? arcPointsXZ(start, end, geometry.center, geometry.clockwise)
            : [start, end];
        for (let step = 0; step + 1 < along.length; step += 1) {
          const from = along[step]!;
          const to = along[step + 1]!;
          into.push(from.x, from.y, from.z, to.x, to.y, to.z);
        }
      }
    }
  }

  return [...byRole].map(([role, positions]) => ({
    role,
    color: EDGE_ROLE_COLORS[role] ?? EDGE_FALLBACK_COLOR,
    positions: Float32Array.from(positions),
  }));
}

/** One group as the descriptor that draws it. */
export function edgeOverlayDescriptor(group: EdgeOverlayGroup): PreviewDescriptor {
  return { kind: "segments", positions: group.positions, color: group.color, opacity: 1 };
}
