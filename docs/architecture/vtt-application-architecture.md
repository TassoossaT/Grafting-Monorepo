# VTT application architecture

Specification-ID: `VTT-APP-ARCH-001`

Status: **Accepted**

Applies-to: `apps/vtt/**`

Audience: implementation agents

Decision: `DEC-061`, `ADR-0023`

Normative terms: `MUST`, `MUST NOT`, `SHOULD`, and `MAY` are requirements
ordered by strength.

## 1. Objective

Define the internal structure, dependency direction, runtime ownership, state
model, interaction protocol, rendering boundaries, and verification rules for
`apps/vtt`.

This specification governs application-specific composition. It does not
authorize VTT-specific APIs in reusable packages and does not authorize an
empty future-tree scaffold.

## 2. Non-goals

This specification does not:

- define map, token, fog, physics, movement, or game-system rules;
- select the authoritative server implementation (`GATE-004` remains open);
- select a state-management or state-machine vendor;
- fix a proposed renderer decision as accepted;
- define the internal architecture of a reusable package;
- require every conceptual directory below to exist immediately.

## 3. Architectural invariants

`VTT-ARCH-001` — `apps/vtt` MUST own VTT-specific vocabulary, workflows,
presentation, interaction policy, and capability composition.

`VTT-ARCH-002` — Reusable packages MUST expose generic mechanisms only. They
MUST NOT contain a `vtt` namespace, VTT entities, VTT operations, VTT rules, or
methods whose semantics exist exclusively for this application.

`VTT-ARCH-003` — Product concepts such as table, scene, map, surface, token,
participant, visibility, reveal area, move token, and terrain brush MUST remain
inside `apps/vtt` until a second real product proves a reusable abstraction.

`VTT-ARCH-004` — Application adapters MAY translate VTT contracts to generic
package contracts. A package or library MUST NOT import from `apps/vtt`.

`VTT-ARCH-005` — React components MUST NOT directly own Workers, render
engines, GPU resources, network sessions, operation queues, or confirmed table
projections.

`VTT-ARCH-006` — Each open table MUST have exactly one `TabletopRuntime`. That
runtime MUST own the lifecycle of the ports and adapters used by the table.

`VTT-ARCH-007` — The source tree in this specification is a placement rule,
not a scaffold instruction. A directory MUST be created only when it contains
a real implementation or test.

`VTT-ARCH-008` — Cross-slice imports MUST use the target slice's `index.ts`.
Deep imports across slices are forbidden.

`VTT-ARCH-009` — Same-layer feature-to-feature and entity-to-entity imports are
forbidden. Coordination MUST occur in composition, a widget, or an explicit
application port.

`VTT-ARCH-010` — Vendor-owned types MUST NOT cross a port, adapter, or
application UI integration boundary.

`VTT-ARCH-011` — The TypeScript application MUST NOT become a second
authoritative implementation of reusable Rust behavior. It MAY own product
orchestration, presentation projections, interaction state, and thin boundary
translations.

## 4. Placement decision

For every new symbol, an implementation agent MUST apply these checks in
order:

1. If it is a reusable calculation, algorithm, rule, validation, ordering,
   graph operation, or authoritative behavior, place it in its canonical
   generic Rust capability, not in the app.
2. If it is a generic TypeScript mechanism with a real non-VTT consumer, place
   it behind the smallest consumer-agnostic package or internal boundary.
3. If it names or coordinates the VTT product, place it in `apps/vtt`.
4. If it translates between item 3 and item 1 or 2, place it in an app adapter.
5. If none applies, stop and document the unresolved boundary before coding.

## 5. On-demand source layout

```text
apps/vtt/
  project.json
  AGENTS.md
  README.md
  src/
    app/
      (site)/
      (tabletop)/
        table/
          [tableId]/
            page.tsx
            loading.tsx
            error.tsx
            _client/
              tabletop-entry.tsx

    composition/
      tabletop/
        create-tabletop-runtime.ts
        tabletop-runtime.ts
        tabletop-snapshot.ts
        index.ts

    entities/
      scene/
      map/
      surface/
      token/
      participant/
      visibility/

    features/
      select-placeable/
      move-token/
      navigate-camera/
      paint-terrain/
      edit-surface/
      switch-scene/
      reveal-area/
      revert-operation/

    widgets/
      tabletop-viewport/
      tool-palette/
      selection-inspector/
      scene-navigator/
      status-bar/

    ports/
      table-session-port.ts
      scene-render-port.ts
      map-generation-port.ts
      asset-repository-port.ts
      table-persistence-port.ts
      index.ts

    adapters/
      session/
      rendering/
      generation/
      assets/
      persistence/

    ui/
      controls/
      panels/
      theme/
      index.ts

  tests/
    architecture/
    contracts/
    browser/
```

