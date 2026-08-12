# VTT rendering and interaction runtime contract

Specification-ID: `VTT-RENDER-001`

Status: **Accepted**

Authority: `ADR-0023` / `DEC-061`

Closes: `apps/vtt/notes/0001-rendering-and-propagation.md`, roadmap `E2.2`

Applies to: `apps/vtt` rendering composition, app-owned render ports, Worker
adapters, and pointer-driven features

Normative terms: `MUST`, `MUST NOT`, `SHOULD`, and `MAY` are ordered by
requirement strength.

## 1. Scope

This specification defines the six cross-cutting contracts that every real VTT
rendering slice MUST preserve:

1. dependency-scoped invalidation;
2. origin-preserving change propagation;
3. one renderer with multiple views;
4. explicit resize without renderer reconstruction;
5. bounded cross-Worker buffer reuse;
6. preview-only pointer movement with one commit at gesture completion.

It does not choose a rendering vendor, GPU API, state-store library, Worker
implementation, or authoritative network host. Reusable packages remain
generic. VTT dependency keys, origins, projections, and interaction policies
belong to `apps/vtt`.

## 2. Stable invariant IDs

| ID | Requirement |
| --- | --- |
| `VTT-RENDER-I001` | A render consumer MUST declare the smallest projection and preview dependencies that can change its output. |
| `VTT-RENDER-I002` | A change MUST retain its initiating origin through projection and render translation. |
| `VTT-RENDER-I003` | One open table runtime MUST own exactly one renderer and one GPU context, serving zero or more attached views. |
| `VTT-RENDER-I004` | Resizing a view MUST NOT dispose or recreate the renderer. |
| `VTT-RENDER-I005` | Cross-Worker bulk memory MUST follow an explicit, bounded ownership lifecycle. |
| `VTT-RENDER-I006` | Pointer movement MUST update preview only; a completed semantic gesture submits exactly one operation. |
| `VTT-RENDER-I007` | Cancellation, teardown, and superseded runtime generations before submission MUST submit zero operations and release transient resources; later terminal signals MUST submit no additional operation. |
| `VTT-RENDER-I008` | Renderer callbacks MUST NOT be interpreted as user intent unless they originate at the input boundary. |

## 3. Change envelope and origin

Conceptual app-owned vocabulary:

```ts
type ChangeOrigin = "local" | "network" | "programmatic";

interface ChangeEnvelope<TPayload> {
  readonly origin: ChangeOrigin;
  readonly causeId: string;
  readonly runtimeGeneration: number;
  readonly payload: TPayload;
}
```

The exact implementation MAY use branded IDs and narrower payload unions. It
MUST preserve these semantics:

| Origin | Initiator | Examples | MUST NOT do |
| --- | --- | --- | --- |
| `local` | current user input or an operation initiated by it | accepted local token move, local brush operation | lose its origin merely because acceptance returned through a network adapter |
| `network` | another participant or remote authority without a matching local `causeId` | remote participant move, remote scene change | synthesize a local intent or echo operation |
| `programmatic` | application lifecycle, reconciliation, tool logic, or adapter placement | initial load, snapshot reconciliation, camera fitting, applying coordinates to a renderer | be reported as user input |

`causeId` correlates a change with its initiating operation, load, or
programmatic action. It is not an ordering authority. Authoritative revisions
or sequence numbers, when introduced, remain separate fields.

Required propagation:

```text
input sample
  -> local FeatureIntent
  -> local Operation(causeId)
  -> confirmed result(origin=local, causeId)
  -> ProjectionDelta(origin=local, causeId)
  -> RenderChange(origin=local, causeId)

remote confirmed result
  -> ProjectionDelta(origin=network)
  -> RenderChange(origin=network)

adapter placement / initial load
  -> ProjectionDelta(origin=programmatic)
  -> RenderChange(origin=programmatic)
```

Adapters MUST suppress or classify their own placement notifications as
`programmatic`. A render adapter MUST expose input observations separately from
application-driven mutations. Equality checks MAY suppress redundant adapter
work but MUST NOT be the only defense against feedback loops.

## 4. Dependency-scoped invalidation

