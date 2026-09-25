import assert from "node:assert/strict";
import test from "node:test";

import {
  createRoadMeshPreview,
  createSnapMeshPreview,
  PREVIEW_ELEVATION,
  NODE_DISK_ELEVATION,
  ROAD_PREVIEW_COLOR,
  ROAD_ERROR_COLOR,
  SNAP_DISK_COLOR,
} from "../src/composition/tabletop/tools/paths/road-preview-mesh.ts";
import { sessionFixture } from "./platform-session-fixture.mjs";
import { pathPointsTool } from "../src/composition/tabletop/tools/paths/path-points-tool.ts";
import { pathStrokeTool } from "../src/composition/tabletop/tools/paths/path-stroke-tool.ts";

test("createRoadMeshPreview generates solid ribbon quads and anchor disks with anti-clipping elevation", () => {
  const outer = [
    [-1, 0, 0], [1, 0, 0],
    [-1, 0, 5], [1, 0, 5],
  ];
  // Outer ribbon loop: left side [0,0,0], [0,0,5] then right side [2,0,5], [2,0,0]
  const mockRibbonOuter = [
    [-1, 0, 0], [-1, 0, 5],
    [1, 0, 5], [1, 0, 0],
  ];

  const descriptor = createRoadMeshPreview({
    ribbons: [{ ribbon: { outer: mockRibbonOuter } }],
    anchors: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 5 }],
    bedWidth: 2,
  });

  assert.equal(descriptor.kind, "mesh");
  assert.ok(descriptor.positions instanceof Float32Array);
  assert.ok(descriptor.indices instanceof Uint32Array);
  assert.ok(descriptor.positions.length > 0);
  assert.ok(descriptor.indices.length > 0);
  assert.equal(descriptor.color, ROAD_PREVIEW_COLOR);

  // Verify anti-clipping: all y coordinates must be elevated above 0
  for (let i = 1; i < descriptor.positions.length; i += 3) {
    const y = descriptor.positions[i];
    assert.ok(y >= PREVIEW_ELEVATION - 1e-4, `y=${y} should be at least ${PREVIEW_ELEVATION}`);
  }
});

test("createRoadMeshPreview creates straight quad fallback when curves cannot be computed", () => {
  const points = [{ x: 0, y: 1, z: 0 }, { x: 10, y: 1, z: 0 }];
  const descriptor = createRoadMeshPreview({
    fallbackPoints: points,
    anchors: points,
    bedWidth: 2,
    color: ROAD_ERROR_COLOR,
  });

  assert.equal(descriptor.kind, "mesh");
  assert.equal(descriptor.color, ROAD_ERROR_COLOR);
  assert.ok(descriptor.positions.length >= 12);
  assert.ok(descriptor.indices.length >= 6);

  // Check elevation offset
  for (let i = 1; i < descriptor.positions.length; i += 3) {
    const y = descriptor.positions[i];
    assert.ok(y >= 1 + PREVIEW_ELEVATION - 1e-4);
  }
});

test("createSnapMeshPreview generates glowing circular target at target coordinate", () => {
  const target = { x: 5, y: 2, z: -3 };
  const descriptor = createSnapMeshPreview(target, 0.5);

  assert.equal(descriptor.kind, "mesh");
  assert.equal(descriptor.color, SNAP_DISK_COLOR);
  assert.ok(descriptor.positions.length > 0);
  assert.ok(descriptor.indices.length > 0);

  // Check center and elevation
  assert.equal(descriptor.positions[0], 5);
  assert.ok(descriptor.positions[1] >= 2 + NODE_DISK_ELEVATION - 1e-4);
  assert.equal(descriptor.positions[2], -3);
});

test("pathPointsTool emits mesh preview on hover with active draft", () => {
  const f = sessionFixture();
  f.previews = new Map();
  f.runtime.showPreview = (d, c) => f.previews.set(c, d);
  f.runtime.clearPreview = (c) => f.previews.delete(c);

  const params = { ...pathPointsTool.defaultParams(), creationMode: "points", bedWidth: 1.5 };
  const origin = { point: { x: 0, y: 0, z: 0 } };
  const move1 = { point: { x: 5, y: 0, z: 5 } };

  try {
    pathPointsTool.onPointerDown(f.ctx, origin, params);
    pathPointsTool.onPointerUp(f.ctx, { start: origin, current: origin, samples: [origin] }, params);

    // Draft is now active with 1 point; previewing hover
    pathPointsTool.previewFor({ start: origin, current: move1, samples: [origin, move1] }, params, f.ctx);

    assert.ok(f.previews.has("road-points"));
    const preview = f.previews.get("road-points");
    assert.equal(preview.kind, "mesh");
    assert.ok(preview.positions.length > 20);
    assert.ok(preview.indices.length > 20);
  } finally {
    pathPointsTool.onCancel?.(f.ctx);
    f.session.free();
  }
});

test("pathStrokeTool emits mesh preview during drag", () => {
  const f = sessionFixture();
  f.previews = new Map();
  f.runtime.showPreview = (d, c) => f.previews.set(c, d);
  f.runtime.clearPreview = (c) => f.previews.delete(c);

  const params = { ...pathStrokeTool.defaultParams(), creationMode: "brush", bedWidth: 2 };
  const a = { point: { x: 0, y: 0, z: 0 } };
  const b = { point: { x: 5, y: 0, z: 0 } };
  const c = { point: { x: 10, y: 0, z: 2 } };

  try {
    pathStrokeTool.onPointerDown(f.ctx, a, params);
    pathStrokeTool.onPointerMove(f.ctx, { start: a, current: c, samples: [a, b, c] }, params);

    assert.ok(f.previews.has("road-stroke"));
    const preview = f.previews.get("road-stroke");
    assert.equal(preview.kind, "mesh");
    assert.ok(preview.positions.length > 20);
    assert.ok(preview.indices.length > 20);
  } finally {
    pathStrokeTool.onCancel?.(f.ctx);
    f.session.free();
  }
});
