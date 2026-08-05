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
}

/** Lifecycle handle returned by {@link createHeightfieldCanvas}. */
export interface HeightfieldCanvas {
  /** Replaces the rendered terrain with new height values, keeping the same grid size and camera. */
  update(values: Float32Array): void;
  /** Captures the current frame as a PNG data URL, for use as a `PreviewCard` cover image. */
  captureImage(): string;
  /** Stops rendering and releases all GPU/DOM resources. */
  dispose(): void;
}

