# VTT perception, memory, and fog-of-war research

Research-ID: `VTT-FOG-RESEARCH-001`

Status: Completed research record; normative decision accepted as
`VTT-VISIBILITY-001`

Recorded: 2026-08-12

Audience: architecture and implementation agents

Related contracts: `VTT-PRODUCT-001`, `VTT-RENDER-001`,
`ADR-0023`/`DEC-061`

## 1. Scope

This document records the research direction for:

- character-scoped knowledge and memory;
- direct and indirect senses;
- unknown, known, remembered, dark, and currently observed spaces/entities;
- fog/void presentation for unknown information;
- point-cloud silhouettes for authorized but non-detailed information;
- viewer-safe authority, storage, and rendering boundaries.

It does not implement fog, select the authoritative host, or adopt a new
rendering dependency. Its accepted normative result is
`docs/architecture/vtt-visibility-and-knowledge-contract.md`.

## 2. Owner requirements

`VTT-FOG-REQ-001` — A character can distinguish places for which it has
information from places for which it has none.

`VTT-FOG-REQ-002` — Memory fidelity is rules-driven. A character may have
photographic memory.

`VTT-FOG-REQ-003` — Non-visual senses can disclose otherwise hidden or
unseen elements. Better hearing may disclose more than baseline hearing.

`VTT-FOG-REQ-004` — Unknown information is either covered by fog, when that
presentation is enabled, or not drawn.

`VTT-FOG-REQ-005` — Authorized places/entities not directly observed, such
as a known dark place or a place outside the current gaze, use a point-cloud
silhouette inspired by deck.gl's `PointCloudLayer`.

`VTT-FOG-REQ-006` — Point cloud is a visual reference, not authorization to
adopt deck.gl or expose VTT semantics from a reusable renderer package.

## 3. Research conclusion: four independent axes

A single `unknown | remembered | observed` enum is insufficient. It conflates
four dimensions that MUST remain independent:

| Axis | Question | Example values |
| --- | --- | --- |
| evidence | how was information obtained? | sight, hearing, prior map, communication, explicit reveal, rules capability |
| disclosure | what may this character know? | none, presence, silhouette, detail |
| temporal relation | is the information current? | live, last-known |
| presentation | how is authorized information drawn? | void, fog, point silhouette, normal |

Required pipeline:

```text
canonical world state
  -> canonical perception evidence
  -> character/group knowledge ledger
  -> viewer-safe disclosure projection
  -> app-owned presentation policy
  -> generic renderer mechanisms
```

No later stage may recover information removed by an earlier stage.

## 4. Identity and ownership

### 4.1 Knowledge owner

Knowledge MUST NOT belong directly to a token or be reduced to participant
history.

Conceptual owners:

| Owner | Responsibility |
| --- | --- |
| `SubjectRef` | knowledge and retention of one rules/content subject |
| `KnowledgeGroupRef` | explicitly shared party/faction knowledge |
| participant viewer | receives only the authorized union of controlled subject/group knowledge |

Consequences:

- changing token control does not move or erase character memory;
- two tokens referencing one subject use that subject's knowledge;
- one participant controlling multiple subjects may receive their authorized
  union;
- sharing knowledge is an explicit confirmed operation/rules effect, not an
  implicit client merge;
- the GM/authority may grant knowledge without pretending it came from sight.

### 4.2 Spatial versus entity knowledge

Spatial coverage and entity detection MUST remain separate.

- Knowing a room's shape does not reveal a creature never detected inside it.
- Hearing a creature does not automatically mark the surrounding room explored.
- Remembering terrain does not reveal a door, trap, or token added later.
- A surface/entity knowledge record references stable app identity and the
  revision actually disclosed.

## 5. Evidence model

Evidence modality MUST be an open, rules-composed capability ID, not a fixed
engine enum. Illustrative modalities include direct sight, hearing, tremor,
echolocation, prior knowledge, communication, and explicit authority reveal.

Conceptual evidence:

```ts
interface PerceptionEvidence {
  readonly knowledgeOwner: KnowledgeOwnerRef;
  readonly sourceCapability: CapabilityId;
  readonly target: SpatialScopeRef | EntityRef;
  readonly maximumDisclosure: DisclosureLevel;
  readonly temporalRelation: live | last-known;
  readonly spatialPrecision: exact | bounded | region;
  readonly observedRevision?: RevisionRef;
  readonly occurredAt: AuthoritySequence;
}
```

