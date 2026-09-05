import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";

/**
 * Paints one spot on the table many times in a row against the *real*
 * construction-wasm engine, never a fake.
 *
 * This is the one bug in the joinHalo saga a mocked test could not have
 * caught: `polygon-clipping`'s sweep-line union throws
 * (`Unable to find segment ... in SweepLine tree`) when handed two polygons
 * that run almost, but not exactly, coincident along a long shared
 * boundary -- which is exactly what unioning a stroke's own swept circle
 * against the *previous* stroke's own outer perimeter produces, painted at
 * the same position. A mock's `generateIrregularQuadGrid` never produces
 * real vertex noise, so it could never reproduce the one input that broke
 * the real one. This test pays the cost of the real engine on purpose,
 * specifically to keep that class of bug from coming back silently.
 *
 * Skips (rather than fails) where `pkg/` has not been built for either wasm
 * crate -- ordinary `npm install` builds it via each crate's own
 * postinstall, but a bare `git worktree add` does not carry it, and does not
 * link it either (`pkg/` is gitignored). See
 * `project_ia_graft_cli` memory for the copy-from-main-checkout workaround
 * when developing inside a task worktree.
 */

function wasmPathFor(packageName, wasmFileName) {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve(`${packageName}/package.json`);
  return join(dirname(packageJsonPath), "pkg", wasmFileName);
}

const constructionWasmPath = wasmPathFor(
  "@grafting/procgen-construction-wasm",
  "grafting_procgen_construction_wasm_bg.wasm",
);
const generationWasmPath = wasmPathFor(
  "@grafting/procgen-generation-wasm",
  "grafting_procgen_generation_wasm_bg.wasm",
);
const wasmBuilt = existsSync(constructionWasmPath) && existsSync(generationWasmPath);

test(
  "painting the same terrain spot dozens of times never crashes and never grows without bound",
  { skip: wasmBuilt ? false : "construction-wasm/generation-wasm pkg/ not built in this checkout" },
  async () => {
    // The generated wasm-bindgen loader defaults to fetch()-ing its own
    // .wasm file by URL, which Node's fetch cannot do for file:// URLs.
    // Pre-init both modules with raw bytes read straight off disk instead;
    // the loader's own module-level singleton short-circuits the adapters'
    // later no-arg init calls once this has run.
    const [{ default: initConstructionWasm }, { default: initGenerationWasm }] = await Promise.all([
      import("@grafting/procgen-construction-wasm"),
      import("@grafting/procgen-generation-wasm"),
    ]);
    await initConstructionWasm(readFileSync(constructionWasmPath));
    await initGenerationWasm(readFileSync(generationWasmPath));

    const { createConstructionSessionAdapter, createTerrainNoiseAdapter } = await import(
      "../src/adapters/construction/index.ts"
    );
    const { AppTabletopRuntime } = await import("../src/composition/tabletop/tabletop-runtime.ts");
    const { terrainSculptTool } = await import(
      "../src/composition/tabletop/tools/terrain/terrain-sculpt-tool.ts"
    );

    const fakeRenderPort = {
      async start() {},
      attachView: () => "view-1",
      detachView() {},
      resizeView() {},
      applyConfirmed() {},
      pick: () => undefined,
      setFloorClipHeight() {},
      getMetrics: () => ({}),
      async dispose() {},
    };

    const runtime = new AppTabletopRuntime(
      "repeated-paint-table",
      fakeRenderPort,
      createConstructionSessionAdapter(),
      createTerrainNoiseAdapter(),
      [],
    );
    await runtime.start();

    const feedbackErrors = [];
    const ctx = {
      runtime,
      history: {},
      tableId: "repeated-paint-table",
      snapToGrid: false,
      nextSequence: (() => { let n = 0; return () => (n += 1); })(),
      reportSelection() {},
      reportFeedback(feedback) {
        if (feedback?.tone === "error") feedbackErrors.push(feedback);
      },
    };

    const params = {
      faceSize: 2,
      brushRadius: 6,
      irregularity: 0.7,
      minFaceSize: 1,
      joinHalo: 1,
      heightScale: 1.5,
      noiseScale: 0.15,
      targetSurface: "terrain-grass",
      seed: 1,
    };

    const point = { x: 0, y: 0, z: 0 };
    const gesture = { start: { point }, current: { point }, samples: [{ point }] };

    const nodeCounts = [];
    for (let stroke = 0; stroke < 15; stroke += 1) {
      terrainSculptTool.onPointerUp(ctx, gesture, params);
      nodeCounts.push(runtime.getSnapshot().map.nodePositions.size);
    }

    assert.deepEqual(feedbackErrors, [], "no tool-reported error across any of the repeated strokes");
    // Not an exact bound -- the point is "stays in one neighbourhood",
    // never "keeps climbing". A single stroke here settles at ~80 nodes;
    // an accumulating bug would keep adding roughly that much each time.
    const lastFew = nodeCounts.slice(-5);
    assert.ok(
      Math.max(...lastFew) - Math.min(...lastFew) < 50,
      `node count should have stabilised, not still be drifting: ${nodeCounts.join(", ")}`,
    );
    assert.ok(
      Math.max(...nodeCounts) < 300,
      `node count grew far past one stroke's own scale, suggesting unbounded accumulation: ${nodeCounts.join(", ")}`,
    );
  },
);
