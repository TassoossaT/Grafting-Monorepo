# VTT product model

Specification-ID: `VTT-PRODUCT-001`

Status: Accepted

Accepted: 2026-08-12

Audience: implementation agents

Authority: `ADR-0023`/`DEC-061`; construction surfaces additionally follow
`ADR-0022`/`DEC-060`

Normative terms: `MUST`, `MUST NOT`, `SHOULD`, and `MAY` are ordered
requirements.

## 1. Objective

Define the VTT-owned product nouns, identities, confirmed projection, operation
protocol, app-local ports, and capability boundaries required by Epics 3, 5,
and 6. This specification closes `E2.3` and refines
`VTT-APP-ARCH-001`; it does not implement a feature slice.

## 2. Ownership rules

`VTT-PRODUCT-OWN-001` — `apps/vtt` MUST own map, surface, token,
participant, visibility, rules-composition, workflow, projection, and
presentation semantics.

`VTT-PRODUCT-OWN-002` — `libs/*` and `packages/*` MUST expose generic
capabilities only. They MUST NOT gain a `vtt` namespace, VTT entity names, or
methods required by only this product.

`VTT-PRODUCT-OWN-003` — An app-local port MAY use VTT vocabulary. Its adapter
MUST translate to generic capability contracts without exporting app or vendor
types across the boundary.

`VTT-PRODUCT-OWN-004` — Significant graph, geometry, validation, ordering,
query, diff, layout, rules, collision, random, and procedural-generation
computation MUST remain in its canonical Rust capability. App TypeScript MAY
validate interaction shape and translate boundaries; it MUST NOT become a
second authoritative implementation.

`VTT-PRODUCT-OWN-005` — No projection, renderer cache, or UI model is an
authoritative copy of canonical Rust state.

## 3. Deferred choices

| ID | Choice not made here | Owner or trigger |
| --- | --- | --- |
| `VTT-PRODUCT-DEF-001` | Fog states, remembered resolution, sound semantics, and authority | `E2.4` |
| `VTT-PRODUCT-DEF-002` | Authoritative host, transport, hosting model, and authentication protocol | `GATE-004` |
| `VTT-PRODUCT-DEF-003` | Concrete rules system, action schema, character sheet, and compendiums | `E6.3` and first consumer |
| `VTT-PRODUCT-DEF-004` | Renderer package and renderer-specific scene representation | accepted renderer decision and first rendering slice |
| `VTT-PRODUCT-DEF-005` | Token collision, snapping, movement allowance, and physics | `E5.4`/Epic 6 |
| `VTT-PRODUCT-DEF-006` | Persistence and wire schemas for these nouns | first governed persistence/replication consumer |
| `VTT-PRODUCT-DEF-007` | Exact construction, token, access, and rules payloads | their executable Epic 3/5/6 slices |

An implementation MUST NOT infer a deferred choice from an illustrative field
or operation family below.

## 4. Product nouns

### 4.1 Stable identifiers

All identifiers MUST be opaque, serializable, and Grafting-owned.

| Identifier | Identifies | Stability requirement |
| --- | --- | --- |
| `TableId` | one tabletop runtime/session aggregate | unchanged by title, participant, or scene edits |
| `SceneId` | one navigable spatial location | unchanged by rename or active-scene changes |
| `MapId` | one scene's construction topology | unchanged by graph mutations |
| `NodeRef` | app reference to one canonical graph-core node | stable while that canonical node exists |
| `TokenId` | one placed scene object | unchanged by pose, appearance, or subject binding |
| `ParticipantId` | one table-session participant | unchanged by token control or capability changes |
| `SubjectRef` | optional rules/content subject represented by a token | opaque to the base model |
| `SurfaceRef` | app reference to one canonical construction surface | derived by an adapter from canonical node-set identity |
| `AssetRef` | app reference to presentation content | independent from canonical geometry identity |
| `CapabilityId` | one authorization or rules capability | namespaced and versionable by its app feature |
| `RulesProviderId` | one rules-provider binding | unchanged by provider configuration edits |

