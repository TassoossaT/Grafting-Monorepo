// What the opening tests share: a real runtime over the real WASM engine, the
// pointer dispatcher's gesture model, and the geometry probes the cut checks
// use. Product source imports "@/...", which plain Node cannot resolve, so the
// alias hook is registered here before anything that reaches it is imported.
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { createAliasResolveHook } from "./alias-resolve-hook.mjs";

registerHooks(createAliasResolveHook(new URL("../../src/", import.meta.url)));

const { initSync } = await import("../../../../libs/domains/procgen/construction-wasm/pkg/grafting_procgen_construction_wasm.js");
initSync({ module: readFileSync(new URL("../../../../libs/domains/procgen/construction-wasm/pkg/grafting_procgen_construction_wasm_bg.wasm", import.meta.url)) });

const { AppTabletopRuntime } = await import("../../src/composition/tabletop/tabletop-runtime.ts");
const { createConstructionSessionAdapter } = await import("../../src/adapters/construction/construction-session-wasm-adapter.ts");
const { createEditHistoryStack, DEFAULT_TOOL_PARAMS, hasTrait, openingStructureType } = await import("../../src/features/edit-construction/index.ts");
const { surfaceRefFromNodeSet } = await import("../../src/entities/map/index.ts");
const { gestureMoved } = await import("../../src/composition/tabletop/tools/core/tool-context.ts");
const { openingTool } = await import("../../src/composition/tabletop/tools/openings/opening-tool.ts");
const { wallLineTool } = await import("../../src/composition/tabletop/tools/walls/wall-line-tool.ts");
const { commitWallStroke } = await import("../../src/composition/tabletop/tools/walls/wall-shared.ts");

export const ref = (t) => surfaceRefFromNodeSet(t.surfaceKey);
export const isOpening = (t) => t.surfaceType === openingStructureType.surfaceType;
export const isPartition = (t) => hasTrait(t.surfaceType, "partition");
/** The group an opening piece belongs to, read from its property bag. */
export const groupOf = (t) => t.props?.group;

/** A started runtime behind a render port that only keeps pick targets and render chunks, with the opening tool reset. */
export async function harness() {
  const pickTargets = new Map();
  const chunks = new Map();
  const renderPort = {
    async start() {}, attachView: () => "v", detachView() {}, resizeView() {}, setFloorClipHeight() {}, pick: () => undefined,
    getMetrics: () => ({}), async dispose() {},
    applyConfirmed(c) {
      if (c.type === "surface-pick-target-upserted") pickTargets.set(c.target.surfaceRef, c.target.mesh);
      else if (c.type === "surface-pick-target-removed") pickTargets.delete(c.surfaceRef);
      else if (c.type === "map-chunk-upserted") chunks.set(c.chunk.chunkId, c.chunk);
      else if (c.type === "map-chunk-removed") chunks.delete(c.chunkId);
    },
  };
  const runtime = new AppTabletopRuntime("t", renderPort, createConstructionSessionAdapter(), { async start() {}, async dispose() {} }, []);
  await runtime.start();
  let seq = 0;
  const feedback = [];
  const paramUpdates = [];
  const ctx = {
    runtime, history: createEditHistoryStack(), tableId: "t", snapToGrid: false, structureEditParams: { mode: "shape" },
    nextSequence: () => ++seq, reportSelection() {}, reportFeedback: (f) => f && feedback.push(f),
    updateToolParams: (toolId, update) => paramUpdates.push({ toolId, update }),
  };
  openingTool.onCancel(ctx);
  const all = () => runtime.getAllRegionTopologies();
  return { runtime, ctx, pickTargets, chunks, feedback, paramUpdates, openings: () => all().filter(isOpening), walls: () => all().filter(isPartition) };
}

/**
 * One gesture as `use-construction-pointer.ts` fires it: down, a preview
 * and a move per later sample, up carrying the dispatcher's own `moved`,
 * and the browser's click when it did not move.
 */
export function dispatchGesture(tool, ctx, params, samples) {
  const [start] = samples;
  tool.onPointerDown?.(ctx, start, params);
  tool.previewFor?.({ start, current: start, samples: [start] }, params, ctx);
  for (let k = 1; k < samples.length; k++) {
    const gesture = { start, current: samples[k], samples: samples.slice(0, k + 1) };
    tool.previewFor?.(gesture, params, ctx);
    tool.onPointerMove?.(ctx, gesture, params);
  }
  const moved = gestureMoved(start, samples);
  tool.onPointerUp?.(ctx, { start, current: samples.at(-1), samples, moved }, params);
  if (!moved) tool.onClick?.(ctx, samples.at(-1), params);
}

