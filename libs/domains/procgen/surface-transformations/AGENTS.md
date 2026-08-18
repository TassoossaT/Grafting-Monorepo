# AGENTS.md -- `grafting-procgen-surface-transformations`

This crate owns deterministic, product-neutral construction-surface
transformation planning: brush intersection, local topology refinement,
formation geometry, and fragment policy. It receives a graph/surface snapshot
and returns a generic `grafting-graph-core` replacement plan; it never mutates
a graph or registry itself.

Keep open surface types as caller-provided values. Do not add VTT UI, renderer,
WASM, or persistence behavior here. The construction WASM crate only bridges
this capability to a stateful session, while `grafting-graph-core` remains the
sole owner of generic atomic plan application and structural validation.