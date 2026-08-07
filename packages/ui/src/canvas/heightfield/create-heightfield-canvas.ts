import {
  createEngine,
  createVisualRegistry,
  heightfieldVisual,
  type HeightfieldParams,
  type RenderEngine,
} from "@grafting/render-3d";
import type { HeightfieldCanvas, HeightfieldCanvasOptions } from "./contracts.js";
import { resolveHeightfieldOptions } from "./resolve-options.js";

/**
 * Thin translation from this package's canvas contract onto
 * `@grafting/render-3d`.
 *
 * The rendering itself moved out: a 3D engine is a capability in its own right,
 * with its own performance obligations, and keeping it inside a component
 * library made both harder to reason about. What stays here is the older
 * single-surface shape some consumers still use, expressed as a Grafting-owned
 * translation rather than as a second implementation (DEC-049).
 *
 * This shim keeps one engine — and therefore one graphics context — per
 * surface, which is the behaviour it already had. That is the limitation
 * recorded in `apps/vtt/notes/0001` section 3, and it is removed by consumers
 * moving to one shared engine with many views, not by changing this function.
 */
export function createHeightfieldCanvasAdapter(
  container: HTMLElement,
  options: HeightfieldCanvasOptions,
): HeightfieldCanvas {
  const resolved = resolveHeightfieldOptions(options);

  const registry = createVisualRegistry([heightfieldVisual as never]);
  const engine: RenderEngine = createEngine({
    registry,
    lights: [
      { light: "ambient", intensity: 0.6 },
      { light: "directional", intensity: 1.2, direction: { x: 8, y: 14, z: 6 } },
    ],
  });

  const paramsFor = (values: Float32Array): HeightfieldParams => ({
    width: resolved.width,
    depth: resolved.height,
    values,
    size: resolved.planeSize,
    elevationScale: resolved.heightScale,
    color: resolved.meshColor,
  });

  engine.scene.defineLayer({ id: "terrain", order: 0 }, "engine");
  engine.scene.put(
    {
      id: "terrain",
      layer: "terrain",
      visual: { kind: heightfieldVisual.kind, params: paramsFor(resolved.values) },
    },
    "engine",
  );

  const view = engine.createView({
    target: container,
    background: resolved.backgroundColor,
    camera: {
      projection: "perspective",
      fov: 45,
      position: { x: 0, y: 16, z: 20 },
      target: { x: 0, y: 0, z: 0 },
      far: 100,
    },
  });

  if (resolved.autoRotate) {
    // Expressed as a looping track rather than as a per-frame rotation so it
    // stops when the engine's clock is paused, like everything else.
    engine.animator.play({
      id: "auto-rotate",
      durationMs: 24_000,
      loop: true,
      apply(progress, scene) {
        scene.setTransform(
          "terrain",
          { rotation: { x: 0, y: progress * Math.PI * 2, z: 0 } },
          "engine",
        );
      },
    });
  }

  const handleResize = () => {
    view.resize(container.clientWidth, container.clientHeight);
  };
  window.addEventListener("resize", handleResize);

  engine.start();

  return {
    update(values: Float32Array) {
      engine.scene.setVisualParams("terrain", paramsFor(values), "local");
    },
    captureImage() {
      return view.capture("image/png");
    },
    dispose() {
      window.removeEventListener("resize", handleResize);
      engine.dispose();
      container.replaceChildren();
    },
  };
}
