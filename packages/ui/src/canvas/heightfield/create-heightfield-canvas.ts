import {
  attachOrbit,
  createEngine,
  orbitFromCamera,
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

  const CAMERA = {
    projection: "perspective" as const,
    fov: 45,
    position: { x: 0, y: 16, z: 20 },
    target: { x: 0, y: 0, z: 0 },
    far: 100,
  };

  const view = engine.createView({
    target: container,
    background: resolved.backgroundColor,
    camera: CAMERA,
  });

  let autoRotating = false;
  const setAutoRotate = (on: boolean) => {
    if (on === autoRotating) return;
    autoRotating = on;
    if (on) {
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
      return;
    }
    engine.animator.stop("auto-rotate");
    // Left mid-lap the mesh would sit at whatever angle the track had reached,
    // so the camera the user then aims is aiming at an arbitrary orientation.
    engine.scene.setTransform("terrain", { rotation: { x: 0, y: 0, z: 0 } }, "engine");
    // And with the track stopped, nothing else will ask for the frame that
    // shows it back at zero.
    engine.frame(performance.now());
  };

  let detachOrbit: (() => void) | null = null;

  const setNavigable = (navigable: boolean) => {
    if (navigable === (detachOrbit !== null)) return;
    if (!navigable) {
      detachOrbit?.();
      detachOrbit = null;
      setAutoRotate(resolved.autoRotate);
      return;
    }

    // A camera the user is aiming and a mesh that keeps turning under it fight
    // each other, and the result reads as the controls being broken.
    setAutoRotate(false);

    detachOrbit = attachOrbit(container, view, orbitFromCamera(CAMERA.position, CAMERA.target), {
      fov: CAMERA.fov,
      far: CAMERA.far,
      // These gestures belong to this canvas while navigating, so the graph
      // surface underneath never sees them and the node stays put.
      exclusive: true,
      // The frame loop is driven by the host's animation frames, and turning
      // auto-rotation off leaves nothing asking for one. Without this the
      // camera moves and the picture does not, which reads exactly like the
      // controls being dead -- and did.
      onChange: () => engine.frame(performance.now()),
    });
  };

  setAutoRotate(resolved.autoRotate);
  setNavigable(resolved.navigable);

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
    setNavigable,
    resetCamera() {
      view.setCamera(CAMERA);
      engine.frame(performance.now());
    },
    dispose() {
      setNavigable(false);
      window.removeEventListener("resize", handleResize);
      engine.dispose();
      container.replaceChildren();
    },
  };
}
