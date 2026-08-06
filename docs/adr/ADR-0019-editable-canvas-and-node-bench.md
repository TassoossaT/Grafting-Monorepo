# ADR-0019: editable canvas boundary and the Architecture Studio node bench

- Status: Proposed
- Decision owner: repository-owner
- Decision date: 2026-08-05
- Record: DEC-057
- Supersedes: None
- Amends: ADR-0014, ADR-0016, ADR-0018
- Related: DEC-049, DEC-051, DEC-052, DEC-054, DEC-056

## Decision

`@grafting/ui`'s canvas boundary gains an editing capability, separated along
the line the package already draws elsewhere: what the *consumer* does and what
the *user* does. The returned handle always accepts programmatic mutation — add,
replace, and remove nodes and connections — because that is the caller acting on
its own data. What a user may do on the surface stays neutral until requested:
drawing and removing connections with the pointer requires an explicit editing
policy, so existing read-only consumers are unaffected by construction. Every
vendor-neutral rule from ADR-0018 continues to
apply: Rete.js stays private, no renderer type appears in a public symbol, and
the package exposes mechanism rather than a product's visual identity.

Connection ports become typed and directional. A `CanvasPortDefinition` declares
whether it is an input or an output, an opaque caller-owned `dataType` string,
how many connections it accepts, and an optional label. The canvas enforces only
structural rules it can verify without domain knowledge — direction, capacity,
self-connection, and duplicate endpoints. Whether two `dataType` values are
compatible is a product question, answered by a consumer-supplied
`onConnectRequest` callback, never by the package.

`apps/architecture-studio`'s `/lab` route becomes a dataflow node bench built on
that capability. Each laboratory element is a **node** with input and output
ports; each connection is an **edge** carrying a value from one element to the
next. An element is declared once as a product-owned `NodeKind` — identity,
ports, a declarative parameter schema, and an evaluation function — and the
bench derives its menu entry, its parameter controls, its port colors, and its
duplication behavior from that declaration. Adding a laboratory element must not
require editing bench UI code.

Parameter values belong to a node *instance*, not to its kind, so the same
element may appear several times in one graph with different settings.

Execution order and cycle detection remain authoritative in `grafting-graph-core`
(DEC-051). The bench computes no ordering of its own; it requests an evaluation
order, then walks it, caching each node's result against a hash of its parameters
and its inputs' hashes so that changing one parameter re-evaluates only the
subgraph downstream of it.

The existing `heightmap` and `terrain-quantization` trials are re-expressed as
`NodeKind`s over the same Wasm entry points they call today. Their standalone
pages remain in the repository, unlinked from the navigation, until the bench
demonstrably covers both; they are then removed in a follow-up change.

## Context

ADR-0018 chose Rete for `@grafting/ui` and recorded a deliberate constraint:
"editing plugins are introduced only for a concrete authored workflow." That
workflow now exists. The repository owner asked for a bench where each element
is isolated, its parameters are adjustable, and the effect of one element on
another is observable by connecting them — including running the same 3D
visualization with and without a noise filter in the chain.

The current `/lab` route is a gallery of links to independent trial pages. Each
trial hardcodes its own controls, its own worker call, and its own rendering.
Nothing is shared and nothing composes, so comparing two configurations means
reading two pages side by side. The parameter schema is the part that makes the
bench generic; without it, every new element would again hand-write its controls.

Ports already exist in the canvas contract but are untyped, undirected, and
created lazily — only a port that an edge already references is instantiated. A
user cannot connect to a port that no edge has used yet, which is precisely what
authoring requires.

## Consequences

- Benefit: one declaration per element yields menu, controls, ports, and copies.
- Benefit: read-only consumers (the Graph IR explorer) are unaffected, because
  editing is absent unless requested.
- Benefit: comparing configurations becomes a graph edit rather than a code edit.
- Cost: `@grafting/ui`'s public API grows a mutation surface and typed ports,
  requiring a reviewed baseline update, `ui:api-check`, and contract tests.
- Cost: all declared ports are now instantiated eagerly, so a node view with
  many ports renders more sockets than before.
- Risk: an editable graph invites cycles. Cycle detection is Rust-owned and the
  bench refuses to evaluate a cyclic graph, reporting the offending nodes
  instead of looping.
- Risk: an evaluation cache keyed on parameter and input hashes is wrong if a
  node is non-deterministic. Elements declare their inputs completely — a seed
  is a parameter, never an implicit source of randomness.
- Risk: `/lab` replacing the gallery removes the current path to the trials. The
  standalone pages stay reachable by URL during the transition.

## Evidence

- `packages/ui/src/canvas/graph/contracts.ts` declares the editing policy, the
  typed port shape, and the mutation handle.
- `packages/ui/tests/canvas.test.mjs` covers structural connection rules and the
  read-only default.
- `packages/ui/tests/snapshots/public-api.md` records the reviewed public API.
- `libs/graph/core` owns evaluation order and cycle detection.

## Migration or rollback

Migration is staged: the editing contract first, then the element registry and
generated parameter panel, then the Rust-ordered evaluation engine, then the
utility and viewport elements. Each stage is independently reviewable and leaves
the repository working.

Rollback reverts DEC-057 and the editing contract together. It must not leave a
partial mutation API exported, move ordering out of Rust, or silently delete the
standalone trial pages before the bench replaces them.
