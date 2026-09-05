import type { ConstructionSurfaceKey } from "@/ports";

import { scopedToolId, type ConstructionTool, type PointerSample, type ToolContext } from "../core/tool-context.ts";
import { findEnclosingRoom, type DerivedRoom } from "./room-lookup.ts";
import { findWallSurfaceAt } from "../walls/wall-shared.ts";
import { wallSpans } from "../walls/wall-spans.ts";
import { distanceToPolygonBoundaryXZ, distanceToSegmentXZ, type PointXZ } from "../shapes/geometry-2d.ts";

const OPENING_SURFACE_TYPES = new Set(["door", "window"]);
const BOUNDARY_TOLERANCE = 0.15;

/**
 * Every bounding surface key for `room`: every upright wall panel and
 * embedded opening (`door`, `window`) whose geometry lies along `room`'s
 * outer perimeter.
 *
 * Walks the live surface registry (`getAllRegionTopologies` / `wallSpans`),
 * matching wall spans and opening regions whose endpoints and midpoints sit
 * within tolerance of the room's polygon boundary. This natively recovers
 * notched wall runs (split into remainder/door/remainder pieces) and welded
 * T-junction runs, replacing the legacy cycle reconstruction that could only
 * delete plain 4-corner unnotched spans.
 */
export function roomSurfaceKeys(
  ctx: Pick<ToolContext, "runtime">,
  room: DerivedRoom,
): readonly ConstructionSurfaceKey[] {
  const keys: ConstructionSurfaceKey[] = [];
  const seen = new Set<string>();
  const addKey = (key: ConstructionSurfaceKey) => {
    const serialized = key.join("|");
    if (!seen.has(serialized)) {
      seen.add(serialized);
      keys.push(key);
    }
  };

  const spans = wallSpans(ctx as ToolContext);
  for (const span of spans) {
    const mid: PointXZ = { x: (span.a.x + span.b.x) / 2, z: (span.a.z + span.b.z) / 2 };
    if (
      distanceToPolygonBoundaryXZ(span.a, room.polygon) <= BOUNDARY_TOLERANCE &&
      distanceToPolygonBoundaryXZ(span.b, room.polygon) <= BOUNDARY_TOLERANCE &&
      distanceToPolygonBoundaryXZ(mid, room.polygon) <= BOUNDARY_TOLERANCE
    ) {
      addKey(span.surfaceKey);
    }
  }

  // Also discover openings (doors/windows) placed along the room perimeter
  if (typeof ctx.runtime.getAllRegionTopologies === "function") {
    const topologies = ctx.runtime.getAllRegionTopologies();
    for (const topology of topologies) {
      if (!OPENING_SURFACE_TYPES.has(topology.surfaceType)) continue;
      if (topology.nodes.length === 0) continue;
      let sumX = 0;
      let sumZ = 0;
      for (const node of topology.nodes) {
        sumX += node.position.x;
        sumZ += node.position.z;
      }
      const center: PointXZ = { x: sumX / topology.nodes.length, z: sumZ / topology.nodes.length };
      if (distanceToPolygonBoundaryXZ(center, room.polygon) <= BOUNDARY_TOLERANCE) {
        addKey(topology.surfaceKey);
      }
    }
  }

  return keys;
}

/**
 * Two behaviors, picked by what the click actually landed on: a click
 * directly on a wall panel (within `findWallSurfaceAt`'s own tolerance)
 * removes just that one surface and any embedded opening (`door`, `window`)
 * within it. A click anywhere else inside an enclosed room removes every
 * wall and opening bounding it, via `findEnclosingRoom` (`room-lookup.ts`)
 * turning the click into the room's boundary and {@link roomSurfaceKeys}
 * discovering all live perimeter surfaces. A click that hits neither
 * (open exterior space) is a no-op.
 */
export const houseRoomDeleteTool: ConstructionTool<"house-room-delete"> = {
  id: "house-room-delete",
  defaultParams: () => ({}),

  onClick(ctx: ToolContext, sample: PointerSample): void {
    const directHit = findWallSurfaceAt(ctx, sample.point);
    if (directHit !== undefined) {
      const sequence = ctx.nextSequence();
      ctx.runtime.removeSurface(
        { surfaceKey: directHit },
        "local",
        scopedToolId(ctx, "demolish-surface", `${sequence}:wall`),
      );

      // Also clean up any opening (door/window) embedded within this wall panel
      const spans = wallSpans(ctx);
      const hitSpan = spans.find(
        (s) => s.surfaceKey.length === directHit.length && s.surfaceKey.every((p, i) => p === directHit[i]),
      );
      if (hitSpan !== undefined && typeof ctx.runtime.getAllRegionTopologies === "function") {
        const topologies = ctx.runtime.getAllRegionTopologies();
        for (const topology of topologies) {
          if (!OPENING_SURFACE_TYPES.has(topology.surfaceType)) continue;
          if (topology.nodes.length === 0) continue;
          let sumX = 0;
          let sumZ = 0;
          for (const node of topology.nodes) {
            sumX += node.position.x;
            sumZ += node.position.z;
          }
          const center: PointXZ = { x: sumX / topology.nodes.length, z: sumZ / topology.nodes.length };
          if (distanceToSegmentXZ(center, hitSpan.a, hitSpan.b) <= BOUNDARY_TOLERANCE) {
            ctx.runtime.removeSurface(
              { surfaceKey: topology.surfaceKey },
              "local",
              scopedToolId(ctx, "demolish-opening", `${sequence}:${topology.surfaceKey.join("-")}`),
            );
          }
        }
      }
      return;
    }

    const found = findEnclosingRoom(ctx, sample.point);
    if (found === undefined) return;

    const sequence = ctx.nextSequence();
    for (const [index, surfaceKey] of roomSurfaceKeys(ctx, found).entries()) {
      ctx.runtime.removeSurface(
        { surfaceKey },
        "local",
        scopedToolId(ctx, "room-delete", `${sequence}:${index}`),
      );
    }
  },
};
