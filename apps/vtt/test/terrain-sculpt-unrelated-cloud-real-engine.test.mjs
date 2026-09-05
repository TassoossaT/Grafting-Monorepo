import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";

/**
 * Ground truth for the bug reported live: paint near (but never touching) a
 * second, untouched mound, against the *real* construction-wasm engine,
 * never a mock. `terrain-sculpt-join-halo.test.mjs` covers the same shape
 * with a fake `getRegionTopologiesInBounds` that either always returns every
 * fixture or always returns nothing -- neither fake can tell us whether the
 * real engine's own seeded bounds walk (or its unseeded fallback) actually
 * leaves an untouched cloud's node count alone. This test pays the
 * real-engine cost on purpose to answer that directly, the same way
 * `terrain-sculpt-repeated-paint.test.mjs` does for same-spot repainting.
 *
 * The geometry is chosen to force the exact window the bug lives in: a
 * fresh click whose own footprint and halo both cover nothing (so the
 * engine gets no seed at all), while a second, fully unrelated mound's own
 * footprint still lands inside the *rectangular* bounds box the lookup pads
 * on top of the halo -- a box wider on the diagonal than the halo's own
 * circle, which is exactly the gap an unseeded engine query falls through.
 *
 * Skips (rather than fails) where `pkg/` has not been built -- see
 * `terrain-sculpt-repeated-paint.test.mjs`'s own comment for why.
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
  "a fresh, unseeded stroke never grows a second mound it neither touches nor reaches by halo",
  { skip: wasmBuilt ? false : "construction-wasm/generation-wasm pkg/ not built in this checkout" },
  async () => {
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
      "unrelated-cloud-table",
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
      tableId: "unrelated-cloud-table",
      snapToGrid: false,
      nextSequence: (() => { let n = 0; return () => (n += 1); })(),
      reportSelection() {},
      reportFeedback(feedback) {
        if (feedback?.tone === "error") feedbackErrors.push(feedback);
      },
    };

    // brushRadius 6 + faceSize 2 * joinHalo 2 = probeArea radius 10;
    // terrainStandingAround pads that by faceSize * 2 = 4 more, so the
    // engine is asked about a 14-unit-radius *box*, not circle, around the
    // stroke.
    const params = {
      faceSize: 2,
      brushRadius: 6,
      irregularity: 0.7,
      minFaceSize: 1,
      joinHalo: 2,
      heightScale: 1.5,
      noiseScale: 0.15,
      targetSurface: "terrain",
      seed: 1,
    };

    const clickAt = (x, z) => {
      const point = { x, y: 0, z };
      return { start: { point }, current: { point }, samples: [{ point }] };
    };

    // Mound B: centred so that its own footprint reaches inward along the
    // origin-to-B diagonal to about distance 18 from the origin -- well
    // outside the origin stroke's real 14-radius reach circle, but with
    // both XZ coordinates under 14, which is all a *rectangular* bounds box
    // checks.
    const CLOUD_B = { x: 17, z: 17 };
    terrainSculptTool.onPointerUp(ctx, clickAt(CLOUD_B.x, CLOUD_B.z), params);
    // Exact identity, not a bounds box: B's own footprint necessarily sits
    // close to wherever the next stroke's reach ends (that is the whole
    // point of this fixture), so a bounds-based recheck would risk folding
    // the next stroke's own new ground into "B" and hiding a real leak
    // behind that ambiguity, or manufacturing a fake one.
    const cloudBKeys = runtime.getAllRegionTopologies().map((topology) => topology.surfaceKey);
    assert.ok(cloudBKeys.length > 0, "cloud B should exist after its own stroke");
    const nodeCountsOf = (keys) =>
      keys.map((key) => runtime.getRegionTopology(key)?.nodes.length ?? -1);
    const initialCloudB = nodeCountsOf(cloudBKeys);

    // A fresh, unrelated stroke at the origin: nothing stands there yet and
    // nothing stands within its own halo either (covered and the halo's own
    // coverage are both empty), which is the one condition that sends the
    // engine into its unseeded, unfiltered bounds scan. It never touches B,
    // directly or by halo.
    terrainSculptTool.onPointerUp(ctx, clickAt(0, 0), params);

    assert.deepEqual(feedbackErrors, [], "no tool-reported error from the unrelated stroke");

    const finalCloudB = nodeCountsOf(cloudBKeys);
    assert.deepEqual(
      finalCloudB,
      initialCloudB,
      `cloud B's own node counts must stay exactly as painted -- before: [${initialCloudB}], after one unrelated stroke: [${finalCloudB}]`,
    );
  },
);