This is a research shape, not an implementation contract. Normative semantics
are in `VTT-VISIBILITY-001`; exact types belong to the first executable
consumer.

### 5.1 Disclosure levels

| Level | Authorized information | Default visual consequence |
| --- | --- | --- |
| `none` | no presence, shape, identity, or position | unknown policy: fog or void |
| `presence` | something exists; location may be uncertain | non-geometric cue or bounded noisy field |
| `silhouette` | authorized approximate shape/volume, no surface detail | neutral point-cloud silhouette |
| `detail` | authorized observable attributes and geometry | normal or explicitly last-known presentation |

Disclosure levels are ordered only for information filtering. They MUST NOT
imply that every sense progresses through every level.

Examples:

- baseline hearing MAY yield `presence` with bounded position;
- exceptional hearing MAY yield `silhouette`;
- echolocation MAY yield live `silhouette` without light;
- direct illuminated sight MAY yield live `detail`;
- ordinary retained vision MAY yield last-known `silhouette`;
- photographic memory MAY retain last-known `detail`.

The rules capability decides these mappings. The renderer does not.

## 6. Memory semantics

`VTT-FOG-MEM-001` — Memory stores the last authorized disclosure, never a
live link to secret current state.

`VTT-FOG-MEM-002` — Photographic memory retains last-known `detail` only for
attributes that were observable at that time. It does not disclose interiors,
secret metadata, or later mutations.

`VTT-FOG-MEM-003` — Ordinary memory MAY reduce retained disclosure to
`silhouette`, according to the selected rules provider.

`VTT-FOG-MEM-004` — Decay, distortion, forgetting, and refresh are rules
effects over knowledge records. They are not renderer behavior.

Required scenario:

```text
subject observes room revision 10 containing a table
  -> retained record references authorized revision 10
subject leaves
authority removes table in revision 11 without new evidence
  -> viewer still receives last-known revision 10
new authorized observation arrives
  -> retained record advances to the newly disclosed revision
```

Rendering hidden revision 11 as the subject's memory is an information leak.

## 7. Unknown, darkness, and current gaze

`UnknownPresentationPolicy` has exactly two product meanings:

| Mode | Treatment |
| --- | --- |
| `fog` | cover unknown scope with an app-composed fog volume/effect |
| `void` | draw no unknown scene/entity information |

This policy MUST NOT change disclosure or cause the client to receive secret
geometry. Fog geometry MUST derive from the authorized coverage boundary, not
from the silhouette of hidden objects.

The following conditions remain distinct:

| Condition | Required interpretation |
| --- | --- |
| never known | `none`; fog or void |
| known but outside current gaze | last-known silhouette/detail according to retention |
| inside geometric line of sight but unlit | no automatic detail; use other evidence or retained knowledge |
| currently detected by a non-visual sense | live disclosure limited by that sense |
| known terrain containing an undetected entity | terrain may render as known; entity remains absent |

## 8. Storage direction

The semantic model SHOULD be grid-independent. A gameplay movement grid MUST
NOT define what can be known.

The leading storage direction is hybrid:

| Store | Purpose | Candidate partition |
| --- | --- | --- |
| spatial knowledge coverage | known/unknown regions, including empty space | sparse world-space chunks/layers |
| entity/surface knowledge ledger | disclosure, evidence, last-known revision, precision | stable entity/surface references |
| authorized visual proxy | reconstruct last-known silhouette/detail after reconnect | revisioned, viewer-safe derived descriptor |

Point samples are renderer-derived data and SHOULD NOT be authoritative
persistence. Exact chunk/voxel representation, resolution, compression, and
vertical layering remain open until benchmarked against representative 3D maps.

## 9. Authority and viewer safety

`VTT-FOG-AUTH-001` — The canonical session authority computes or confirms
perception evidence and knowledge transitions. This fixes responsibility
without selecting the host language/runtime deferred by `GATE-004`.

`VTT-FOG-AUTH-002` — The client receives a viewer-safe disclosure projection,
not full world state plus visibility flags.

`VTT-FOG-AUTH-003` — The renderer visualizes already-authorized descriptors.
It MUST NOT decide whether a hidden entity is perceivable.

`VTT-FOG-AUTH-004` — UI capability checks are presentation only. The session
authority rechecks observation, sharing, reveal, and memory operations.

Potential leak channels that future acceptance tests MUST cover:

