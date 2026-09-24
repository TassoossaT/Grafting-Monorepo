import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";

import { createAliasResolveHook } from "./support/alias-resolve-hook.mjs";
import { CREATE_INTENT, resolveIntent } from "../src/composition/tabletop/tools/core/edit-intent.ts";
import { commitWallContour } from "../src/composition/tabletop/tools/walls/wall-shared.ts";
import { surfaceRefFromNodeSet } from "../src/entities/map/index.ts";
import { DEFAULT_TOOL_PARAMS, describeHandle, faceHandles, hasTrait, panelHeightWidgetPickId } from "../src/features/edit-construction/index.ts";
import { addFace, sessionFixture } from "./platform-session-fixture.mjs";

/**
 * A press edits only through a visible edit handle of a structure the active
 * tool owns; a press anywhere else -- a face, an edge, open ground, another
 * type's handle -- creates.
 */

const ownsWalls = (surfaceType) => hasTrait(surfaceType, "partition");
const wallHandle = { id: "w:a", role: "vertex", position: { x: 0, y: 0, z: 0 }, owners: [{ surfaceType: "wall-white", surfaceKey: ["w:a", "w:b"] }] };

test("resolveIntent: a hit on an owned structure's handle edits through that handle", () => {
  const intent = resolveIntent({ nodeId: "w:a" }, ownsWalls, (id) => (id === "w:a" ? wallHandle : undefined));
  assert.equal(intent.kind, "edit");
  assert.equal(intent.target.id, "w:a");
});

test("resolveIntent: a wall face or edge hit without a handle creates", () => {
  const describe = () => assert.fail("no handle was hit, so nothing is described");
  assert.deepEqual(resolveIntent({ surfaceRef: "w:a,w:b" }, ownsWalls, describe), CREATE_INTENT);
  assert.deepEqual(resolveIntent({}, ownsWalls, describe), CREATE_INTENT);
});

test("resolveIntent: a handle of a type the tool does not own creates", () => {
  const platformHandle = { ...wallHandle, id: "p:0", owners: [{ surfaceType: "platform", surfaceKey: ["p:0"] }] };
  assert.deepEqual(resolveIntent({ nodeId: "p:0" }, ownsWalls, () => platformHandle), CREATE_INTENT);
});

test("resolveIntent: a shared node keeps only the owners the tool edits; a tool that edits nothing always creates", () => {
  const shared = { ...wallHandle, owners: [{ surfaceType: "platform", surfaceKey: ["p"] }, ...wallHandle.owners] };
  const intent = resolveIntent({ nodeId: "w:a" }, ownsWalls, () => shared);
  assert.deepEqual(intent.target.owners.map((owner) => owner.surfaceType), ["wall-white"]);
  assert.deepEqual(resolveIntent({ nodeId: "w:a" }, undefined, () => shared), CREATE_INTENT);
  assert.deepEqual(resolveIntent({ nodeId: "not-a-handle" }, ownsWalls, () => undefined), CREATE_INTENT);
});

test("real WASM: a face's handles are its vertices and panel height widgets, each describing the face it edits", () => {
  const { runtime, session } = sessionFixture();
  try {
    const wall = addFace(runtime, "wall", "wall-white", [
      { id: "w:a-bottom", position: { x: 0, y: 0, z: 0 } },
      { id: "w:b-bottom", position: { x: 4, y: 0, z: 0 } },
      { id: "w:b-top", position: { x: 4, y: 3, z: 0 } },
      { id: "w:a-top", position: { x: 0, y: 3, z: 0 } },
    ]);
    const handles = faceHandles([wall], runtime);
    assert.deepEqual(handles.filter((h) => h.role === "vertex").map((h) => h.id).sort(), ["w:a-bottom", "w:a-top", "w:b-bottom", "w:b-top"]);
    const widget = handles.find((h) => h.role === "height");
    assert.ok(widget, "the wall's top run carries a height widget");
    assert.ok([panelHeightWidgetPickId("wall:edge:2", "group"), panelHeightWidgetPickId("wall:edge:2", "single")].includes(widget.id));

    const vertex = describeHandle(runtime, "w:b-top", { x: 4, y: 3, z: 0 });
    assert.equal(vertex.role, "vertex");
    assert.deepEqual(vertex.owners.map((owner) => owner.surfaceType), ["wall-white"]);
    assert.equal(describeHandle(runtime, widget.id, widget.position).role, "height");
    assert.equal(describeHandle(runtime, "nowhere", { x: 40, y: 0, z: 40 }), undefined);
  } finally { session.free(); }
});

// Mount the actual dispatcher hook without a DOM renderer, as
// platform-pointer.test.mjs does: only React scheduling and the renderer's
// picking are substituted; pointer dispatch, the wall tool and WASM are real.
const hookUrl = new URL("../src/composition/tabletop/use-construction-pointer.ts", import.meta.url).href;
const modules = {
  react: "export const useRef=(v)=>({current:v}); export const useCallback=(f)=>f; export const useMemo=(f)=>f(); export const useEffect=(f)=>globalThis.__intentHook.effects.push(f);",
  "@/ports": 'export const TOOL_GHOST_PREVIEW_CHANNEL="ghost";',
  "../../adapters/rendering/index.ts": "export const GRID_SNAP_UNIT=1;",
  "./tools/index.ts": "export const toolFor=()=>globalThis.__intentHook.tool;",
  "./tools/core/edge-overlay.ts": "export const edgeOverlayOf=()=>[]; export const edgeOverlayChannel=(v)=>v; export const edgeOverlayDescriptor=(v)=>v;",
};
const hooks = registerHooks({ resolve(spec, context, next) {
  if (context.parentURL === hookUrl && modules[spec]) return { url: "data:text/javascript," + encodeURIComponent(modules[spec]), shortCircuit: true };
  return next(spec, context);
} });
const { useConstructionPointer } = await import(hookUrl);
hooks.deregister();
// wall-line-tool.ts reads "@/..." at runtime, which plain Node cannot resolve.
registerHooks(createAliasResolveHook(new URL("../src/", import.meta.url)));
const { wallLineTool } = await import("../src/composition/tabletop/tools/walls/wall-line-tool.ts");

