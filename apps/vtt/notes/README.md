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
| [0008](0008-openings-pinned-to-host.md) | Openings pinned to their host, cut at mesh time; groups across faces; no merge | implemented |
| [0010](0010-construction-graph-is-structural-demarcation.md) | The construction graph is structural demarcation; thickness, linings and detail belong to a future asset engine | owner decision |
| [0009](0009-graph-overlay-is-debug-only.md) | Graph node dots are debug-only; edit handles and node identity must not depend on them | decision recorded, refactor pending (#318) |
| [0011](0011-terrain-cut-before-task-333.md) | The terrain cut before TASK-333: pre-branch diff of every cut file, and how to recover it | reference snapshot; cut refinement pending at epic end |
| [0012](0012-terrain-as-one-surface.md) | Terrain as one surface in 3D: every shape change is a volume edit, regenerate relays cells in a surface chart, no height per plan point | approved plan, in progress (#353) |