- current hidden geometry reused for a remembered silhouette;
- hidden entity IDs or counts present in projection maps;
- picking/depth/shadow buffers exposing absent entities;
- asset requests revealing secret types;
- collision or path errors revealing hidden obstacles;
- revision counters changing when only secret state changed;
- sound playback or effect origin being more precise than its disclosure;
- GM preview reusing the GM projection instead of the selected viewer projection.

## 10. Point-cloud technique assessment

### 10.1 deck.gl reference

deck.gl's `PointCloudLayer` consumes explicit positions, normals, and colors,
with a global point radius in pixels, meters, or common units. Its shaders
expand each point into a camera-facing primitive and discard fragments outside
the circular footprint.

Useful properties to copy as a technique:

- explicit point records rather than implicit fog semantics;
- circular/sprite point footprint;
- optional lighting through normals;
- configurable point size;
- buffer-oriented input and GPU rendering.

Properties not to copy:

- deck.gl as a second renderer;
- geospatial coordinate-system assumptions;
- vendor types in Grafting contracts;
- full picking metadata for remembered/hidden elements.

### 10.2 Current repository capability

`@grafting/render-3d` already exposes the generic
`MaterialDescriptor { surface: points }` mechanism. Its Three.js backend
creates `THREE.Points` with `THREE.PointsMaterial`.

This proves that point rendering is expressible, but the current mechanism
draws the input geometry's vertices directly. It is not yet a complete
fog/memory solution:

| Risk | Consequence |
| --- | --- |
| density follows source tessellation | identical knowledge has inconsistent visual fidelity |
| coarse geometry has too few vertices | silhouette becomes unreadable |
| dense geometry has too many vertices | excess upload/draw cost |
| live geometry is reused after it becomes secret | unobserved mutations leak |
| fresh random resampling occurs per frame | points shimmer and memory appears unstable |
| one full buffer rebuild per reveal | reveal cost scales with the whole cloud |

The existing test that reuses one heightfield for observed and remembered
rendering demonstrates generic material substitution only. Product code MUST
interpret that as safe only when the supplied geometry revision is authorized.

### 10.3 Sampling direction

The point silhouette SHOULD use:

- approximately uniform surface sampling;
- stable sampling for one geometry/proxy revision;
- neutral app-selected color with no secret texture/material;
- bounded point density and distance-based LOD;
- incremental/chunk-scoped buffer updates;
- explicit buffer ownership/reuse per `VTT-RENDER-001`;
- no picking unless the disclosure explicitly permits interaction.

Three.js `MeshSurfaceSampler` is a technique candidate: it builds a sampler in
`O(n)`, samples in `O(log n)`, and permits a caller-supplied random
generator. It is not adopted by this research. Sampling is a generic rendering
mechanism; VTT disclosure policy remains in `apps/vtt`.

Screen-door/alpha-hash dithering is not an equivalent substitute. It filters a
complete mesh and can retain edges/detail from the secret current geometry.
It MAY be evaluated later for fog boundaries or transitions, not as the
authoritative remembered representation.

## 11. Candidate assessment

| Candidate/reference | License | Research status | Role |
| --- | --- | --- | --- |
| deck.gl `PointCloudLayer` | MIT | Reference only | visual and buffer-layout technique; MUST NOT become a second renderer |
| Three.js `Points`/`PointsMaterial` | MIT | Existing generic mechanism | renderer-private execution behind Grafting descriptors |
| Three.js `MeshSurfaceSampler` | MIT | Reference/spike candidate | uniform derived surface sampling; not adopted |
| `three-mesh-bvh` | MIT | Existing registry first-pick candidate, not adopted here | future generic spatial-query acceleration; requires measurement and canonical-authority review |
| Foundry `FogExploration` | proprietary product/API documentation | Pattern reference only | proves scene/user-scoped exploration; its 2D JPEG record is insufficient here |
| Foundry `DetectionMode` | proprietary product/API documentation | Pattern reference only | corroborates extensible multiple sense modes |
| MapTool hard/soft/individual fog | open-source product reference; license already tracked in registry | Pattern reference only | corroborates separating unexplored, explored, current vision, light, and per-token knowledge |

No new dependency is adopted. No third-party code is copied.

## 12. Invalidation and performance constraints

Visibility/knowledge invalidation MUST use narrow dependency scopes.

