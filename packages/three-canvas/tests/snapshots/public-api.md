# Generated TypeScript public API baseline

Package: `@grafting/three-canvas`  
TypeScript: `5.9.3`  
Source entry point: `src/index.ts`  
Documentation policy: every exported declaration and public member requires TSDoc  
Forbidden public modules: `three`

## Declaration entry point

```ts
/** Configuration for {@link createHeightfieldCanvas}. Colors are plain numeric hex values (e.g. `0x5b8a63`); no `three` type is exposed. */
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
    /** Stops rendering and releases all GPU/DOM resources. */
    dispose(): void;
}
/**
 * Mounts a real-time-rendered heightfield terrain preview into `container`,
 * the same neutral-mechanism/Grafting-owned-surface pattern
 * `@grafting/x6-canvas`'s `createReadOnlyCanvas` already establishes for
 * `@antv/x6`: `three` stays entirely private, no `THREE.*` type crosses
 * this function's signature.
 *
 * @param container - Browser element that will own the rendered canvas.
 * @param options - Grid size, height values, and replaceable presentation policy.
 * @returns A Grafting-owned handle with `update`/`dispose` operations.
 */
export declare function createHeightfieldCanvas(container: HTMLElement, options: HeightfieldCanvasOptions): HeightfieldCanvas;
```
