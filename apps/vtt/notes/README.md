# VTT notes

Problems and decisions recorded before the VTT has code, so they are not
rediscovered at a scale where they hurt.

Each note states what happened, why it happened, and what the VTT must do
differently — not merely that something was once wrong. A note is resolved by
an ADR or by a design that makes it impossible, and then says so at the top.

| Note | Subject | Status |
| ---- | ------- | ------ |
| [0001](0001-rendering-and-propagation.md) | Rendering and propagation debt carried from the node bench | resolved by `VTT-RENDER-001`; implementation deferred |
| [0002](0002-fog-of-war.md) | Fog of war: three states of knowledge, and what the engine must not preclude | design recorded, not implemented |
| [0003](0003-map-render-pipeline.md) | Map render pipeline (`E3.5`): chunking, clip plane, and the still-missing surface-to-mesh derivation | implemented |
| [0004](0004-map-product-model.md) | Map product model (`E3.6`): mesh triangulation crate, no Worker yet, full-ABI port, cycle-order gap | implemented |