Identifiers MUST NOT encode display names, array positions, coordinates, Rust
memory addresses, or vendor types.

### 4.2 Responsibilities

| Entity | Responsibility | MUST NOT own |
| --- | --- | --- |
| `Table` | metadata, ordered scene references, active-scene policy, participant references, rules-composition reference | renderer, network, Worker, or rules-engine implementation |
| `Scene` | metadata, its `MapId`, token references, presentation settings, visibility revision reference | copied topology or participant identity |
| `Map` | app boundary for one scene's canonical topology and surface projections | derived mesh authority, asset policy, or token state |
| `SurfaceProjection` | `SurfaceRef`, ordered node references, open `type`, and physical properties | copied coordinates, authoritative mesh, visibility behavior, or asset identity |
| `Token` | scene placement, pose, optional `SubjectRef`, appearance, and controller-capability references | participant identity, rules state, topology, or renderer object |
| `Participant` | session identity, display/presence projection, and capability-grant references | role-enum authority, token pose, or rules subject state |
| `RulesCompositionProjection` | bindings from app capability IDs to rules providers | untyped rules blob or authoritative rules execution |

`Table` is the app runtime/session boundary, not a campaign, account, world,
or transport concept.

### 4.3 Required separations

`VTT-PRODUCT-MODEL-001` — A token MUST be a scene placement independent from
its optional `SubjectRef`. It MAY have no subject. Multiple tokens MAY
reference the same subject.

`VTT-PRODUCT-MODEL-002` — A participant MUST NOT be a token or rules subject.
Control uses app-owned capability grants, not identity collapse.

`VTT-PRODUCT-MODEL-003` — The base model MUST NOT hardcode `GM`/`player` as
authorization. Named roles MAY be derived presentation; the session boundary
owns authoritative capability decisions.

`VTT-PRODUCT-MODEL-004` — A scene owns its spatial map boundary. V1 MUST NOT
share one mutable `MapId` between scenes. Reuse MAY use generation/copy without
shared mutable identity.

`VTT-PRODUCT-MODEL-005` — Construction uses canonical graph-core node and
surface identity. `orderedNodeRefs` preserves canonical cycle order;
`SurfaceRef` represents canonical node-set identity. The app MUST NOT invent
parallel free boundary geometry.

`VTT-PRODUCT-MODEL-006` — App-owned asset/rules composition selects surface
visual and vision behavior. Generic graph and renderer packages MUST NOT
hardcode it.

## 5. Confirmed projection

The runtime-visible state MUST be one immutable, normalized, viewer-safe
projection with conceptual shape equivalent to:

```ts
interface ConfirmedTableProjection {
  readonly table: TableProjection;
  readonly viewer: ViewerProjection;
  readonly scenesById: ReadonlyMap<SceneId, SceneProjection>;
  readonly mapsById: ReadonlyMap<MapId, MapProjection>;
  readonly nodesById: ReadonlyMap<NodeRef, NodeProjection>;
  readonly surfacesByRef: ReadonlyMap<SurfaceRef, SurfaceProjection>;
  readonly tokensById: ReadonlyMap<TokenId, TokenProjection>;
  readonly participantsById: ReadonlyMap<ParticipantId, ParticipantProjection>;
  readonly rules: RulesCompositionProjection;
  readonly revisions: ProjectionRevisions;
}
```

This is conceptual. It does not require a central `types.ts`, one large
module, JavaScript `Map`, or immediate materialization of every collection.
Each real slice owns its public types and selectors.