Only paths required by the current executable slice MUST be materialized.
Names in this tree are reserved placement examples; they are not evidence that
the corresponding product behavior has been decided or implemented.

## 6. Responsibilities and dependency direction

| Module | Responsibility | May import |
| --- | --- | --- |
| `app` | Next.js routes, server/client boundary, loading/error surfaces, route parameters | `composition`, `widgets`, `ui` |
| `composition` | Instantiate one runtime, select adapters, connect lifecycle | `adapters`, `ports`, `features`, `entities`, `widgets`, `ui` |
| `widgets` | Compose features and entities into large screen regions | `features`, `entities`, `ui` |
| `features` | User verbs/use cases, intent types, gesture transitions, cancellation, operation construction | `ports`, `entities`, `ui` |
| `entities` | VTT identifiers, normalized projections, selectors, noun-specific presentation | `ui` |
| `ports` | App-owned, vendor-neutral purposeful conversations | app-owned types only |
| `adapters` | Translate app ports/entities to generic capabilities and platform APIs | `ports`, `entities`, approved generic dependencies |
| `ui` | VTT visual primitives, theme, thin generic-presentation facades | approved generic presentation dependencies |

Additional rules:

- `app` MUST NOT contain workflows, renderer setup, Worker setup, or mutable
  table state.
- `composition/tabletop` is the sole composition root for a table.
- A feature MUST represent a user verb, not a technical subsystem.
- A widget MUST NOT instantiate an adapter.
- A port MAY name VTT concepts because it is app-local.
- An adapter MUST normalize dependency failures into app-owned errors.
- `ui` MUST NOT contain table authority, operation orchestration, or
  simulation.
- `entities` MUST NOT become an authoritative simulation implementation.

Forbidden edges include:

```text
packages/** -> apps/vtt/**
entities -> features
features/<A> -> features/<B>
entities/<A> -> entities/<B>
widgets -> adapters
React component -> Worker/render/network implementation
port -> adapter
generic package -> VTT-specific type
slice -> another slice's internal path
```

## 7. Next.js boundary

`apps/vtt` is the Next.js product host. The interactive tabletop is a
client-only route inside that host; it is not a separate Vite application.

- Pages and layouts MUST remain Server Components by default.
- The tabletop MUST enter through one narrow client boundary.
- Only the smallest module graph requiring browser APIs MAY cross that
  boundary.
- Values sent from a Server Component to the client boundary MUST be
  serializable.
- Worker and rendering initialization MUST occur through the composition root,
  never during server rendering.

## 8. Runtime contract

The following is a conceptual app-owned contract. Exact field shapes belong to
the implementation slice that first needs them.

```ts
type Unsubscribe = () => void;

interface TabletopRuntime {
  start(input: StartTabletopInput): Promise<void>;
  dispatch(intent: TabletopIntent): void;
  getSnapshot(): TabletopSnapshot;
  subscribe(listener: () => void): Unsubscribe;
  dispose(): Promise<void>;
}
```

Runtime requirements:

- `start` MUST establish one table session and one rendering runtime.
- Repeated invalid initialization MUST fail explicitly.
- `dispatch` MUST accept app-owned intents only.
- `getSnapshot` MUST return the same immutable snapshot reference while state
  is unchanged.
- `subscribe` MUST satisfy React's `useSyncExternalStore` contract.
- `dispose` MUST be idempotent.
- `dispose` MUST release listeners, pointer capture, pending work, views,
  rendering resources, Workers, buffer leases, and session resources.
- React Context MAY contain only the stable runtime reference. It MUST NOT act
  as the mutable table store.

## 9. State ownership

| State class | Owner | Permitted mutation source | Forbidden contents |
| --- | --- | --- | --- |
| `ConfirmedProjection` | `TabletopRuntime` | accepted load or confirmed projection delta | pointer samples, preview state, GPU/vendor objects |
| `InteractionSnapshot` | active feature/runtime | local intents and explicit finite gesture transitions | replacement authority for confirmed state |
| Render state | rendering adapter | confirmed render changes and local previews | React state, public app projection |
| Worker state | compute/session adapter | request lifecycle and received results | React component ownership |

