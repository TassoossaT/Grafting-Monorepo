# VTT visibility and knowledge contract

Specification-ID: `VTT-VISIBILITY-001`

Status: Accepted

Accepted: 2026-08-12

Audience: implementation agents

Authority: owner acceptance of `VTT-FOG-RESEARCH-001`; refines
`VTT-PRODUCT-001`, `VTT-RENDER-001`, and `ADR-0023`/`DEC-061`

Normative terms: `MUST`, `MUST NOT`, `SHOULD`, and `MAY` are ordered
requirements.

## 1. Objective

Define the VTT-owned semantics and boundaries for character/group knowledge,
perception evidence, memory, viewer-safe disclosure, fog/void presentation,
and point-cloud silhouettes.

This specification closes roadmap task `E2.4`. It does not implement
visibility, select an authoritative host technology, select a rules provider,
or adopt a rendering dependency.

## 2. Required pipeline

```text
canonical world state
  -> canonical perception evidence
  -> character/group knowledge ledger
  -> viewer-safe disclosure projection
  -> app-owned presentation policy
  -> generic renderer mechanisms
```

`VTT-VIS-I001` — Evidence, knowledge, disclosure, and presentation MUST remain
separate. No downstream stage may recover information removed upstream.

`VTT-VIS-I002` — A single
`unknown | remembered | observed` implementation enum is forbidden.

## 3. Orthogonal state axes

| Axis | Meaning | Required shape |
| --- | --- | --- |
| evidence modality | how information was obtained | open `CapabilityId`, never fixed engine enum |
| disclosure level | maximum information the owner may know | `none | presence | silhouette | detail` |
| temporal relation | whether information describes current or retained state | `live | last-known` |
| spatial precision | how precisely a location is disclosed | `exact | bounded | region` |
| presentation | how an authorized disclosure is visualized | fog, void, cue, points, or normal/last-known detail |

An implementation MUST NOT infer one axis from another. For example, hearing
does not always imply `presence`, and `last-known` does not always imply
`silhouette`.

## 4. Identity and knowledge ownership

Knowledge owners:

| Owner | Responsibility |
| --- | --- |
| `SubjectRef` | retained knowledge of one rules/content subject |
| `KnowledgeGroupRef` | explicitly shared party/faction knowledge |
| participant viewer | receives only an authorized union; owns no canonical memory merely by viewing it |

`VTT-VIS-I003` — Knowledge MUST NOT belong to a token. Tokens are placements;
subjects retain knowledge across token replacement or absence.

`VTT-VIS-I004` — Participant identity MUST NOT replace subject/group
knowledge identity.

`VTT-VIS-I005` — A viewer controlling multiple subjects MAY receive their
authorized union. The authority computes that union; the client MUST NOT merge
secret ledgers.

`VTT-VIS-I006` — Sharing knowledge is an explicit confirmed operation or
rules effect. Proximity, common participant ownership, or UI selection MUST NOT
share it implicitly.

## 5. Spatial and entity knowledge

Spatial coverage and entity/surface knowledge MUST be separate.

| Situation | Required result |
| --- | --- |
| known room contains never-detected creature | room may render as known; creature is absent |
| creature is heard behind a wall | entity disclosure may change; surrounding room does not become explored |
| remembered terrain changes while unseen | retained terrain stays at last-known revision |
| new door/trap/token appears in a known place while unseen | new entity remains absent |
| explicit map/prior-knowledge grant | only granted spatial/entity scopes change |

`VTT-VIS-I007` — Entity and surface records MUST use stable app references and
the revision actually disclosed.

`VTT-VIS-I008` — A spatial coverage change MUST NOT disclose entity IDs,
counts, revisions, or types that were not separately authorized.

## 6. Evidence and senses

Evidence modality is an open rules-composed capability ID. Illustrative
modalities include direct sight, hearing, tremor, echolocation, prior
knowledge, communication, and explicit authority reveal.

Conceptual evidence:

```ts
interface PerceptionEvidence {
  readonly knowledgeOwner: KnowledgeOwnerRef;
  readonly sourceCapability: CapabilityId;
  readonly target: SpatialScopeRef | EntityRef;
  readonly maximumDisclosure: DisclosureLevel;
  readonly temporalRelation: "live" | "last-known";
  readonly spatialPrecision: "exact" | "bounded" | "region";
  readonly observedRevision?: RevisionRef;
  readonly occurredAt: AuthoritySequence;
}
```

The conceptual shape fixes semantics only. Exact fields belong to the first
executable consumer and MUST use app-owned contracts over canonical Rust
capabilities.

### 6.1 Default hearing policy

| Capability | Default maximum disclosure | Default precision |
| --- | --- | --- |
| baseline hearing | `presence` | `bounded` or `region` |
| exceptional hearing | MAY grant `silhouette` | at most `bounded` unless explicitly upgraded |
| exact-location sense | provider-defined, MAY grant `silhouette` or `detail` | `exact` only when explicitly declared |

`VTT-VIS-I009` — Sound MUST NOT produce the same disclosure as sight by
default.

`VTT-VIS-I010` — A renderer MUST NOT invent uncertainty. The authoritative
projection supplies permitted precision/bounds; presentation visualizes it.

## 7. Disclosure levels

| Level | Authorized information | Forbidden information |
| --- | --- | --- |
| `none` | nothing about presence, shape, identity, or position | every target-derived visual/picking/revision cue |
| `presence` | existence and authorized uncertain spatial scope | exact shape, material, identity, or exact position unless separately granted |
| `silhouette` | authorized approximate shape/volume | secret textures, material, internals, exact ungranted metadata |
| `detail` | explicitly observable attributes and geometry | attributes that were not observable or were independently withheld |

`VTT-VIS-I011` — Disclosure filtering is per target/scope. A broader spatial
level MUST NOT automatically raise contained entity disclosure.

`VTT-VIS-I012` — `presence` MUST use a non-geometric or uncertainty-bounded
cue. It MUST NOT silently become an exact point-cloud silhouette.

## 8. Memory and retention

`VTT-VIS-I013` — The base model performs no automatic memory decay.

`VTT-VIS-I014` — A rules provider MAY implement forgetting, distortion,
decay, refresh, or disclosure reduction as confirmed knowledge transitions.
The renderer MUST NOT implement these rules.

`VTT-VIS-I015` — Ordinary visual memory retains last-known `silhouette` by
default after direct detail observation ends.

`VTT-VIS-I016` — Photographic memory retains last-known `detail` only for
attributes that were observable at the recorded revision.

`VTT-VIS-I017` — Retained state MUST NOT link to live secret state.

Required behavior:

```text
subject observes revision 10 containing a table
  -> retained record captures authorized revision 10
subject loses observation
authority removes table in secret revision 11
  -> viewer still receives retained revision 10
new authorized observation
  -> retained record advances to the newly disclosed revision
```

Last-known detail MUST be distinguishable from live detail. Exact stale-state
styling is app-owned visual policy and remains replaceable.

## 9. Unknown presentation

One scene declares an `UnknownPresentationPolicy`:

| Mode | Required treatment |
| --- | --- |
| `fog` | cover unknown authorized coverage boundary with app-composed fog |
| `void` | draw no unknown scene/entity information |

`VTT-VIS-I018` — Fog and void are presentation-equivalent for authorization.
Switching between them MUST NOT alter the viewer-safe projection.

`VTT-VIS-I019` — Fog geometry/effects MUST derive from an authorized coverage
boundary. Hidden object geometry MUST NOT shape the fog.

`VTT-VIS-I020` — The scene policy is authoritative product configuration.
A client MAY degrade fog to void for accessibility/performance because void
reveals no additional information. It MUST NOT locally reveal unknown content.

## 10. Darkness, gaze, and indirect perception

| Condition | Required disclosure/presentation |
| --- | --- |
| never known | `none`; fog or void |
| known but outside current gaze | retained silhouette/detail according to memory |
| within geometric line of sight but unlit | no automatic live detail; use retained or alternative evidence |
| detected by non-visual sense | live disclosure limited by that sense |
| known terrain with undetected entity | terrain may render; entity remains absent |