| Change | May invalidate |
| --- | --- |
| observer pose or sense profile | that observer's affected live perception scopes |
| relevant occluder/light mutation | affected perception scopes only |
| confirmed knowledge evidence | affected knowledge owner and target scopes |
| retained-memory policy change | affected owner records only |
| token-only mutation outside disclosure | no terrain/fog upload visible to that viewer |
| camera-only change | LOD/view presentation, not canonical knowledge |

The implementation MUST NOT rebuild a whole-table point cloud on each movement
or reveal. Representative benchmarks must measure update latency, points
uploaded, allocations, retained memory size, and reconnect payload size.

## 13. Accepted E2.4 decision shape

The owner accepted the following direction on 2026-08-12. Its normative form
is `VTT-VISIBILITY-001`:

1. Knowledge semantics are independent from gameplay grid.
2. Knowledge belongs to subjects/groups; viewers receive authorized unions.
3. Evidence modality is an open capability composed by the rules system.
4. Disclosure uses orthogonal level, temporal relation, and spatial precision.
5. Unknown presentation is `fog | void` and never changes authorization.
6. Point-cloud silhouette represents authorized `silhouette`, never secret
   current geometry.
7. Photographic memory retains last-known detail, not live hidden state.
8. The session authority confirms evidence and memory; host technology remains
   deferred by `GATE-004`.
9. Storage is hybrid: sparse world-space coverage plus stable entity/surface
   knowledge records.
10. Point samples are generic renderer derivation, not canonical persistence.

## 14. Implementation parameters remaining

`E2.4` is closed. These replaceable implementation parameters do not reopen
the accepted architecture:

- numeric hearing bounds and provider-specific capability upgrades;
- rules-provider memory decay/distortion behavior, if any;
- knowledge-group creation and default sharing policy;
- exact world-space coverage codec, chunk size, compression, and resolution;
- layered 2.5D versus 3D vertical encoding, provided floor isolation holds;
- point density, color, animation, LOD, and transition visual policy;
- exact stale-information treatment for photographic last-known detail;
- benchmark thresholds for reveal cost, storage, and reconnect payload.

## 15. Future acceptance scenarios

| Scenario | Required result |
| --- | --- |
| unknown entity mutates | viewer projection/revisions do not reveal that mutation |
| known room gains unseen token | room remains known; token remains absent |
| heard target behind wall | disclosure matches hearing capability and uncertainty; no extra terrain reveal |
| photographic memory after unseen mutation | last-known detail remains frozen until new evidence |
| ordinary memory after leaving gaze | configured retained silhouette appears |
| dark line of sight without another sense | no automatic live detail |
| echolocation in darkness | live silhouette only, if the rules capability grants it |
| switch unknown presentation | fog/void changes without projection-authority change |
| same viewer controls two subjects | projection contains only the authorized union |
| GM previews one player | shared renderer may be reused; selected viewer projection must differ from GM projection |
| reconnect | authorized retained state is reconstructible without secret current geometry |

## 16. Primary sources

- deck.gl `PointCloudLayer` API:
  <https://deck.gl/docs/api-reference/layers/point-cloud-layer>
- deck.gl point-cloud fragment shader:
  <https://github.com/visgl/deck.gl/blob/9.3-release/modules/layers/src/point-cloud-layer/point-cloud-layer-fragment.glsl.ts>
- deck.gl performance guide:
  <https://deck.gl/docs/developer-guide/performance>
- Three.js `PointsMaterial`:
  <https://threejs.org/docs/pages/PointsMaterial.html>
- Three.js `MeshSurfaceSampler`:
  <https://threejs.org/docs/pages/MeshSurfaceSampler.html>
- Three.js material alpha-hash behavior:
  <https://threejs.org/docs/pages/Material.html>
- Foundry VTT `FogExplorationData`:
  <https://foundryvtt.com/api/interfaces/foundry.documents.types.FogExplorationData.html>
- Foundry VTT `DetectionMode`:
  <https://foundryvtt.com/api/v14/classes/foundry.canvas.perception.DetectionMode.html>
- Foundry VTT token detection modes:
  <https://foundryvtt.com/article/tokens/>
- MapTool fog-of-war model:
  <https://wiki.rptools.info/index.php/Fog_of_War>
- MapTool separation of sight, light, darkness, and fog:
  <https://wiki.rptools.info/index.php/Introduction_to_Lights_and_Sights>
- `three-mesh-bvh` capabilities and constraints:
  <https://github.com/gkjohnson/three-mesh-bvh>
