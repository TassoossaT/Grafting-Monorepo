import assert from "node:assert/strict";
import test from "node:test";

import {
  applyTokenProjectionDelta,
  createTokenCollection,
  createTokenProjection,
} from "../src/entities/token/index.ts";

const appearance = { label: "Echo", color: 0xffffff, size: 1 };

test("a token is a placement that may exist without a rules subject", () => {
  const token = createTokenProjection({
    id: "token-empty",
    sceneId: "scene-1",
    position: { x: 1, y: 2, z: 3 },
    appearance,
    revision: 1,
  });

  assert.equal(token.subjectRef, undefined);
  assert.equal(Object.isFrozen(token), true);
  assert.equal(Object.isFrozen(token.position), true);
});

test("two independent token identities may reference the same subject", () => {
  const subjectRef = "rules:subject-7";
  const tokens = createTokenCollection([
    createTokenProjection({
      id: "token-a",
      sceneId: "scene-1",
      position: { x: 0, y: 1, z: 0 },
      subjectRef,
      appearance,
      revision: 1,
    }),
    createTokenProjection({
      id: "token-b",
      sceneId: "scene-1",
      position: { x: 2, y: 1, z: 0 },
      subjectRef,
      appearance,
      revision: 1,
    }),
  ]);

  assert.equal(tokens.byId.get("token-a").subjectRef, subjectRef);
  assert.equal(tokens.byId.get("token-b").subjectRef, subjectRef);
  assert.notEqual(tokens.byId.get("token-a").id, tokens.byId.get("token-b").id);
});

test("pose changes preserve token identity and reject stale revisions", () => {
  const original = createTokenProjection({
    id: "token-stable",
    sceneId: "scene-1",
    position: { x: 0, y: 1, z: 0 },
    appearance,
    revision: 4,
  });
  const collection = createTokenCollection([original]);
  const moved = createTokenProjection({
    ...original,
    position: { x: 3, y: 1, z: 2 },
    revision: 5,
  });
  const updated = applyTokenProjectionDelta(collection, {
    type: "token-upserted",
    token: moved,
  });

  assert.equal(updated.byId.get("token-stable").id, original.id);
  assert.equal(updated.revision, 1);
  assert.throws(
    () =>
      applyTokenProjectionDelta(updated, {
        type: "token-upserted",
        token: original,
      }),
    /revision must increase/,
  );
});