`VTT-VIS-I021` — Geometric line of sight alone is not observation. Lighting
and the active sense capabilities participate in canonical evidence.

`VTT-VIS-I022` — Looking away or entering darkness MUST NOT cause a client to
query current secret geometry for a silhouette.

## 11. Storage semantics

Knowledge semantics are independent from the gameplay movement grid.

`VTT-VIS-I023` — Movement grid cells MUST NOT be canonical knowledge
identity or the only representable visibility scope.

The accepted storage model is hybrid:

| Store | Canonical purpose | Partition direction |
| --- | --- | --- |
| spatial knowledge coverage | known/unknown empty-space and region coverage | sparse world-space chunks/layers |
| entity/surface knowledge ledger | disclosure, evidence, precision, last-known revision | stable app references |
| authorized visual proxy | reconstruct permitted retained shape/detail after reconnect | revisioned viewer-safe descriptor |

`VTT-VIS-I024` — Point samples, GPU buffers, visibility textures, BVHs, and
render caches are derived state, not canonical knowledge persistence.

`VTT-VIS-I025` — Numeric chunk size, voxel/cell encoding, compression, and
sampling density are implementation parameters selected by benchmark. No one
fixed gameplay-grid resolution is an architectural requirement.

## 12. Vertical and multi-floor coverage

`VTT-VIS-I026` — Spatial coverage MUST represent vertical scope. One 2D mask
shared across all elevations/floors is forbidden.

`VTT-VIS-I027` — Revealing one floor/elevation range MUST NOT reveal another
unless canonical evidence explicitly spans both.

`VTT-VIS-I028` — Implementations MAY use layered 2.5D chunks, 3D chunks, or
another world-space encoding if it satisfies vertical isolation and benchmarks.
The encoding MUST remain hidden behind app/canonical capability contracts.

## 13. Point-cloud silhouette contract

A `silhouette` disclosure maps to a neutral point-cloud presentation.

Point data MUST:

- derive only from the authorized live or last-known proxy revision;
- use approximately uniform surface sampling independent from source
  tessellation;
- remain stable for one proxy revision;
- contain no secret texture, material, internals, or picking metadata;
- use bounded density and distance/view LOD;
- update by affected chunk/entity scope rather than whole-table rebuild;
- follow `VTT-RENDER-001` buffer ownership, reuse, and invalidation rules.

`VTT-VIS-I029` — Reusing current hidden geometry for retained points is
forbidden.

`VTT-VIS-I030` — Directly drawing arbitrary source vertices is a valid generic
renderer mechanism but is not sufficient evidence of uniform, secure product
silhouettes.

`VTT-VIS-I031` — Point sampling is generic derived presentation. Reusable
renderer packages MAY provide it without naming fog, memory, VTT, senses, or
disclosure.

`VTT-VIS-I032` — deck.gl remains a visual/technique reference only. No
deck.gl runtime or vendor type is adopted by this decision.

`VTT-VIS-I033` — Screen-door/alpha-hash dithering MAY support transitions or
fog boundaries, but MUST NOT replace the authorized last-known proxy with a
filter over current secret mesh data.

## 14. Authority and viewer-safe projection

`VTT-VIS-I034` — The canonical session authority computes or confirms
perception evidence, retention transitions, knowledge sharing, and the
authorized union for each viewer.

`VTT-VIS-I035` — This authority boundary does not select the host
language/runtime deferred by `GATE-004`.

`VTT-VIS-I036` — The client receives viewer-safe disclosure, not full world
state plus client-side hidden flags.

`VTT-VIS-I037` — The renderer visualizes authorized descriptors and MUST NOT
decide whether an entity is perceivable.

`VTT-VIS-I038` — UI capability checks are presentation only. The authority
rechecks observation, sharing, reveal, and memory operations.

Viewer projections MUST prevent disclosure through:

- hidden IDs, counts, revisions, or collection slots;
- picking, depth, shadow, reflection, or occlusion buffers;
- asset fetches or errors;
- collision/path failures;
- overly precise sound/effect origins;
- changes to public revisions caused only by secret state;
- GM-preview reuse of the GM disclosure projection.

