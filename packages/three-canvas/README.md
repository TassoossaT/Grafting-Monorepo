# `@grafting/three-canvas`

The Grafting-owned boundary around `three`, mirroring `@grafting/x6-canvas`
(around `@antv/x6`) and `@grafting/ui` (around `antd`): third-party
rendering libraries stay behind a neutral, Grafting-owned surface; no
`THREE.*` type is exposed to consumers.

## Current capability

`createHeightfieldCanvas(container, options)` — mounts a real-time-rendered
terrain preview (a displaced plane mesh) into a container element, given a
row-major grid of height values. Built for `apps/architecture-studio`'s
generation-test surface (`/lab/heightmap`, `/lab/terrain-quantization`),
rendering real `grafting-procgen-generation-wasm` output.

```ts
import { createHeightfieldCanvas } from "@grafting/three-canvas";

const canvas = createHeightfieldCanvas(container, {
  width: 64,
  height: 64,
  values, // Float32Array, one value per cell
});

canvas.update(nextValues); // regenerate with new data, same grid size
canvas.dispose(); // release GPU/DOM resources
```

Only one capability exists today, added for a real, demonstrated consumer
need (per this package's own `AGENTS.md`) -- not a general-purpose Three.js
wrapper for the eventual free-3D VTT renderer, which remains future,
separately-designed work.
