import * as THREE from "three";
import type { HeightfieldCanvas, HeightfieldCanvasOptions } from "../index.js";
import { resolveHeightfieldOptions } from "./resolve-options.js";

function buildTerrainMesh(
  width: number,
  height: number,
  values: Float32Array,
  heightScale: number,
  planeSize: number,
  meshColor: number,
): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(planeSize, planeSize, width - 1, height - 1);
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.attributes.position;
  for (let i = 0; i < values.length; i += 1) {
    position.setY(i, values[i] * heightScale);
  }
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: meshColor,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geometry, material);
}

export function createHeightfieldCanvasAdapter(
  container: HTMLElement,
  options: HeightfieldCanvasOptions,
): HeightfieldCanvas {
  const resolved = resolveHeightfieldOptions(options);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(resolved.backgroundColor);

  const camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / Math.max(container.clientHeight, 1),
    0.1,
    100,
  );
  camera.position.set(0, 16, 20);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.replaceChildren(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(8, 14, 6);
  scene.add(sun);

  let terrain = buildTerrainMesh(
    resolved.width,
    resolved.height,
    resolved.values,
    resolved.heightScale,
    resolved.planeSize,
    resolved.meshColor,
  );
  scene.add(terrain);

  let disposed = false;
  let animationFrame = 0;
  const animate = () => {
    if (disposed) return;
    if (resolved.autoRotate) terrain.rotation.y += 0.0025;
    renderer.render(scene, camera);
    animationFrame = requestAnimationFrame(animate);
  };
  animate();

  const handleResize = () => {
    camera.aspect = container.clientWidth / Math.max(container.clientHeight, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  };
  window.addEventListener("resize", handleResize);

  return {
    update(values: Float32Array) {
      scene.remove(terrain);
      terrain.geometry.dispose();
      (terrain.material as THREE.Material).dispose();
      terrain = buildTerrainMesh(
        resolved.width,
        resolved.height,
        values,
        resolved.heightScale,
        resolved.planeSize,
        resolved.meshColor,
      );
      scene.add(terrain);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", handleResize);
      terrain.geometry.dispose();
      (terrain.material as THREE.Material).dispose();
      renderer.dispose();
      container.replaceChildren();
    },
  };
}
