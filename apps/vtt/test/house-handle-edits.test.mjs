import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { createAliasResolveHook } from "./support/alias-resolve-hook.mjs";
import { sessionFixture } from "./platform-session-fixture.mjs";
import { commitPlatformContour, platformContourTool } from "../src/composition/tabletop/tools/platform/platform-contour-tool.ts";
import { hasTrait, shownGlobalHandles } from "../src/features/edit-construction/index.ts";

registerHooks(createAliasResolveHook(new URL("../src/", import.meta.url)));
const { wallLineTool } = await import("../src/composition/tabletop/tools/walls/wall-line-tool.ts");

/**
 * A house -- walls standing on a platform -- edited by its handles in a row,
 * the walls' and the platform's: no edit is ever refused for the engine
 * finding the same node sent two ways. A wall moved whole carries the
 * platform it stands on, and the platform's nodes the wall's feet share
 * must go exactly where the wall's own motion sends them.
 */

const params = { wallType: "wall-white", height: 3 };
const layouts = {
  "walls partway along the sides": [[1, 0], [5, 0], [6, 1.5], [6, 3], [2, 4], [0, 2.5], [1, 0]],
  "an L of rooms": [[0, 0], [6, 0], [6, 4], [3, 4], [3, 2], [0, 2], [0, 0]],
};

for (const [name, points] of Object.entries(layouts)) for (const support of ["floating", "ground"]) {
  test(`a house of ${name}, on a ${support} platform, takes a row of handle edits without any refused`, () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const refused = [];
    for (let trial = 0; trial < 12; trial++) {
      const f = sessionFixture();
      Object.assign(f.runtime, { showPreview() {}, clearPreview() {} });
      try {
        commitPlatformContour(f.ctx, [[0, 0], [6, 0], [6, 4], [0, 4]].map(([x, z]) => ({ point: { x, y: 2, z } })), { mode: "create", elevation: 2, support, shape: "rectangle" });
        for (let i = 0; i + 1 < points.length; i++) {
          const start = { point: { x: points[i][0], y: 2, z: points[i][1] } }, end = { point: { x: points[i + 1][0], y: 2, z: points[i + 1][1] } };
          wallLineTool.onPointerDown(f.ctx, start, params);
          wallLineTool.onPointerUp(f.ctx, { start, current: end, samples: [start, end] }, params);
        }
        for (let op = 0; op < 5; op++) {
          const owner = rnd() < 0.7 ? "partition" : "floor";
          const handles = shownGlobalHandles({ graph: f.runtime.getGraphSnapshot(), topologies: f.runtime.getAllRegionTopologies(), cloudFor: (q) => f.runtime.cloudFor(q) })
            .filter((h) => hasTrait(h.owner, owner) && h.kind !== "detach");
          const handle = handles[Math.floor(rnd() * handles.length)];
          const tool = owner === "floor" ? platformContourTool : wallLineTool;
          const toolParams = owner === "floor" ? platformContourTool.defaultParams() : params;
          const start = { nodeId: handle.id, point: handle.position, screenX: 100, screenY: 300 };
          const dx = rnd() * 2 - 1, dz = rnd() * 2 - 1, dy = rnd() * 2 - 1;
          let current = start;
          tool.onPointerDown(f.ctx, start, toolParams);
          for (let k = 1; k <= 4; k++) {
            current = { point: { x: handle.position.x + (dx * k) / 4, y: handle.position.y, z: handle.position.z + (dz * k) / 4 }, screenX: 100 + 30 * k, screenY: 300 - dy * 10 * k };
            tool.onPointerMove(f.ctx, { start, current, samples: [start, current] }, toolParams);
          }
          tool.onPointerUp(f.ctx, { start, current, samples: [start, current] }, toolParams);
          const last = f.calls.feedback.filter(Boolean).at(-1);
          if (last?.tone === "error") refused.push(`${trial}.${op} ${owner} ${handle.kind}: ${last.message}`);
        }
      } finally { f.session.free(); }
    }
    assert.deepEqual(refused, []);
  });
}