## 15. Operations and first-consumer ports

Exact operation payloads remain feature-owned.

| Operation family | Product meaning | Authority |
| --- | --- | --- |
| `knowledge.share.*` | explicitly share selected authorized knowledge with a subject/group | session/rules authority |
| `knowledge.reveal.*` | explicit authority/GM knowledge grant | session authority |
| rules-owned retention transition | forget, distort, decay, refresh, or upgrade disclosure | canonical rules capability |

These are conceptual operation families, not reserved payloads or versions.
Catch-all arbitrary knowledge patches are forbidden.

A visibility/perception capability port MAY be materialized only with its first
executable consumer. It MUST:

- use app-owned knowledge/disclosure vocabulary;
- translate canonical Rust/session results without duplicating computation;
- hide ABI, host, renderer, and storage implementation;
- return only viewer-safe results.

Confirmed visibility deltas continue through `TableSessionPort`; a global event
bus or renderer-to-authority callback is forbidden.

## 16. Invalidation contract

| Change | May invalidate |
| --- | --- |
| observer pose or sense profile | that observer's affected live scopes |
| relevant occluder/light mutation | affected evidence scopes |
| confirmed knowledge evidence | affected owner and target scopes |
| retention policy transition | affected owner records |
| hidden change with no evidence | no viewer-visible knowledge revision |
| camera-only change | point LOD/view state, never canonical knowledge |

Whole-table visibility invalidation on each token movement is forbidden.

## 17. Acceptance matrix

| ID | Scenario | Required evidence |
| --- | --- | --- |
| `VTT-VIS-AC-001` | unknown entity mutates | viewer projection and public revisions reveal nothing |
| `VTT-VIS-AC-002` | known room gains unseen token | room remains known; token remains absent |
| `VTT-VIS-AC-003` | baseline hearing behind wall | presence with bounded/region precision; no exact silhouette or terrain reveal |
| `VTT-VIS-AC-004` | exceptional hearing | silhouette only when its capability grants it |
| `VTT-VIS-AC-005` | photographic memory plus unseen mutation | frozen last-known detail until new evidence |
| `VTT-VIS-AC-006` | ordinary memory after gaze loss | last-known point silhouette |
| `VTT-VIS-AC-007` | dark line of sight without alternative sense | no automatic live detail |
| `VTT-VIS-AC-008` | echolocation in darkness | only provider-granted live silhouette/detail |
| `VTT-VIS-AC-009` | fog to void switch | projection and authorization unchanged |
| `VTT-VIS-AC-010` | reveal one floor | other elevation coverage unchanged |
| `VTT-VIS-AC-011` | viewer controls two subjects | only authority-computed union appears |
| `VTT-VIS-AC-012` | GM previews player view | one renderer MAY be reused; player disclosure differs from GM disclosure |
| `VTT-VIS-AC-013` | reconnect | retained state reconstructs without current secret geometry |
| `VTT-VIS-AC-014` | point proxy LOD changes | canonical knowledge/revisions unchanged |
| `VTT-VIS-AC-015` | repeated local movement | updates remain scope-local; no whole-table point upload |

## 18. Deferred implementation parameters

The following do not reopen `E2.4`:

- numeric hearing bounds and provider-specific senses;
- knowledge-group creation/default sharing policy;
- storage codec, chunk size, vertical encoding, and compression;
- point density, size, color, animation, LOD thresholds, and transition style;
- exact visual treatment distinguishing last-known detail from live detail;
- benchmark thresholds for reveal latency, uploads, storage, and reconnect;
- authoritative host technology under `GATE-004`.

These parameters MUST preserve every invariant and acceptance scenario above.

## 19. Implementation handoff

No complete future tree or visibility port is created by this decision.

The first executable consumer MUST materialize one vertical slice, select only
its applicable acceptance scenarios, and benchmark representative map scale.
Canonical perception/visibility computation stays in the appropriate Rust
capability; `apps/vtt` owns product semantics, composition, projection, and
presentation.

Research evidence and candidate evaluation remain in
`docs/research/vtt-perception-memory-and-fog-of-war.md`
(`VTT-FOG-RESEARCH-001`).