| ID | Projection requirement |
| --- | --- |
| `VTT-PRODUCT-PROJ-001` | It MUST contain only data authorized for the current viewer. Withheld entities are absent, not UI-hidden. |
| `VTT-PRODUCT-PROJ-002` | The client MUST NOT reconstruct withheld data from buffers, IDs, revisions, errors, or asset lookups. |
| `VTT-PRODUCT-PROJ-003` | Collections MUST be normalized and expose revisions at the smallest useful dependency scope. |
| `VTT-PRODUCT-PROJ-004` | Unchanged entities, collections, and top-level snapshots MUST preserve reference identity. |
| `VTT-PRODUCT-PROJ-005` | It MUST NOT contain React elements, mutable vendor objects, GPU resources, Workers, sockets, or pointer samples. |
| `VTT-PRODUCT-PROJ-006` | Node coordinates MAY support presentation; canonical topology/surface validity remains Rust-owned. |
| `VTT-PRODUCT-PROJ-007` | Meshes, spatial indexes, picking structures, and visibility caches are derived adapter state. |
| `VTT-PRODUCT-PROJ-008` | Visibility stays opaque until `E2.4`; only viewer scope and an invalidation revision/stamp MAY exist. |

## 6. Message and operation protocol

| Message | Producer | Meaning | Direct confirmed mutation |
| --- | --- | --- | --- |
| `FeatureIntent` | UI/input | local select, navigate, gesture, preview, commit, or cancel request | no |
| `Operation` | owning feature | one typed semantic mutation submitted to the session port | no |
| `OperationReceipt` | session adapter | accepted, rejected, or cancelled status | no |
| `DomainEvent` | canonical authority | confirmed semantic result | no; adapter translates it |
| `ProjectionDelta` | session/projection adapter | viewer-safe confirmed update | runtime normalization only |
| `RenderChange` | projection/preview derivation | minimal renderer instruction | no |

These MUST NOT collapse into a generic `event`, `action`, or
`Record<string, unknown>`.

Every operation MUST carry semantics equivalent to:

```ts
interface OperationEnvelope<K extends OperationKind, P> {
  readonly operationId: OperationId;
  readonly tableId: TableId;
  readonly sceneId?: SceneId;
  readonly initiatedBy: ParticipantId;
  readonly kind: K;
  readonly expected: readonly RevisionPrecondition[];
  readonly payload: P;
}
```

- `operationId` MUST be stable across retry and enforce idempotency.
- `kind` MUST be a versioned, feature-owned discriminant such as
  `construction.*@1` or `token.*@1`; examples do not reserve payloads.
- `payload` MUST be a closed typed contract owned by one feature slice.
- Catch-all `updateEntity`, path/value mutation, arbitrary patches, and a
  central stringly dispatcher are forbidden.
- Preconditions MUST name only revisions required by the semantic decision.
- A batch is one atomic semantic operation; partial silent success is forbidden.
- Acceptance MUST NOT optimistically mutate the confirmed projection.

| Family | App semantics | Canonical capability/authority | Payload owner |
| --- | --- | --- | --- |
| `scene.*` | scene workflow and presentation metadata | session/persistence authority | first scene feature |
| `construction.*` | construction intent and product meaning | graph-core and relevant Rust generator | Epic 3 slice |
| `surface.*` | type/physical edit meaning and asset policy | graph-core surface registry for graph state | Epic 3 slice |
| `token.*` | placement, pose request, subject binding, appearance, control workflow | session; Rust collision/rules when applicable | `E5.2`, extended by `E5.4` |
| `access.*` | capability grant/revoke workflow | authoritative session/host | first access feature after host decision |
| `rules.*` | composition and gameplay intent | selected canonical Rust rules capability | `E6.3` and concrete feature |

The app MAY reject structurally invalid input before submission. Only canonical
capability/authority decides topology, rules, collision, authorization,
ordering, or conflict validity.

## 7. Rules-composition seam

The base model MUST permit rules capabilities without selecting a game system:

```ts
interface RulesCompositionProjection {
  readonly bindings: readonly RulesCapabilityBinding[];
  readonly revision: RulesRevision;
}

interface RulesCapabilityBinding {
  readonly capabilityId: CapabilityId;
  readonly providerId: RulesProviderId;
  readonly providerRevision: string;
}
```

