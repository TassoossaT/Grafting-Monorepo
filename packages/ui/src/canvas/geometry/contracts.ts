/** Configuration for {@link createGeometryCanvas}. Colors are plain numeric hex values (e.g. `0x5b8a63`). */
export interface GeometryCanvasOptions {
  /** Flat `xyz` triples. */
  readonly positions: Float32Array;
  /** Triangles indexing them. */
  readonly indices: Uint32Array;
  /** Scene background color. Defaults to `0x0f172a`. */
  readonly backgroundColor?: number;
  /** Surface color. Defaults to `0x7fa86a`. */
  readonly meshColor?: number;
  /**
   * Whether dragging and scrolling drive the camera. Defaults to `false`.
   *
   * Off by default for the same reason the heightfield canvas leaves it off:
   * this is usually embedded in a surface that pans and zooms itself, and a
   * canvas that silently swallowed those gestures would break it.
   */
  readonly navigable?: boolean;
}

/** Lifecycle handle returned by {@link createGeometryCanvas}. */
export interface GeometryCanvas {
  /** Replaces the rendered geometry, keeping the camera where the user left it. */
  update(positions: Float32Array, indices: Uint32Array): void;
  /** Captures the current frame as a PNG data URL. */
  captureImage(): string;
  /** Turns camera navigation on or off after construction. */
  setNavigable(navigable: boolean): void;
  /** Frames the geometry, whatever the user has done to the camera. */
  resetCamera(): void;
  /** Stops rendering and releases all GPU/DOM resources. */
  dispose(): void;
}
