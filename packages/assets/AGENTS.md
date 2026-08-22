# AGENTS.md — `@grafting/assets`

Scope-local addendum to the root `AGENTS.md`.

## The line this package must not cross

It answers **what content exists, whether it is loaded, and who is holding it.**
It never answers **how anything is drawn.**

That single sentence decides most questions here:

| | Belongs here | Does not |
| --- | --- | --- |
| Textures / images | declaration, decode ownership, cache, refcount, disposal | filtering, wrapping, mipmaps, GPU upload, atlasing |
| Repeated objects | the *prototype* — one mesh, held once | the repetition. Placements and instancing are the renderer's |
| Effects | the effect's *content* — sprite sheet, noise texture, gradient, curve | the effect's *behaviour* — shaders, blending, particle simulation, timing |

Babylon.js's `AssetContainer` is the counter-example worth remembering: it
knows about scenes, so it cannot be used by a consumer with a different scene
model. Every capability added here should be checked against that failure.

## What must not enter this package

- **No product concept.** No type, field, or special case named after a token,
  wall, brick, door, spell, or anything else a product draws. If something can
  only be described by naming what a consumer is building, it belongs to the
  consumer (`DEC-052`, `ADR-0014`).
- **No renderer.** Nothing imports `@grafting/render-3d`, and no renderer type
  appears in any signature. A catalog that depends on one renderer can only be
  used by consumers that already chose it, which destroys the reuse this
  package exists for. Structural duplication of a few interfaces is the
  deliberate, cheaper half of that trade — the same call
  `apps/vtt/src/ports/scene-render-port.ts` documents making.
- **No format parser in the core.** glTF, KTX2 and Basis arrive as registered
  resolvers, with their vendor confined to the owning module (`ADR-0011`).
  Nothing under `src/contracts/` or `src/store/` may import a parser.

  The package is centralised by owner decision (2026-08-22): every resource
  type lives here rather than in satellite packages. So a parser dependency in
  `package.json` is expected — what must stay true is that a consumer who never
  imports a format resolver never pays for it. `sideEffects: false` plus ESM is
  what makes that hold, so neither may be dropped. `@gltf-transform/core` is
  the first such dependency, chosen over three's `GLTFLoader` precisely because
  it needs no renderer.
- **No hardcoded location.** No URL, path, or bundled manifest. Where content
  lives is a `CatalogSource` and a `ResourceResolver`, both supplied from
  outside. Asset binaries are deliberately not versioned in this repository, so
  a location baked in here would be wrong for every environment.
- **No GPU or scene handle.** Decoded CPU-side data is where this package
  stops.

## Disposal is the reason this exists

WebGL and `ImageBitmap` resources are not garbage collected, and the classic
failure is subtle: three.js's `Texture.dispose()` does not close the underlying
`ImageBitmap`, so textures decoded from `.glb` leak despite disposal that looks
correct (mrdoob/three.js#23953). The fix is one line — but only if there is one
place to put it.

Any change that lets a resource be freed while still held, or leaves one
unfreed after its last holder releases, is a defect rather than a performance
nit. `inventory()` exists so the claim is testable; assert on it.

## Absence is an ordinary state

Asset binaries are not committed, so a fresh clone has none. The package must
behave correctly with nothing available:

- an unresolvable ref reports `failed`; it never throws into a render loop;
- no test and no CI job may depend on an asset that is not produced in-process
  — which is what `primitiveMeshResolver` is for, permanently and not just as a
  starting point;
- a failed load is recorded with its attempt count and is **not** retried in a
  loop. Retrying is the caller's explicit decision.

## When adding a capability

Ask whether two unrelated products would both want it. Reference counting and
revisioned identity pass. "A token's portrait" does not — that is a definition
the consumer declares.
