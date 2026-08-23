import assert from "node:assert/strict";
import test from "node:test";

import { PRIMITIVE_MESH_KIND, createAssetStore, primitiveMeshResolver, resourceRef } from "../dist/index.js";

const provenance = { origin: "test", license: "NONE" };

const box = (ref, revision = 1) => ({
  ref: resourceRef(ref),
  kind: PRIMITIVE_MESH_KIND,
  revision,
  source: { shape: "box", width: 1, height: 1, depth: 1 },
  provenance,
});

/** A catalogue listing exactly what it is handed, under a name. */
const catalogue = (id, entries) => ({ id, async list() { return entries; } });

test("two catalogues coexist; the second does not replace the first", async () => {
  const store = createAssetStore();
  store.registerResolver(primitiveMeshResolver);

  const shipped = await store.load(
    catalogue("default", [box("default:grass/meadow"), box("default:grass/dry")]),
  );
  const imported = await store.load(
    catalogue("imported", [box("imported:grass/swamp"), box("imported:grass/tundra")]),
  );

  assert.equal(shipped, 2);
  assert.equal(imported, 2);
  // The point of the whole exercise: importing added types, it did not take
  // any away.
  assert.deepEqual(
    store.inventory().map((entry) => entry.ref).sort(),
    ["default:grass/dry", "default:grass/meadow", "imported:grass/swamp", "imported:grass/tundra"],
  );
});

test("a second catalogue reusing a name is refused, and the first survives", async () => {
  const store = createAssetStore();
  const rejections = [];
  store.observe((event) => {
    if (event.type === "rejected") rejections.push(event);
  });

  await store.load(catalogue("default", [box("grass/meadow")]));
  const accepted = await store.load(
    catalogue("imported", [box("grass/meadow"), box("grass/swamp")]),
  );

  assert.equal(accepted, 1, "the colliding entry is not counted as declared");
  assert.equal(store.inventory().length, 2);

  assert.equal(rejections.length, 1);
  assert.equal(rejections[0].ref, "grass/meadow");
  assert.equal(rejections[0].reason, "already-declared");
  // Which pack collided is the first thing anyone asks.
  assert.equal(rejections[0].sourceId, "imported");
  assert.match(rejections[0].detail, /already declared at revision 1/);
});

test("the surviving declaration is the first one, not the last", async () => {
  const store = createAssetStore();
  store.registerResolver(primitiveMeshResolver);

  store.define({ ...box("grass/meadow"), dimensions: { x: 1, y: 1, z: 1 } });
  store.define({ ...box("grass/meadow"), dimensions: { x: 9, y: 9, z: 9 } });

  assert.deepEqual(
    store.peek(resourceRef("grass/meadow")).dimensions,
    { x: 1, y: 1, z: 1 },
    "the later declaration overwrote the earlier one",
  );
});

test("a higher revision is an update, because that means the same thing changed", async () => {
  const store = createAssetStore();
  store.registerResolver(primitiveMeshResolver);
  const ref = resourceRef("imported:grass/swamp");

  assert.equal(store.define(box(ref, 1)), "declared");
  // The user re-imported the file after editing it. That is not two things
  // fighting over a name; it is one thing with new content.
  assert.equal(store.define(box(ref, 2)), "updated");
  assert.equal(store.peek(ref).revision, 2);

  // An older revision arriving late must not undo it.
  assert.equal(store.define(box(ref, 1)), "rejected");
  assert.equal(store.peek(ref).revision, 2);
});

test("a definition with no provenance is refused, with a reason worth reading", async () => {
  const store = createAssetStore();
  const rejections = [];
  store.observe((event) => {
    if (event.type === "rejected") rejections.push(event);
  });

  const { provenance: _dropped, ...withoutProvenance } = box("imported:grass/swamp");
  assert.equal(store.define(withoutProvenance), "rejected");

  assert.equal(store.inventory().length, 0);
  assert.equal(rejections[0].reason, "invalid");
  assert.match(rejections[0].detail, /provenance is required/);
});

test("provenance must say something, not merely be present", async () => {
  const store = createAssetStore();

  assert.equal(
    store.define({ ...box("a"), provenance: { origin: "", license: "CC0" } }),
    "rejected",
  );
  assert.equal(
    store.define({ ...box("b"), provenance: { origin: "user", license: "" } }),
    "rejected",
  );
  // "unknown" is a real answer -- an imported file often has no better one, and
  // demanding a licence identifier would only teach people to invent one.
  assert.equal(
    store.define({ ...box("c"), provenance: { origin: "imported by user", license: "unknown" } }),
    "declared",
  );
});

test("one malformed entry does not stop the rest of a pack declaring", async () => {
  const store = createAssetStore();
  store.registerResolver(primitiveMeshResolver);

  const accepted = await store.load(
    catalogue("imported", [
      box("imported:grass/swamp"),
      { ref: "", kind: PRIMITIVE_MESH_KIND, revision: 1, source: {}, provenance },
      { ...box("imported:grass/tundra"), revision: Number.NaN },
      box("imported:grass/moss"),
    ]),
  );

  // An imported pack is untrusted input. Throwing would let one bad row take
  // down the application that loaded it.
  assert.equal(accepted, 2);
  assert.deepEqual(
    store.inventory().map((entry) => entry.ref).sort(),
    ["imported:grass/moss", "imported:grass/swamp"],
  );
});

test("a rejected entry leaves nothing behind to acquire", async () => {
  const store = createAssetStore();
  store.registerResolver(primitiveMeshResolver);
  const { provenance: _dropped, ...withoutProvenance } = box("imported:grass/swamp");

  store.define(withoutProvenance);

  assert.equal(store.status(resourceRef("imported:grass/swamp")).state, "undeclared");
  assert.throws(() => store.acquire(resourceRef("imported:grass/swamp")), /no definition declared/);
});