- A capability ID MUST describe an app need, not a vendor/crate API.
- A provider binding MUST NOT expose provider-owned runtime types.
- Concrete configuration MUST be a typed feature-owned contract; a shared
  arbitrary property bag is forbidden.
- Rules results MUST enter through confirmed projection deltas. UI code MUST
  NOT execute a second authoritative rules implementation.
- Replacing a provider MUST NOT change table, scene, map, surface, token, or
  participant identity contracts.

## 8. App-local ports

`TableSessionPort` and `SceneRenderPort` remain defined by
`VTT-APP-ARCH-001`; rendering refinements remain in `VTT-RENDER-001`.

`TableSessionPort` MUST:

- load one viewer-safe projection for a `TableId`;
- submit one typed operation and return accepted/rejected/cancelled;
- observe confirmed viewer-safe deltas without synthesizing local operations;
- preserve operation IDs, origin, and narrow revision preconditions through
  adapter translation;
- hide the future host, transport, journal, and wire format.

The following ports MUST be created only with their first executable consumer:

| Port conversation | Create when | Must hide |
| --- | --- | --- |
| construction capability | first feature needs canonical graph/generation work | Rust ABI, graph storage, vendor types |
| asset resolution | first surface/token presentation resolves an `AssetRef` | repository/CDN/package API and visual defaults not selected by the app |
| visibility projection | after `E2.4` defines its contract | algorithm, cache, and authority mechanism |
| rules capability | first `E6.3` provider is selected | crate/provider runtime and provider-owned types |
| persistence | first decided persistence consumer | storage engine and schema implementation |

Pre-creating these ports, adapters, folders, or empty interfaces is forbidden.

## 9. State-transition flows

### 9.1 Load

```text
route TableId
  -> create one runtime generation
  -> TableSessionPort.load
  -> viewer-safe payload
  -> validate stable references
  -> normalize ConfirmedTableProjection
  -> derive minimal RenderChange
```

Invalid references/protocol shape MUST fail explicitly. The app MUST NOT repair
canonical topology or silently drop an invalid confirmed delta.

### 9.2 Local mutation

```text
FeatureIntent
  -> feature state machine
  -> local preview while interaction is active
  -> exactly one typed Operation on semantic commit
  -> TableSessionPort.submit
  -> OperationReceipt
  -> confirmed ProjectionDelta
  -> normalize affected entities/revisions
  -> derive minimal RenderChange
```

Rejection/cancellation clears preview and leaves confirmed state unchanged. A
no-op gesture emits zero operations.

### 9.3 Remote or programmatic confirmation

```text
confirmed delta with origin network|programmatic
  -> validate runtime generation and references
  -> normalize affected entities/revisions
  -> derive minimal RenderChange
```

The client MUST NOT synthesize an `Operation` to explain a received delta.
Late results from obsolete/disposed runtime generations MUST be ignored.

## 10. Error contract

Adapters MUST normalize failures into this app-owned closed taxonomy:

| Code | Meaning | Confirmed-state effect |
| --- | --- | --- |
| `invalid-intent` | local structural input cannot form an operation | none; no submission |
| `unauthorized` | authority denies the requested capability | none |
| `stale-precondition` | a required narrow revision changed | none; caller may reload/rebase intent |
| `domain-rejected` | canonical Rust capability rejects semantics | none |
| `conflict` | operation conflicts with an accepted mutation | none unless a confirmed delta arrives |
| `unavailable` | required capability/session is unavailable | none |
| `cancelled` | local lifecycle or user cancellation | none |
| `protocol-invalid` | adapter receives invalid confirmed data | stop affected runtime generation; never repair silently |

User-facing copy/recovery belongs to the feature and MUST NOT be encoded in
package errors.

## 11. Normative invariants

