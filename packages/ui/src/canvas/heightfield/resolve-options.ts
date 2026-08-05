import type { HeightfieldCanvasOptions } from "./contracts.js";

/** Resolved defaults for a {@link HeightfieldCanvasOptions}, with every optional field filled in. */
export interface ResolvedHeightfieldOptions {
  readonly width: number;
  readonly height: number;
  readonly values: Float32Array;
  readonly heightScale: number;
  readonly planeSize: number;
  readonly backgroundColor: number;
  readonly meshColor: number;
  readonly autoRotate: boolean;
}

/** Pure defaulting logic, kept separate from the real Wasm/GPU adapter so it is testable in Node without a WebGL context. */
export function resolveHeightfieldOptions(options: HeightfieldCanvasOptions): ResolvedHeightfieldOptions {
  return {
    width: options.width,
    height: options.height,
    values: options.values,
    heightScale: options.heightScale ?? 6,
    planeSize: options.planeSize ?? 20,
    backgroundColor: options.backgroundColor ?? 0xf7f9fc,
    meshColor: options.meshColor ?? 0x5b8a63,
    autoRotate: options.autoRotate ?? true,
  };
}
