import {
  attachOrbit,
  createEngine,
  createVisualRegistry,
  orbitFromCamera,
  type RenderEngine,
} from "@grafting/render-3d";
import type { GeometryCanvas, GeometryCanvasOptions } from "./contracts.js";

/**
 * Thin translation from this package's canvas contract onto
 * `@grafting/render-3d`, for arbitrary triangle geometry.
 *
 * Distinct from the heightfield canvas rather than a mode of it, because the
 * two take genuinely different inputs: a heightfield is a raster with one
 * height per cell, and geometry is positions and triangles. A grid relaxed off
 * the lattice, or terrain with a vertical step, cannot be expressed as the
 * former -- a raster holds one height per point and a step has two.
 */
export function createGeometryCanvasAdapter(
  container: HTMLElement,
  options: GeometryCanvasOptions,
): GeometryCanvas {
  const background = options.backgroundColor ?? 0x0f172a;
  const color = options.meshColor ?? 0x7fa86a;

  const registry = createVisualRegistry();
  registry.register({
    kind: "geometry",
    describe: (params: { positions: Float32Array; indices: Uint32Array }) => ({
      geometry: {
        shape: "mesh" as const,
        data: { positions: params.positions, indices: params.indices },
      },
      material: { surface: "lit" as const, color, flatShading: true },
    }),
  });

  const engine: RenderEngine = createEngine({
    registry,
    autoplay: false,
    lights: [
      { light: "ambient", intensity: 0.7 },
      { light: "directional", intensity: 0.9, direction: { x: 4, y: 8, z: 5 } },
    ],
  });
  engine.scene.defineLayer({ id: "geometry", order: 0 }, "engine");

  /**
   * Frames the geometry from its own extent.
   *
   * Computed rather than fixed because the elements feeding this produce
   * wildly different scales -- a unit grid and a terrain many units across --
   * and a fixed camera would show one of them as a speck.
   */
  const framing = (positions: Float32Array) => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let index = 0; index + 2 < positions.length; index += 3) {
      minX = Math.min(minX, positions[index]!);
      maxX = Math.max(maxX, positions[index]!);
      minY = Math.min(minY, positions[index + 1]!);
      maxY = Math.max(maxY, positions[index + 1]!);
      minZ = Math.min(minZ, positions[index + 2]!);
      maxZ = Math.max(maxZ, positions[index + 2]!);
    }
    if (!Number.isFinite(minX)) {
      return { target: { x: 0, y: 0, z: 0 }, distance: 5 };
    }
    const target = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 };
    const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 0.001);
    return { target, distance: span * 1.6 };
  };

  let frame = framing(options.positions);
  const cameraFor = (fit: typeof frame) => ({
    projection: "perspective" as const,
    fov: 40,
    position: {
      x: fit.target.x + fit.distance * 0.6,
      y: fit.target.y + fit.distance * 0.6,
      z: fit.target.z + fit.distance * 0.7,
    },
    target: fit.target,
    near: 0.01,
    far: Math.max(100, fit.distance * 10),
  });

  engine.scene.put(
    {
      id: "geometry",
      layer: "geometry",
      visual: {
        kind: "geometry",
        params: { positions: options.positions, indices: options.indices },
      },
    },
    "engine",
  );

  const view = engine.createView({ target: container, background, camera: cameraFor(frame) });

  const draw = () => engine.frame(performance.now());
  let detachOrbit: (() => void) | null = null;

  const setNavigable = (navigable: boolean) => {
    if (navigable === (detachOrbit !== null)) return;
    if (!navigable) {
      detachOrbit?.();
      detachOrbit = null;
      return;
    }
    const camera = cameraFor(frame);
    detachOrbit = attachOrbit(container, view, orbitFromCamera(camera.position, camera.target), {
      fov: camera.fov,
      near: camera.near,
      far: camera.far,
      // While navigating, these gestures belong to this canvas, so a surface
      // that pans or zooms around it never sees them.
      exclusive: true,
      // Nothing else asks for a frame here: the engine does not autoplay,
      // because geometry that only changes when the graph does has no reason
      // to be redrawn sixty times a second.
      onChange: draw,
    });
  };

  const handleResize = () => view.resize(container.clientWidth, container.clientHeight);
  window.addEventListener("resize", handleResize);
  setNavigable(options.navigable ?? false);
  draw();

  return {
    update(positions: Float32Array, indices: Uint32Array) {
      // The framing is recomputed but the camera is left alone: re-aiming it on
      // every parameter tweak would fight the user, who is usually changing a
      // parameter *in order to* compare against what they are looking at.
      frame = framing(positions);
      engine.scene.setVisualParams("geometry", { positions, indices }, "local");
      draw();
    },
    captureImage() {
      return view.capture("image/png");
    },
    setNavigable,
    resetCamera() {
      view.setCamera(cameraFor(frame));
      draw();
    },
    dispose() {
      setNavigable(false);
      window.removeEventListener("resize", handleResize);
      engine.dispose();
      container.replaceChildren();
    },
  };
}
