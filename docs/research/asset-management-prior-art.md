# Asset management: how other engines solve it, and what `@grafting/assets` should copy

- Research date: 2026-08-21
- Status: research. Closes no decision, adopts no dependency, and is not an ADR.
- Purpose: this document assumes **no prior experience with 3D asset
  pipelines**. It explains the problem from zero, shows how five shipped
  systems solve it, and only then applies the result to
  `docs/architecture/asset-store-package-design.md`.
- Note on method: root `AGENTS.md` §3 requires web research to be delegated via
  `ia-graft delegate research`. That CLI could not run on this machine — the
  `node` on PATH is v20.20.2 while the launcher needs the v22 pinned in
  `.node-version` for `--experimental-strip-types`. Research was done inline
  instead. Re-running it through the launcher once the toolchain is fixed would
  be a reasonable follow-up.

## 1. Why "just load the file" is not enough

The instinct is that loading a texture means fetching a PNG and handing it to
the renderer. Three facts break that instinct, and every system in §3 exists
because of them.

**Fact 1 — decoded textures are far larger than their files.** A PNG or JPG is
fully decoded to raw pixels before upload, and sits uncompressed in video
memory: *"A 2048×2048 RGBA texture is 16 MB in memory no matter how small the
PNG was"* ([Don McCurdy, "Choosing texture formats for WebGL and WebGPU
applications"](https://www.donmccurdy.com/2024/02/11/web-texture-formats/)). A
300 KB file becomes 16 MB of VRAM. Forty such textures — a modest wall/floor/
prop set — is 640 MB, which is simply gone on a laptop GPU.

**Fact 2 — the browser will not clean this up for you.** WebGL resources are
not garbage collected: *"three.js cannot automatically clean up these
resources — the browser will clean them up if you switch pages but otherwise
it's up to you"* ([three.js, "How to dispose of
objects"](https://threejs.org/docs/manual/en/introduction/How-to-dispose-of-objects.html)).
Forgetting one `dispose()` leaks until the tab is closed.