The runtime MUST maintain monotonically increasing revisions at the smallest
useful rendering dependency scope. A revision is an opaque invalidation token;
it is not a persisted domain version.

Conceptual contract:

```ts
type RenderLayer = "terrain" | "tokens" | "visibility" | "lighting" | "overlay";

interface RenderDependencyRevision {
  readonly layer: RenderLayer;
  readonly scopeId: string;
  readonly revision: number;
}

interface RenderChange {
  readonly origin: ChangeOrigin;
  readonly causeId: string;
  readonly dependencies: readonly RenderDependencyRevision[];
}
```

Minimum dependency policy:

| Consumer/layer | May depend on | MUST NOT be invalidated solely by |
| --- | --- | --- |
| terrain geometry/material | affected terrain chunk topology, elevation, surface material, asset readiness | token pose, selection, camera-only UI state |
| token instances | affected token pose/appearance/visibility | unrelated terrain chunk or another token outside the consumer scope |
| visibility/fog | affected observer, occluder, remembered-visibility scope | unrelated UI panels or selection styling |
| lighting | affected emitter, occluder, receiving chunk, view requirements | unrelated token metadata |
| overlay/preview | active feature preview, selection, guides, picking feedback | confirmed layers outside the active overlay dependency set |
| view/camera | view rectangle, camera, render scale | unrelated confirmed entity metadata |

Rules:

- A whole-table snapshot identity MUST NOT be a renderer dependency.
- Confirmed and preview dependency revisions MUST occupy separate namespaces.
- An adapter MUST cache the last consumed revision per view and dependency.
- An unchanged dependency MUST produce no resource upload for that consumer.
- Multiple changes before the next frame SHOULD coalesce by dependency key.
- Superseded preview work MAY be dropped; confirmed changes MUST remain
  observable in revision order.
- The dependency planner belongs to the app. Generic rendering packages MAY
  expose neutral dirty-range or resource-update mechanisms only.

## 5. Renderer and view lifecycle

One `TabletopRuntime` owns one renderer lifecycle:

```text
runtime.start
  -> renderer.create
  -> attachView*
  -> render/update/resize
  -> detachView*
  -> renderer.dispose
  -> runtime.disposed
```

Required view contract:

```ts
interface ViewSize {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly renderScale: number;
  readonly maxPixelCount: number;
}

interface SceneRenderPort {
  attachView(target: RenderTarget): ViewId;
  detachView(viewId: ViewId): void;
  resizeView(viewId: ViewId, size: ViewSize): void;
  applyConfirmed(change: RenderChange): void;
  showPreview(preview: InteractionPreview): void;
  clearPreview(previewId: PreviewId): void;
  dispose(): Promise<void>;
}
```

Rules:

- Views share renderer-owned GPU resources.
- View attachment MUST NOT create another renderer or context.
- Hidden, zero-area, or fully clipped views SHOULD be skipped.
- View-specific camera, viewport, scissor/clip rectangle, and picking state MAY
  differ without duplicating shared scene resources.
- Detaching the final view MUST NOT dispose the renderer; runtime disposal is
  the sole terminal owner action.
- A context/device loss path MUST invalidate renderer resources and restore or
  fail the runtime explicitly. It MUST NOT silently create one renderer per
  view as fallback.

## 6. Resize contract

`resizeView` MUST receive CSS dimensions and an explicit render scale. The
adapter MUST derive a bounded drawing-buffer size:

```text
requestedWidth  = floor(cssWidth  * renderScale)
requestedHeight = floor(cssHeight * renderScale)

if requestedWidth * requestedHeight > maxPixelCount:
  scale = sqrt(maxPixelCount / (requestedWidth * requestedHeight))
  drawingWidth  = floor(requestedWidth  * scale)
  drawingHeight = floor(requestedHeight * scale)
else:
  drawingWidth  = requestedWidth
  drawingHeight = requestedHeight
```

Rules:

- Non-finite or negative dimensions, non-positive/non-finite render scale, and
  non-positive/non-finite pixel budget MUST be rejected at the app boundary.
