/** Configuration for {@link createHeightfieldCanvas}. Colors are plain numeric hex values (e.g. `0x5b8a63`). */
export interface HeightfieldCanvasOptions {
  /** Grid width, in cells. */
  readonly width: number;
  /** Grid height, in cells. */
  readonly height: number;
  /** Row-major height values, one per cell. */
  readonly values: Float32Array;
  /** Vertical displacement multiplier applied to each height value. Defaults to `6`. */
  readonly heightScale?: number;
  /** World-space size of the rendered plane. Defaults to `20`. */
  readonly planeSize?: number;
  /** Scene background color. Defaults to `0xf7f9fc`. */
  readonly backgroundColor?: number;
  /** Terrain mesh color. Defaults to `0x5b8a63`. */
  readonly meshColor?: number;
  /** Whether the terrain slowly auto-rotates. Defaults to `true`. */
  readonly autoRotate?: boolean;
  /**
   * Whether dragging and scrolling drive the camera. Defaults to `false`.
   *
   * Off by default because this canvas is often embedded in a surface that
   * pans and zooms itself -- a graph node, a scrolling page -- and a canvas
   * that silently swallowed those gestures would break the surface around it.
   * A host that wants navigation asks for it, and gets exclusive use of the
   * pointer while it is on.
   */
  readonly navigable?: boolean;
}

/** Lifecycle handle returned by {@link createHeightfieldCanvas}. */
export interface HeightfieldCanvas {
  /** Replaces the rendered terrain with new height values, keeping the same grid size and camera. */
  update(values: Float32Array): void;
  /** Captures the current frame as a PNG data URL, for use as a `PreviewCard` cover image. */
  captureImage(): string;
  /**
   * Turns camera navigation on or off after construction.
   *
   * Auto-rotation stops while navigation is on: a camera the user is aiming
   * and a mesh that keeps turning under it fight each other, and the result
   * reads as the controls being broken.
   */
  setNavigable(navigable: boolean): void;
  /** Returns the camera to the framing the canvas was created with. */
  resetCamera(): void;
  /** Stops rendering and releases all GPU/DOM resources. */
  dispose(): void;
}

