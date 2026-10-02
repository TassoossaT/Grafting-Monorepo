import type * as THREE from "three";

/**
 * Whether the active clip plane has cut away the point where a ray hit
 * `object`. A ray ignores clipping planes, so the picker asks this of every
 * hit: a point on the plane's negative side is not drawn, and so is not there
 * to be picked. Only objects whose material opted in via `clippable` are cut.
 */
export function cutAwayByClip(plane: THREE.Plane, enabled: boolean, object: THREE.Object3D, point: THREE.Vector3): boolean {
  return enabled && object.userData.clippable === true && plane.distanceToPoint(point) < 0;
}