- Zero area suspends the view and MUST NOT allocate a zero-sized replacement
  renderer.
- Identical effective drawing-buffer dimensions MUST be a no-op.
- A changed aspect ratio MUST update the view projection before its next draw.
- Resize MAY recreate size-dependent attachments or render targets; it MUST NOT
  recreate the renderer, context/device, scene, or size-independent resources.
- Platform pixel-density inspection MUST flow through the canonical polymath
  boundary required by DEC-042. VTT modules and rendering adapters MUST NOT
  inspect `window.devicePixelRatio`, `navigator.gpu`, or platform identity
  directly.

## 7. Cross-Worker buffer lifecycle

Baseline V1 uses transferable `ArrayBuffer` ownership plus a bounded pool.
`SharedArrayBuffer` is not the baseline.

Conceptual lease:

```ts
interface BufferLease {
  readonly leaseId: string;
  readonly runtimeGeneration: number;
  readonly byteLength: number;
  readonly format: string;
  readonly buffer: ArrayBuffer;
}
```

State machine:

```text
available(pool owner)
  -> worker-owned(compute/write)
  -> main-owned(read/upload)
  -> available(pool owner)

any state
  -> retired(dispose, invalid generation, incompatible size/format, failure)
```

Rules:

- Every transfer MUST include the lease ID, generation, byte length, and data
  format/version.
- Transfer changes ownership. The previous owner MUST NOT read or write the
  detached buffer.
- Return to the pool requires an explicit acknowledgement/transfer; a timeout
  or disposed generation retires the lease.
- The pool MUST define maximum buffer count and maximum total bytes.
- Pool exhaustion MUST apply backpressure, coalesce superseded preview work, or
  drop explicitly droppable preview results. It MUST NOT allocate without a
  bound.
- Confirmed work MUST NOT be silently dropped. It MAY wait, replace an older
  equivalent request before execution, or fail explicitly.
- Allocation and reuse counters MUST be observable in development/browser
  tests so repeated steady-state passes prove allocation plateaus.
- No layer may describe this lifecycle as zero-copy across independent
  domains.

`SharedArrayBuffer` MAY be proposed later only after all of these exist:

1. measurement shows transfer/pool overhead is material;
2. cross-origin isolation and third-party embedding impact are accepted;
3. an atomic synchronization and ownership protocol is specified;
4. security review approves the header/deployment change;
5. a non-shared fallback remains tested.

## 8. Pointer gesture transaction

Every pointer-driven mutation uses one state machine instance per active
pointer/feature:

```text
idle
  -> armed(pointerId, target, confirmedBase)
  -> dragging(pointerId, target, confirmedBase, preview)
  -> committing(operationId, finalPreview)
  -> idle

armed|dragging
  -> cancelled(reason)
  -> idle
```

Transition rules:

| Input | From | Effect | Operations submitted |
| --- | --- | --- | --- |
| `pointerdown` after successful pick | `idle` | capture pointer; snapshot confirmed base; enter `armed` | 0 |
| movement crossing feature threshold | `armed` | create preview; enter `dragging` | 0 |
| `pointermove` / coalesced samples | `dragging` | update local preview only | 0 |
| `pointerup` with a semantic delta | `dragging` | freeze final preview; submit one operation; enter `committing` | exactly 1 |
| `pointerup` without a semantic delta | `armed` or `dragging` | clear preview; return to `idle` | 0 |
| accepted result | `committing` | update confirmed projection; clear preview | 0 additional |
| rejected result | `committing` | restore confirmed presentation; surface error; clear preview | 0 additional |
| `pointercancel`, Escape, tool switch, unmount, lost runtime generation | `armed` or `dragging` | clear preview and transient buffers; release capture | 0 |

Additional rules:

- Pointer samples and predicted events MUST NOT mutate confirmed projection.
- Predicted samples MAY affect disposable visual preview only and MUST NOT
  influence the committed operation payload.
- Brush samples MAY accumulate into one batch payload; they MUST NOT become one
  operation per sample.
- Terminal transitions MUST be idempotent. Repeated `pointerup`, cancellation,
  or late async completion MUST NOT submit another operation.