`ConfirmedProjection` MUST be normalized by entity ID and expose revisions at
the smallest useful dependency scope. It MUST be independent of the React
component tree.

`InteractionSnapshot` MAY contain selection, active tool, one discriminated
gesture state, pending operation IDs, camera state, and recoverable errors.
Independent booleans representing mutually exclusive gesture states are
forbidden.

## 10. Message vocabulary

| Term | Meaning |
| --- | --- |
| `PointerEvent` | Browser input sample at the input boundary |
| `FeatureIntent` | App request produced from UI/input |
| `Operation` | VTT mutation request submitted through the session port |
| `DomainEvent` | Confirmed semantic result from the authoritative execution boundary |
| `ProjectionDelta` | App projection update derived from confirmed results |
| `RenderChange` | Minimal rendering change derived from projection or preview state |
| `ChangeOrigin` | Exactly `local`, `network`, or `programmatic` in the app vocabulary |

These terms MUST NOT be collapsed into one generic `event` type. An adapter
MUST translate differing generic-package origin names at its boundary.

A global event bus is forbidden. A queue MAY exist only at a Worker or network
boundary where temporal decoupling is required.

## 11. Required ports

```ts
interface TableSessionPort {
  load(tableId: TableId, signal: AbortSignal): Promise<TableLoadResult>;
  submit(
    operation: Operation,
    signal: AbortSignal,
  ): Promise<OperationReceipt>;
  observe(listener: (delta: ConfirmedDelta) => void): Unsubscribe;
  dispose(): Promise<void>;
}

interface SceneRenderPort {
  attachView(target: RenderTarget): ViewId;
  detachView(viewId: ViewId): void;
  resizeView(viewId: ViewId, size: ViewSize): void;
  applyConfirmed(change: RenderChange): void;
  showPreview(preview: InteractionPreview): void;
  clearPreview(previewId: PreviewId): void;
  pick(viewId: ViewId, point: ViewPoint): PickResult;
  dispose(): Promise<void>;
}
```

- Port types MUST be Grafting-owned.
- Ports MUST express app needs, not mirror vendor APIs.
- `OperationReceipt` MUST distinguish accepted, rejected, and cancelled.
- Late results for cancelled or disposed runtime generations MUST be ignored.
- The session port MUST NOT select the future authoritative host or transport.
- The render port MUST NOT expose the concrete renderer package.

Additional ports (`MapGenerationPort`, `AssetRepositoryPort`, and
`TablePersistencePort`) MUST be created only with their first real consumer.

## 12. Gesture protocol

Every pointer-driven feature MUST use an explicit discriminated union or state
machine. Pointer Events and pointer capture MUST be used for mouse, touch, and
stylus input.

### 12.1 Move token

```text
idle
  -> armed(pointerId, tokenId, origin)
  -> dragging(pointerId, tokenId, origin, preview)
  -> committing(operationId, tokenId, preview)
  -> idle
```

Required behavior:

1. `pointerdown` performs picking and captures the pointer.
2. `pointermove` changes preview state only.
3. Pointer samples MUST NOT mutate `ConfirmedProjection`.
4. `pointerup` after a semantic drag creates exactly one operation; release
   without a semantic delta creates none.
5. Acceptance changes the confirmed projection.
6. Rejection clears the preview and restores confirmed presentation.
7. `pointercancel`, Escape, tool switch, and unmount create zero operations.
8. Every terminal path releases pointer capture.

### 12.2 Terrain brush

- High-frequency samples and preview MUST remain outside React state.
- Samples MUST accumulate inside the active gesture.
- `pointerup` MUST submit one batch operation when the accumulated brush has a
  semantic delta; an empty/no-op brush submits none.
- Cancellation MUST submit nothing and release or recycle temporary buffers.
- Preview MUST NOT become confirmed terrain before acceptance.

## 13. Rendering and Worker rules

`docs/architecture/vtt-rendering-runtime-contract.md` (`VTT-RENDER-001`) is
the normative refinement of this section. An implementation that introduces
real rendering, Worker bulk data, or pointer-driven mutation MUST satisfy its
invariants and acceptance matrix.