**Fact 3 — disposal is genuinely error-prone, even for experts.** three.js
issue [#23953](https://github.com/mrdoob/three.js/issues/23953) documents that
`Texture.dispose()` *does not* close the underlying `ImageBitmap` — the exact
representation `.glb` files decode to — so textures leak despite correct-looking
disposal, unless the caller also calls `texture.source.data.close?.()`. Note the
shape of that bug: the fix is one line, in one place, and the only way to have
that one place is to route disposal through a single owner.

That single owner is what an asset store *is*. It is not a convenience wrapper
around `fetch`.

## 2. The five problems, concretely

| Problem | What it looks like in the VTT |
| --- | --- |
| **Double loading** | Two walls use "stone". Without a shared cache the image downloads and decodes twice, and two 16 MB textures sit in VRAM where one belongs. |
| **Leaking** | You switch a wall from stone to wood. Nothing disposes stone. Do it forty times while designing a map and the tab dies. |
| **Premature disposal** | You dispose stone when one wall stops using it — but three other walls still do. They render black or crash. |
| **Load races** | A node drag re-triggers a rebuild sixty times a second. Sixty loads of the same texture start; results arrive out of order; the last one to finish wins, which may not be the newest. |
| **No visibility** | Something leaks. Without an inventory, finding it means bisecting the app. |

Every one of these is the same missing fact: **nobody knows who is holding
what.** That is the sentence the whole design follows from.

## 3. How five shipped systems solve it

### 3.1 Godot — `Resource` + `ResourceLoader`

The closest match to what this package needs, and open source.

A resource is *"a reference-counted, serializable data object"* that inherits
`RefCounted`, so it *"is freed automatically when all references drop to
zero"*, and carries a `resource_path` that *"uniquely identifies it in the
global cache."* `ResourceLoader` is *"a facade over multiple
`ResourceFormatLoader` instances, each responsible for loading specific file
formats"* — when a resource is requested it *"queries registered loaders
sequentially until one recognizes the file format"*
([Godot resource system](https://deepwiki.com/godotengine/godot/5-resource-system),
[ResourceLoader](https://deepwiki.com/godotengine/godot/5.1-resourceloader-and-format-system)).

**Lesson:** identity + refcount + a registry of format loaders consulted in
turn. This is exactly the `ResourceResolver` design already proposed, arrived
at independently — good sign, and worth stating plainly rather than claiming
originality.

### 3.2 Bevy — `AssetServer` + strong/weak `Handle`

Rust, open source, and the source of one idea the current design is missing.

Bevy *"separates asset loading from asset usage through a handle-based
indirection"*: assets load asynchronously and live in `Assets<T>`, while
`Handle<T>` values are cheap references. Handles are **strong or weak** —
*"Strong handles keep the asset loaded, while Weak handles do not affect the
loaded status"*, and *"when the number of Strong handles ... reach zero, the
asset is dropped and becomes unloaded"*
([Bevy asset system](https://deepwiki.com/bevyengine/bevy/4-asset-loading-and-handles),
[Bevy Cheat Book, Handles](https://bevy-cheatbook.github.io/assets/handles.html)).

Their motivating example is precise: a collider needs a sprite's image
*dimensions* but should not be the reason that image stays in memory — so it
holds a weak handle.

**Lesson to adopt:** the current `@grafting/assets` design has only strong
acquisition. A weak reference is genuinely needed — a covering that wants a
brick's `dimensions` to compute a layout should not thereby pin the brick's
mesh in memory. Add it.

### 3.3 PlayCanvas — `Asset` (record) vs. resource (data)

PlayCanvas splits the two things the word "asset" conflates: *"An `Asset` is a
record in the asset registry that contains metadata about a resource —
its name, type, tags, and a reference to the underlying resource data"*,
while *"the resource is the actual runtime data ... for example, a texture
asset's resource is the actual image data"*. Lifecycle states are explicit:
registry → loading → ready → unloading
([PlayCanvas assets](https://developer.playcanvas.com/user-manual/assets/),
[AssetRegistry API](https://api.playcanvas.com/engine/classes/AssetRegistry.html)).

Worth knowing: reference counting was a *later* request rather than the
original design ([engine issue
#440](https://github.com/playcanvas/engine/issues/440)) — a system this mature
adding it after the fact is evidence it is not optional.

**Lesson:** the `AssetDefinition` (declaration, cheap, always present) versus
resource (decoded, expensive, present only when loaded) split is the right
one — and it is what makes an inventory possible, since you can list every
declared asset whether or not it is loaded.

### 3.4 Babylon.js — `AssetsManager` and `AssetContainer`

`AssetsManager` runs typed *tasks* with per-task state; `AssetContainer` is
*"a pool of entities"* that can be added to and removed from a scene wholesale
via `addAllToScene()` / `removeAllFromScene()`
([Babylon Asset Manager](https://doc.babylonjs.com/features/featuresDeepDive/importers/assetManager)).

**Lesson to take:** per-item load state as a first-class value, not a promise
you either await or lose.
**Lesson to reject:** `AssetContainer` knows about scenes. That is precisely
the coupling `@grafting/assets` must not have — it would make the package
unusable by any consumer with a different scene model.

### 3.5 three.js — the cautionary tale

three.js has `Cache` and `LoadingManager`, but caching is opt-in and
per-loader; the request to *"put the cache in the LoadingManager so each
`ImageLoader` and `XHRLoader` would share the cache"* has been open since 2014
([issue #5650](https://github.com/mrdoob/three.js/issues/5650)). Disposal is
manual and scattered, with the `ImageBitmap` leak from §1 as the result.

**Lesson:** this is what happens when the store is a helper rather than the
owner. It is the failure mode `@grafting/assets` exists to avoid — and it is
the library sitting underneath `@grafting/render-3d` right now, which is why
the ownership must live above it.

### 3.6 Comparison

| | Identity | Refcount | Format extensibility | Load state | Knows the scene? |
| --- | --- | --- | --- | --- | --- |
| Godot | `resource_path` | yes, automatic | registered format loaders | yes | no |
| Bevy | `Handle<T>` strong/weak | yes, automatic | registered `AssetLoader`s | yes | no |
| PlayCanvas | asset id/name/tags | added later | registered handlers | explicit states | partly |
| Babylon | task/container | no | task types | per task | **yes** |
| three.js | URL as key | no | per loader | via manager | no |

The three systems that stayed decoupled from the scene (Godot, Bevy, and
mostly PlayCanvas) are the three with the cleanest asset APIs. That is not a
coincidence, and it is the strongest single argument for §5's boundary.

## 4. Textures deserve their own note

Because textures are where the memory actually goes, one format decision
matters more than the rest.

`KTX2` with Basis Universal *"stays compressed all the way into VRAM by
transcoding to a GPU-native format (BC on desktop, ASTC or ETC2 on mobile),
which typically cuts texture memory 4× to 8×"*, and all three major web
engines ship a loader for it
([three.js `KTX2Loader`](https://threejs.org/docs/pages/KTX2Loader.html),
[Don McCurdy](https://www.donmccurdy.com/2024/02/11/web-texture-formats/)).
Khronos `KHR_texture_basisu` is the ratified glTF path, already cited in
`docs/research/vtt-asset-placeable-and-assembly-architecture.md`.

The design consequence is **not** "adopt KTX2 now." It is: the store must never
assume the decoded form of an image is an `ImageBitmap`. A KTX2 texture arrives
as pre-compressed mip levels with a GPU format string, which is a different
shape entirely. `ImageResource` must therefore leave room for a compressed
variant, or adopting KTX2 later becomes a breaking change to the one contract
everything depends on.

## 5. Where the package's line is — texturas, replicação, efeitos

This answers the three things the owner asked to be covered, and the answer is
the same sentence for all three.

> `@grafting/assets` answers *"what content exists, is it loaded, and who is
> holding it."* It never answers *"how is it drawn."*

| Owner's item | What belongs to `@grafting/assets` | What does not |
| --- | --- | --- |
| **Texturas / imagens** | the declaration, the decode, the cache, the refcount, the disposal | filtering, wrapping, mipmaps, GPU upload, atlasing — all renderer |
| **Replicação de objetos** | the *prototype* — one brick's mesh, held once | the repetition itself. Placements live in `PlacementSet` on `VisualDescriptor`, and instancing/batching is the backend's choice (see `vtt-covering-contracts.md` §3.4). The store holds one brick and never learns there are a thousand. |
| **Efeitos específicos** | the effect's *content*: a sprite sheet, a noise texture, a gradient, a curve | the effect's *behavior*: shaders, blending, particle simulation, timing. Those are renderer and app. |

An effect is three separable things — content, drawing, and triggering. Only
the first is an asset. Keeping that line is what stops the package from slowly
becoming a second renderer, which is the standard way packages like this die.

## 6. What this changes in the current design

Confirmed by prior art, no change needed:

- opaque identity plus revision (Godot's `resource_path`, Bevy's `Handle`);
- definition/resource split (PlayCanvas, explicitly);
- registered per-format resolvers consulted by kind (Godot, Bevy);
- explicit load state as a value (PlayCanvas, Babylon);
- refcounted disposal through a single owner (Godot, Bevy; PlayCanvas retrofitted it);
- no scene knowledge (Godot, Bevy — and Babylon as the counter-example).

Changes to make:

1. **Add weak references** (§3.2). `acquire` is strong;
   add a non-pinning way to read metadata such as `dimensions`. Without it,
   any consumer that only needs a number keeps megabytes alive.
2. **Make `ImageResource` open to compressed textures** (§4), so KTX2 is a
   later addition rather than a breaking change.
3. **State the §5 boundary in the package's own `AGENTS.md`**, in the same
   voice `@grafting/render-3d`'s uses ("what must not enter this package").
   Every system in §3.4 that blurred this line paid for it.

## 7. Primary sources

- [Godot resource system](https://deepwiki.com/godotengine/godot/5-resource-system) · [ResourceLoader and format system](https://deepwiki.com/godotengine/godot/5.1-resourceloader-and-format-system)
- [Bevy asset loading and handles](https://deepwiki.com/bevyengine/bevy/4-asset-loading-and-handles) · [Bevy Cheat Book: Handles](https://bevy-cheatbook.github.io/assets/handles.html) · [`bevy_asset` docs](https://docs.rs/bevy_asset/latest/bevy_asset/struct.AssetServer.html)
- [PlayCanvas assets](https://developer.playcanvas.com/user-manual/assets/) · [`AssetRegistry` API](https://api.playcanvas.com/engine/classes/AssetRegistry.html) · [engine issue #440, reference-counted assets](https://github.com/playcanvas/engine/issues/440)
- [Babylon.js Asset Manager](https://doc.babylonjs.com/features/featuresDeepDive/importers/assetManager)
- [three.js: how to dispose of objects](https://threejs.org/docs/manual/en/introduction/How-to-dispose-of-objects.html) · [issue #23953, `ImageBitmap` leak](https://github.com/mrdoob/three.js/issues/23953) · [issue #5650, shared loader cache](https://github.com/mrdoob/three.js/issues/5650)
- [Don McCurdy, choosing texture formats for WebGL and WebGPU](https://www.donmccurdy.com/2024/02/11/web-texture-formats/) · [three.js `KTX2Loader`](https://threejs.org/docs/pages/KTX2Loader.html)
- `docs/architecture/asset-store-package-design.md` — the design this informs
- `docs/architecture/vtt-covering-contracts.md` — the consumer contracts