const WALL = DEFAULT_TOOL_PARAMS["wall-line"];
const walls = (runtime) => runtime.getAllRegionTopologies().filter((topology) => hasTrait(topology.surfaceType, "partition"));
const tick = () => new Promise((resolve) => setTimeout(resolve, 40));

test("real pointer dispatch: with the wall tool, a press on a wall's face creates a new wall, and a press on its vertex handle edits it", async () => {
  const fixture = sessionFixture();
  const { runtime, session, ctx } = fixture;
  const effects = [], cleanups = [], captures = new Set();
  const oldWindow = globalThis.window;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.__intentHook = { effects, tool: wallLineTool };
  const hits = new Map();
  let revision = 0;
  Object.assign(runtime, {
    getSnapshot: () => ({ status: "ready", tableId: "intent", revision, map: { nodePositions: new Map() } }),
    subscribe: () => () => {},
    pick: (_view, x, y) => hits.get(`${x},${y}`),
    clearPreview() {}, showPreview() {},
  });
  const target = {
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture: (id) => captures.add(id),
    hasPointerCapture: (id) => captures.has(id),
    releasePointerCapture: (id) => captures.delete(id),
  };
  const event = (x, y) => ({ button: 0, pointerId: 1, currentTarget: target, clientX: x, clientY: y });
  try {
    commitWallContour(ctx, [{ start: { x: 0, y: 0, z: 0 }, end: { x: 4, y: 0, z: 0 }, geometry: { kind: "line" } }], WALL, "wall-line");
    const standing = walls(runtime);
    assert.ok(standing.length > 0, "the first wall stands");
    const face = standing[0];
    const corners = new Map(standing.flatMap((t) => t.nodes).map((node) => [node.id, node.position]));
    const handlers = useConstructionPointer({
      activeTool: "wall-line", toolParams: { ...DEFAULT_TOOL_PARAMS }, runtime, history: ctx.history, tableId: "intent", viewId: "view",
      snapToGrid: false, structureEditParams: { mode: "shape" }, onSelectionChange() {}, onFeedbackChange() {},
    });
    for (const effect of effects) cleanups.push(effect());

    // On the face, right next to its bottom edge -- what used to grab the edge and slide the whole wall.
    hits.set("200,300", { point: { x: 2, y: 0, z: 0 }, surfaceRef: surfaceRefFromNodeSet(face.surfaceKey) });
    hits.set("200,500", { point: { x: 2, y: 0, z: 5 } });
    handlers.onPointerMove(event(200, 300));
    assert.equal(handlers.intent(), "create", "hovering the face shows creation, not an edit");
    await tick();
    handlers.onPointerDown(event(200, 300));
    handlers.onPointerMove(event(200, 500));
    handlers.onPointerUp(event(200, 500));
    handlers.onClick(event(200, 500));
    revision += 1;
    const after = walls(runtime);
    assert.ok(after.some((t) => t.nodes.some((node) => Math.abs(node.position.z - 5) < 1e-6)), "a new wall runs out to the release point");
    for (const [id, position] of corners) {
      const now = after.flatMap((t) => t.nodes).find((node) => node.id === id)?.position;
      assert.deepEqual(now, position, `the old wall's node ${id} did not move`);
    }

    const [cornerId, corner] = [...corners].find(([, position]) => position.x === 4 && position.y === 0);
    const wallCount = walls(runtime).length;
    hits.set("400,300", { point: corner, nodeId: cornerId, surfaceRef: surfaceRefFromNodeSet(face.surfaceKey) });
    hits.set("500,300", { point: { x: 5, y: 0, z: 0 } });
    handlers.onPointerMove(event(400, 300));
    assert.equal(handlers.intent(), "edit", "hovering the vertex handle shows the edit");
    await tick();
    handlers.onPointerDown(event(400, 300));
    handlers.onPointerMove(event(500, 300));
    handlers.onPointerUp(event(500, 300));
    handlers.onClick(event(500, 300));
    const moved = walls(runtime).flatMap((t) => t.nodes).find((node) => node.id === cornerId);
    assert.ok(Math.abs(moved.position.x - 5) < 1e-6, `the grabbed corner followed the drag, at ${JSON.stringify(moved.position)}`);
    assert.equal(walls(runtime).length, wallCount, "editing through the handle created nothing");
    assert.equal(ctx.history.undo()?.kind, "region-edit", "the edit is one undo entry");
  } finally {
    for (const cleanup of cleanups) cleanup?.();
    delete globalThis.__intentHook;
    globalThis.window = oldWindow;
    session.free();
  }
});