- One table runtime MUST own one renderer with multiple views.
- One WebGL context per UI element is forbidden.
- View attachment, detachment, and resize MUST be explicit operations.
- Invalidation MUST use dependency keys or layer revisions.
- A token position change MUST NOT invalidate terrain.
- Preview invalidation MUST remain separate from confirmed invalidation.
- Transferable `ArrayBuffer` ownership MUST be explicit.
- Cross-Worker buffers MUST use a pool or equivalent bounded reuse strategy.
- A transferred buffer MUST NOT be read by its previous owner.
- `SharedArrayBuffer` MUST NOT be assumed for V1.
- The main thread owns React, input, presentation, and rendering orchestration.
- Workers own Wasm execution and long-running computation.
- Zero-copy across independent domains MUST NOT be claimed.

The concrete rendering adapter MUST follow the currently accepted renderer
decision. `ADR-0021`/`DEC-059` MUST NOT be treated as accepted while their
recorded status remains `Proposed`.

## 14. Undo

Undo MUST submit a VTT revert operation referencing an accepted operation ID.
The UI MAY retain operation IDs, labels, status, and presentation metadata. It
MUST NOT retain a second authoritative before/after copy of table state.

## 15. Verification contract

Architecture tests MUST fail on:

- imports from `apps/vtt` into reusable packages;
- direct render, Worker, or network implementation imports outside approved
  adapters;
- same-layer feature-to-feature or entity-to-entity imports;
- deep imports bypassing slice public APIs;
- vendor types exported through ports or public slice APIs.

Required runtime and contract tests:

- one renderer supports multiple views;
- runtime disposal is idempotent and releases owned resources;
- unchanged state preserves snapshot identity;
- confirmed, interaction, render, and Worker state remain separated;
- origin survives translation as `local`, `network`, or `programmatic`;
- token movement does not invalidate terrain;
- resize reaches the renderer contract;
- transferred buffers follow their ownership/reuse lifecycle.

Required browser tests:

- dragging emits no operation during pointer movement;
- dragging emits exactly one operation on release;
- cancellation emits zero operations;
- rejection removes preview and restores confirmed state;
- tool switch cancels the active gesture;
- unmount releases pointer capture and runtime resources;
- terrain brush emits one batch operation on release;
- multiple views reuse one renderer.

## 16. Definition of done for an implementation slice

A slice is complete only when:

- every created directory contains implementation or tests;
- every cross-slice surface is exported through an explicit public API;
- architecture checks, typecheck, tests, and build pass;
- lifecycle disposal is tested where applicable;
- no reusable package gained product-specific vocabulary;
- no generic computation was duplicated in the application;
- the diff contains no empty future-tree scaffold.

## 17. Deferred choices

The following remain replaceable and MUST stay behind app-owned contracts:

- external-store implementation;
- finite-state-machine library;
- network transport and authoritative host;
- rendering implementation;
- persistence implementation.

## 18. Implementation handoff

The first implementation task MUST materialize one executable vertical slice,
not the complete conceptual tree. It MUST create the Nx project atomically with
the files required by `DEC-028`, establish the Next.js/client boundary, create
one composition root, and add executable dependency-boundary checks.

That implementation is tracked as `vtt-roadmap.md` task `E2.6`. This accepted
specification closes the architecture decision but is not evidence that the
scaffold exists.

## 19. Research basis

The structure adapts, rather than copies, the following public patterns:

- Next.js project organization and narrow Server/Client Component boundaries;
- React external-store subscription and single ownership for each state item;
- feature-sliced grouping by product meaning and slice public APIs;
- ports and adapters around purposeful application conversations;
- normalized projections and feature-folder ownership;
- explicit state machines for temporal interactions;
- Pointer Events and pointer capture for unified input;
- separate high-frequency preview from accepted/session state in VTT tools.

Primary references:

- <https://nextjs.org/docs/app/getting-started/project-structure>
- <https://nextjs.org/docs/app/getting-started/server-and-client-components>
- <https://react.dev/reference/react/useSyncExternalStore>
- <https://react.dev/learn/choosing-the-state-structure>
- <https://feature-sliced.design/docs/reference/layers>
- <https://alistair.cockburn.us/hexagonal-architecture>
- <https://redux.js.org/usage/structuring-reducers/normalizing-state-shape>
- <https://www.w3.org/TR/pointerevents/>
- <https://threejs.org/manual/en/multiple-scenes.html>
- <https://threejs.org/manual/en/responsive.html>
- <https://html.spec.whatwg.org/multipage/structured-data.html>
- <https://gameprogrammingpatterns.com/state.html>
- <https://gameprogrammingpatterns.com/event-queue.html>