- A newly confirmed network change that invalidates the gesture base MUST
  cancel or explicitly rebase the gesture. It MUST NOT commit against an
  unobserved base silently.
- Pointer capture MUST be released on every terminal path.

## 9. Required observability

Development and browser-test builds MUST expose Grafting-owned counters or
trace records sufficient to assert:

| Signal | Required fields |
| --- | --- |
| render scheduled/completed | runtime generation, view ID, reason/dependency keys |
| resource upload | layer, scope ID, revision, bytes |
| renderer lifecycle | runtime generation, create/dispose count, attached view count |
| view resize | prior/effective dimensions, render scale, no-op/applied |
| buffer lifecycle | lease ID, state transition, bytes, pool allocation/reuse/retire counts |
| gesture transition | feature, pointer ID, prior/next state, cancellation reason |
| operation submission | operation ID, feature, origin, cause ID |

Telemetry MUST NOT contain secret table contents or raw private asset data.
Instrumentation MAY be compiled out of production, but the semantic hooks MUST
remain available to automated browser tests.

## 10. Acceptance matrix

| ID | Scenario | Required evidence |
| --- | --- | --- |
| `VTT-RENDER-AC-001` | drag one token through at least 20 pointer moves | zero terrain uploads; zero submitted operations before release; one operation after semantic release |
| `VTT-RENDER-AC-002` | apply programmatic placement | no local intent and no echoed operation |
| `VTT-RENDER-AC-003` | receive remote confirmed delta | origin remains `network`; no local operation is synthesized |
| `VTT-RENDER-AC-004` | attach at least two views | renderer/context create count remains one; views render distinct rectangles/cameras |
| `VTT-RENDER-AC-005` | resize one attached view repeatedly | renderer create/dispose count unchanged; only effective size changes resize; projection aspect is current |
| `VTT-RENDER-AC-006` | run repeated equal-size Worker results beyond pool capacity | allocations plateau at configured bound; leases return or retire explicitly; no detached-owner read |
| `VTT-RENDER-AC-007` | cancel via pointer cancellation, Escape, tool switch, and unmount | zero operations for every case; preview, pointer capture, and temporary leases released |
| `VTT-RENDER-AC-008` | reject a submitted drag operation | preview clears and confirmed presentation is restored without a second operation |
| `VTT-RENDER-AC-009` | dispose then deliver late Worker/session result | result ignored by generation; no render, pool resurrection, or operation |

These are browser/contract acceptance criteria for the first slice that
introduces real rendering or Worker bulk data. E2.2 does not claim those tests
or implementations exist today.

## 11. Rejected baselines

| Rejected baseline | Reason |
| --- | --- |
| whole-document invalidation | recreates measured unrelated uploads and prevents dependency reasoning |
| infer origin from value equality alone | cannot distinguish remote acceptance, local echo, and app placement reliably |
| one renderer/context per view element | duplicates resources and is bounded by browser context limits |
| dispose/recreate on resize | turns routine layout changes into full resource lifecycle churn |
| allocate one fresh preview buffer per Worker pass | produces unbounded steady-state allocation churn |
| `SharedArrayBuffer` as mandatory V1 transport | requires deployment/security commitments before measurement proves need |
| commit on every pointer move | converts sampling frequency into authoritative mutation frequency |

## 12. Research basis

Primary references:

- Three.js manual, one renderer serving multiple virtual canvases/views with
  viewport and scissor: <https://threejs.org/manual/en/multiple-scenes.html>
- Three.js manual, CSS size versus drawing-buffer size, resize only when the
  effective dimensions change, and bounded HD-DPI resolution:
  <https://threejs.org/manual/en/responsive.html>
- HTML Living Standard, structured serialization and transfer ownership:
  <https://html.spec.whatwg.org/multipage/structured-data.html>
- W3C Pointer Events, pointer capture, `pointerup`, `pointercancel`, implicit
  release, coalesced events, and predicted events:
  <https://www.w3.org/TR/pointerevents/>

The Three.js references validate the web-runtime constraints and a viable
implementation technique. They do not select Three.js as the app contract or
permit vendor types to cross the app-owned port.