| ID | Invariant |
| --- | --- |
| `VTT-PRODUCT-I001` | Product vocabulary and composition remain inside `apps/vtt`. |
| `VTT-PRODUCT-I002` | Reusable capabilities contain no app-exclusive VTT methods or namespace. |
| `VTT-PRODUCT-I003` | Token, participant, and optional rules subject are distinct identities. |
| `VTT-PRODUCT-I004` | A surface references canonical graph nodes/cycle and owns no duplicate geometry/mesh authority. |
| `VTT-PRODUCT-I005` | Confirmed, preview, renderer, Worker, and authoritative state remain separate. |
| `VTT-PRODUCT-I006` | The confirmed projection is viewer-safe and contains no withheld entities. |
| `VTT-PRODUCT-I007` | UI capability checks are presentation; session authority rechecks authorization. |
| `VTT-PRODUCT-I008` | A semantic gesture produces zero operations when cancelled/no-op and exactly one when committed. |
| `VTT-PRODUCT-I009` | Retrying one operation ID cannot apply a mutation twice. |
| `VTT-PRODUCT-I010` | A rejected operation never mutates confirmed state. |
| `VTT-PRODUCT-I011` | A token-only change does not change map/surface revisions or invalidate terrain. |
| `VTT-PRODUCT-I012` | App TypeScript duplicates no canonical Rust computation. |
| `VTT-PRODUCT-I013` | DomainEvent and ProjectionDelta remain distinct; replication MUST NOT be called Event Sourcing. |
| `VTT-PRODUCT-I014` | Ports and public slice APIs expose only Grafting-owned contracts. |

## 12. Acceptance matrix for future slices

| Check | Required evidence |
| --- | --- |
| identity stability | rename/move/configuration tests preserve IDs |
| token/subject separation | subjectless token and two tokens referencing one subject |
| participant separation | control changes without changing participant/token identity |
| surface authority | fixture references canonical node IDs/order and contains no authoritative mesh/free geometry |
| viewer safety | contract fixture proves withheld entities/sensitive fields are absent |
| authorization | forged UI-visible capability cannot bypass session authority |
| idempotency | same operation ID submitted twice produces at most one accepted mutation |
| rejection | rejected/stale/domain-invalid operation preserves confirmed snapshot identity |
| interaction commit | pointer-move previews only; release one operation; cancel/no-op zero |
| invalidation isolation | token pose preserves map/surface revisions and terrain dependency keys |
| Rust authority | adapter maps to canonical generic capability; no parallel app algorithm |
| package neutrality | architecture check rejects reusable-to-app imports and VTT reusable APIs |
| provider isolation | rules/renderer/vendor types do not cross adapters |
| lifecycle | disposed generation ignores late receipts/deltas and releases ports |

Each task MUST satisfy rows relevant to its materialized slice. This document
does not authorize the complete future model as empty files.

## 13. Implementation handoff

| Consumer | First responsibility |
| --- | --- |
| Epic 3 | materialize only construction nouns/operations needed by the first workflow; adapt to graph-core/Rust authority |
| `E5.2` | materialize placement, optional subject binding, projections, and typed token operations without physics assumptions |
| `E2.4` | refine viewer-safe visibility projection/port without changing identity separation |
| `E6.3` | type the first rules capability/provider without adding gameplay fields to generic packages |
| future multiplayer slice | translate operations/deltas after `GATE-004`; do not rename replication Event Sourcing |

Exact fields MUST be added by the first executable consumer and exported via
that slice's public API. A central app-wide domain package, mega entity file,
or prebuilt future tree is forbidden.

## 14. Research basis

This specification combines accepted repository decisions with corroborating
public product patterns:

- [Foundry VTT Scene document data](https://foundryvtt.com/api/v14/interfaces/foundry.documents.types.SceneData.html)
  treats a scene as a container for placed spatial documents.
- [Foundry VTT tokens](https://foundryvtt.com/article/tokens/) and
  [actors](https://foundryvtt.com/article/actors/) separate a scene-specific
  placed token from the optional subject it represents.
- [Foundry VTT users and permissions](https://foundryvtt.com/article/users/)
  separates session identity, document access, and product-role presentation.

These patterns are not imported APIs or taxonomies. Identity, capability-based
authorization, Rust authority, surface semantics, and package boundaries above
are Grafting decisions.
