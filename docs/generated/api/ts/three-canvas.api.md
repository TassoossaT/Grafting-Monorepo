# three-canvas

### `interface three-canvas.HeightfieldCanvas`

Lifecycle handle returned by createHeightfieldCanvas.

### `method three-canvas.HeightfieldCanvas.dispose(): void`

Stops rendering and releases all GPU/DOM resources.

### `method three-canvas.HeightfieldCanvas.update(values: Float32Array): void`

Replaces the rendered terrain with new height values, keeping the same grid size and camera.

### `interface three-canvas.HeightfieldCanvasOptions`

Configuration for createHeightfieldCanvas. Colors are plain numeric hex values (e.g. `0x5b8a63`); no `three` type is exposed.

### `property three-canvas.HeightfieldCanvasOptions.autoRotate?: boolean`

Whether the terrain slowly auto-rotates. Defaults to `true`.

### `property three-canvas.HeightfieldCanvasOptions.backgroundColor?: number`

Scene background color. Defaults to `0xf7f9fc`.

### `property three-canvas.HeightfieldCanvasOptions.height: number`

Grid height, in cells.

### `property three-canvas.HeightfieldCanvasOptions.heightScale?: number`

Vertical displacement multiplier applied to each height value. Defaults to `6`.

### `property three-canvas.HeightfieldCanvasOptions.meshColor?: number`

Terrain mesh color. Defaults to `0x5b8a63`.

### `property three-canvas.HeightfieldCanvasOptions.planeSize?: number`

World-space size of the rendered plane. Defaults to `20`.

### `property three-canvas.HeightfieldCanvasOptions.values: Float32Array`

Row-major height values, one per cell.

### `property three-canvas.HeightfieldCanvasOptions.width: number`

Grid width, in cells.

### `function three-canvas.createHeightfieldCanvas(container: HTMLElement, options: HeightfieldCanvasOptions): HeightfieldCanvas`

Mounts a real-time-rendered heightfield terrain preview into `container`,
the same neutral-mechanism/Grafting-owned-surface pattern
`@grafting/x6-canvas`'s `createReadOnlyCanvas` already establishes for
`@antv/x6`: `three` stays entirely private, no `THREE.*` type crosses
this function's signature.
