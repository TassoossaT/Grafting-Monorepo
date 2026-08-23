import type { PreviewDescriptor } from "@/features/edit-construction";
import type { ConstructionRegionTopology } from "@/ports";

// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time.
import { resolvePolicy } from "../../../../features/edit-construction/index.ts";

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
});

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
 */
export function edgeOverlayOf(
  topologies: readonly ConstructionRegionTopology[],
): readonly EdgeOverlayGroup[] {
  const byRole = new Map<string, number[]>();
  const drawn = new Set<string>();

  for (const topology of topologies) {
    const positionOf = new Map(topology.nodes.map((node) => [node.id, node.position]));
    for (const loop of [...topology.outerLoops, ...topology.holes]) {
      for (const use of loop) {
        if (drawn.has(use.edgeId)) continue;
        const start = positionOf.get(use.startNodeId);
        const end = positionOf.get(use.endNodeId);
        if (start === undefined || end === undefined) continue;
        drawn.add(use.edgeId);
        const role = resolvePolicy(topology, { kind: "edge", edgeId: use.edgeId }).role;
        const into = byRole.get(role) ?? [];
        byRole.set(role, into);
        into.push(start.x, start.y, start.z, end.x, end.y, end.z);
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
