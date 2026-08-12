import assert from "node:assert/strict";
import test from "node:test";

import {
  createBindTokenSubjectOperation,
  createPlaceTokenOperation,
} from "../src/features/place-token/index.ts";

const context = {
  operationId: "operation-1",
  tableId: "table-1",
  initiatedBy: "participant-1",
};

test("placement is a closed versioned operation and permits a subjectless token", () => {
  const operation = createPlaceTokenOperation(
    {
      tokenId: "token-1",
      sceneId: "scene-1",
      position: { x: 0, y: 1, z: 0 },
      appearance: { label: "Scout", color: 0x72d69e, size: 1.5 },
    },
    context,
  );

  assert.equal(operation.kind, "token.place@1");
  assert.equal(operation.payload.subjectRef, undefined);
  assert.deepEqual(operation.expected, []);
  assert.equal(Object.isFrozen(operation), true);
});

test("subject binding names only the token revision it depends on", () => {
  const operation = createBindTokenSubjectOperation(
    {
      tokenId: "token-1",
      subjectRef: "rules:subject-7",
      expectedTokenRevision: 4,
    },
    { ...context, operationId: "operation-2" },
  );

  assert.equal(operation.kind, "token.bind-subject@1");
  assert.equal(operation.payload.subjectRef, "rules:subject-7");
  assert.deepEqual(operation.expected, [{ scope: "token:token-1", revision: 4 }]);
});

test("subject binding can explicitly detach without changing token identity", () => {
  const operation = createBindTokenSubjectOperation(
    {
      tokenId: "token-1",
      subjectRef: null,
      expectedTokenRevision: 5,
    },
    { ...context, operationId: "operation-3" },
  );

  assert.equal(operation.payload.tokenId, "token-1");
  assert.equal(operation.payload.subjectRef, null);
});