/** A plain click of the opening tool at `sample`. */
export function click(ctx, sample, params) {
  dispatchGesture(openingTool, ctx, params, [sample]);
}

/** The opening standing at `point`, by its pieces' pinned rim in world space -- what a pick would report. */
export function openingRefAt(openings, point) {
  const hit = openings.find((o) => {
    const xs = o.nodes.map((n) => n.position.x), ys = o.nodes.map((n) => n.position.y), zs = o.nodes.map((n) => n.position.z);
    return point.x >= Math.min(...xs) - 1e-6 && point.x <= Math.max(...xs) + 1e-6 && point.y >= Math.min(...ys) && point.y <= Math.max(...ys)
      && point.z >= Math.min(...zs) - 1e-6 && point.z <= Math.max(...zs) + 1e-6;
  });
  return hit && ref(hit);
}

/** Presses the opening tool at `down` (picking whatever opening stands there) and releases at `up`. */
export function press(h, params, down, up = down, extra = {}) {
  const start = { point: down, surfaceRef: openingRefAt(h.openings(), down), ...extra };
  dispatchGesture(openingTool, h.ctx, params, up === down ? [start] : [start, { point: up }]);
}

export function line(ctx, a, b) {
  const params = DEFAULT_TOOL_PARAMS["wall-line"];
  wallLineTool.onPointerDown(ctx, { point: a }, params);
  wallLineTool.onPointerUp(ctx, { start: { point: a }, current: { point: b }, samples: [] }, params);
  wallLineTool.onClick?.(ctx, { point: b }, params);
}

/**
 * A stroke long and curvy enough that the free brush's fit finds real
 * corners and commits several faces instead of one smooth curve.
 */
export function curvyBrushStroke(length = 24, amplitude = 3, periods = 2.5, samples = 90) {
  return Array.from({ length: samples + 1 }, (_, i) => ({ x: (i / samples) * length, y: 0, z: amplitude * Math.sin((i / samples) * Math.PI * periods * 2) }));
}

export function curvyBrushWall(ctx, height = 3) {
  commitWallStroke(ctx, curvyBrushStroke(), 0.25, { wallType: "wall-white", height }, "wall-brush");
}

/** Point-in-polygon on `(x, y)` pairs. */
export function inPoly(x, y, pts) {
  let c = false;
  for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
    const [xi, yi] = pts[a], [xj, yj] = pts[b];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Möller-Trumbore: whether the ray from `origin` along `dir` meets `mesh` within `maxT`. */
export function hitMesh(mesh, origin, dir, maxT) {
  const P = mesh.positions, I = mesh.indices ?? Array.from({ length: P.length / 3 }, (_, i) => i);
  for (let i = 0; i < I.length; i += 3) {
    const v0 = [P[3 * I[i]], P[3 * I[i] + 1], P[3 * I[i] + 2]];
    const v1 = [P[3 * I[i + 1]], P[3 * I[i + 1] + 1], P[3 * I[i + 1] + 2]];
    const v2 = [P[3 * I[i + 2]], P[3 * I[i + 2] + 1], P[3 * I[i + 2] + 2]];
    const e1 = v1.map((x, k) => x - v0[k]), e2 = v2.map((x, k) => x - v0[k]);
    const p = [dir[1] * e2[2] - dir[2] * e2[1], dir[2] * e2[0] - dir[0] * e2[2], dir[0] * e2[1] - dir[1] * e2[0]];
    const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
    if (Math.abs(det) < 1e-12) continue;
    const tv = origin.map((x, k) => x - v0[k]);
    const u = (tv[0] * p[0] + tv[1] * p[1] + tv[2] * p[2]) / det;
    if (u < 0 || u > 1) continue;
    const q = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]];
    const v = (dir[0] * q[0] + dir[1] * q[1] + dir[2] * q[2]) / det;
    if (v < 0 || u + v > 1) continue;
    const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
    if (Math.abs(t) <= maxT) return true;
  }
  return false;
}
