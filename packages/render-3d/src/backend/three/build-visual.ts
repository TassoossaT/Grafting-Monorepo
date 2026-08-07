import * as THREE from "three";
import type {
  GeometryDescriptor,
  HeightfieldData,
  MaterialDescriptor,
  VisualDescriptor,
} from "../../contracts/visual.js";
import type { Transform, Vec3 } from "../../contracts/space.js";

/**
 * Translates Grafting descriptors into renderer objects.
 *
 * This file and its sibling renderer are the only places in the package that
 * import `three`. Nothing it returns escapes the package's public API, so the
 * renderer stays replaceable without any consumer noticing (DEC-049).
 */

/** A built visual and everything that must be released with it. */
export interface BuiltVisual {
  readonly object: THREE.Object3D;
  dispose(): void;
}

export function buildVisual(descriptor: VisualDescriptor): BuiltVisual {
  const geometry = buildGeometry(descriptor.geometry);
  const material = buildMaterial(descriptor.material);

  const object = buildObject(descriptor, geometry, material);

  // Picking is resolved by raycasting against the live object graph, so the
  // flag has to live on the object rather than beside it.
  object.userData.pickable = descriptor.pickable ?? true;

  return {
    object,
    dispose() {
      geometry.dispose();
      // A wireframe wraps the source geometry in a second one, which the line
      // above does not reach.
      if (object instanceof THREE.LineSegments) object.geometry.dispose();
      material.dispose();
      disposeTexture(material);
    },
  };
}

function buildObject(
  descriptor: VisualDescriptor,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
): THREE.Object3D {
  switch (descriptor.material.surface) {
    case "line":
      return new THREE.LineSegments(
        new THREE.WireframeGeometry(geometry),
        material as THREE.LineBasicMaterial,
      );
    case "points":
      // Points draw the geometry's vertices directly, so any geometry works
      // and nothing has to be converted or duplicated first.
      return new THREE.Points(geometry, material as THREE.PointsMaterial);
    default:
      return new THREE.Mesh(geometry, material);
  }
}

function buildGeometry(descriptor: GeometryDescriptor): THREE.BufferGeometry {
  switch (descriptor.shape) {
    case "plane": {
      const segments = descriptor.segments ?? 1;
      const geometry = new THREE.PlaneGeometry(
        descriptor.width,
        descriptor.depth,
        segments,
        segments,
      );
      // Engine space treats Y as up, so a plane lies flat rather than standing
      // on edge the way the renderer's default orientation would leave it.
      geometry.rotateX(-Math.PI / 2);
      return geometry;
    }
    case "box":
      return new THREE.BoxGeometry(descriptor.width, descriptor.height, descriptor.depth);
    case "sphere": {
      const segments = descriptor.segments ?? 32;
      return new THREE.SphereGeometry(descriptor.radius, segments, Math.max(2, segments >> 1));
    }
    case "cylinder": {
      const segments = descriptor.segments ?? 32;
      return new THREE.CylinderGeometry(
        descriptor.radius,
        descriptor.radius,
        descriptor.height,
        segments,
      );
    }
    case "heightfield":
      return buildHeightfieldGeometry(descriptor.field);
    case "mesh": {
      const geometry = new THREE.BufferGeometry();
      const { data } = descriptor;
      geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
      if (data.uvs) geometry.setAttribute("uv", new THREE.BufferAttribute(data.uvs, 2));
      if (data.indices) geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
      if (data.normals) {
        geometry.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
      } else {
        geometry.computeVertexNormals();
      }
      return geometry;
    }
  }
}

function buildHeightfieldGeometry(field: HeightfieldData): THREE.PlaneGeometry {
  const { width, depth, values } = field;
  const expected = width * depth;
  if (values.length < expected) {
    throw new RangeError(
      `Heightfield needs ${expected} samples for a ${width}x${depth} grid; received ${values.length}`,
    );
  }

  const sizeX = field.size?.x ?? width;
  const sizeZ = field.size?.z ?? depth;
  const elevationScale = field.elevationScale ?? 1;

  const geometry = new THREE.PlaneGeometry(sizeX, sizeZ, width - 1, depth - 1);
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.getAttribute("position");
  if (!(position instanceof THREE.BufferAttribute)) {
    throw new Error("Heightfield geometry did not expose a writable position buffer");
  }
  for (let i = 0; i < expected; i += 1) {
    position.setY(i, (values[i] ?? 0) * elevationScale);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function buildMaterial(descriptor: MaterialDescriptor): THREE.Material {
  const texture =
    "texture" in descriptor && descriptor.texture ? new THREE.Texture(descriptor.texture) : null;
  if (texture) texture.needsUpdate = true;

  switch (descriptor.surface) {
    case "lit":
      return new THREE.MeshStandardMaterial({
        color: descriptor.color ?? 0xffffff,
        opacity: descriptor.opacity ?? 1,
        transparent: (descriptor.opacity ?? 1) < 1,
        metalness: descriptor.metalness ?? 0,
        roughness: descriptor.roughness ?? 1,
        flatShading: descriptor.flatShading ?? false,
        side: descriptor.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
        map: texture,
      });
    case "unlit":
      return new THREE.MeshBasicMaterial({
        color: descriptor.color ?? 0xffffff,
        opacity: descriptor.opacity ?? 1,
        transparent: (descriptor.opacity ?? 1) < 1,
        side: descriptor.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
        map: texture,
      });
    case "line":
      return new THREE.LineBasicMaterial({
        color: descriptor.color ?? 0xffffff,
        opacity: descriptor.opacity ?? 1,
        transparent: (descriptor.opacity ?? 1) < 1,
      });
    case "points":
      return new THREE.PointsMaterial({
        color: descriptor.color ?? 0xffffff,
        opacity: descriptor.opacity ?? 1,
        transparent: (descriptor.opacity ?? 1) < 1,
        size: descriptor.size ?? 1,
        sizeAttenuation: descriptor.sizeAttenuation ?? true,
        map: texture,
        // A sprite's transparent border must cut the point out rather than
        // being drawn as opaque black, which is what makes soft or shaped
        // points possible at all.
        alphaTest: texture ? 0.5 : 0,
      });
  }
}

function disposeTexture(material: THREE.Material): void {
  const map = (material as { map?: THREE.Texture | null }).map;
  // Only textures this package created are disposed here; the caller's own
  // image source is left untouched.
  if (map) map.dispose();
}

/** Applies a Grafting transform to a built object, replacing its previous placement. */
export function applyTransform(object: THREE.Object3D, transform: Transform | undefined): void {
  const position = transform?.position;
  object.position.set(position?.x ?? 0, position?.y ?? 0, position?.z ?? 0);

  const rotation = transform?.rotation;
  object.rotation.set(rotation?.x ?? 0, rotation?.y ?? 0, rotation?.z ?? 0);

  const scale = transform?.scale ?? 1;
  if (typeof scale === "number") {
    object.scale.set(scale, scale, scale);
  } else {
    object.scale.set(scale.x, scale.y, scale.z);
  }
}

/** Converts a renderer vector back into a Grafting one, so no vendor type escapes. */
export function toVec3(vector: THREE.Vector3): Vec3 {
  return { x: vector.x, y: vector.y, z: vector.z };
}
