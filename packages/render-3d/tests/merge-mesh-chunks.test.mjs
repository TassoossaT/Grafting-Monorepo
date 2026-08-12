import assert from "node:assert/strict";
import test from "node:test";

import { mergeMeshChunks } from "../dist/index.js";

test("an empty input produces an empty mesh", () => {
  const merged = mergeMeshChunks([]);
  assert.equal(merged.positions.length, 0);
});

test("a single piece passes through unchanged", () => {
  const piece = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) };
  const merged = mergeMeshChunks([piece]);
  assert.equal(merged, piece, "no copy needed for one piece");
});

test("positions concatenate in order", () => {
  const a = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) };
  const b = { positions: new Float32Array([2, 0, 0, 3, 0, 0, 2, 1, 0]) };
  const merged = mergeMeshChunks([a, b]);
  assert.deepEqual(Array.from(merged.positions), [0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0]);
});

test("indices from a later piece are offset past every earlier piece's vertices", () => {
  const a = {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint16Array([0, 1, 2]),
  };
  const b = {
    positions: new Float32Array([2, 0, 0, 3, 0, 0, 2, 1, 0]),
    indices: new Uint16Array([0, 1, 2]),
  };
  const merged = mergeMeshChunks([a, b]);
  assert.deepEqual(Array.from(merged.indices), [0, 1, 2, 3, 4, 5]);
});

test("a piece without indices is merged as an implicit sequential index run, not by dropping every other piece's indices", () => {
  const indexed = {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]),
    // A quad from 4 shared vertices -- would be wrong data if indices were discarded.
    indices: new Uint16Array([0, 1, 2, 1, 3, 2]),
  };
  const flat = {
    positions: new Float32Array([5, 0, 0, 6, 0, 0, 5, 1, 0]),
  };
  const merged = mergeMeshChunks([indexed, flat]);
  assert.equal(merged.positions.length, (4 + 3) * 3, "no vertex data lost");
  assert.deepEqual(Array.from(merged.indices), [0, 1, 2, 1, 3, 2, 4, 5, 6]);
});

test("no piece having indices means the merged mesh has none either", () => {
  const a = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) };
  const b = { positions: new Float32Array([2, 0, 0, 3, 0, 0, 2, 1, 0]) };
  const merged = mergeMeshChunks([a, b]);
  assert.equal(merged.indices, undefined);
});

test("normals and uvs are dropped when any one piece is missing them", () => {
  const withExtras = {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
    uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
  };
  const bare = { positions: new Float32Array([2, 0, 0, 3, 0, 0, 2, 1, 0]) };
  const merged = mergeMeshChunks([withExtras, bare]);
  assert.equal(merged.normals, undefined);
  assert.equal(merged.uvs, undefined);
});

test("normals and uvs concatenate when every piece has them", () => {
  const a = {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
    uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
  };
  const b = {
    positions: new Float32Array([2, 0, 0, 3, 0, 0, 2, 1, 0]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
    uvs: new Float32Array([1, 1, 0, 1, 1, 0]),
  };
  const merged = mergeMeshChunks([a, b]);
  assert.equal(merged.normals.length, 18);
  assert.equal(merged.uvs.length, 12);
  assert.deepEqual(Array.from(merged.uvs.slice(6)), [1, 1, 0, 1, 1, 0]);
});

test("a large merged index run upgrades to a 32-bit index array", () => {
  const bigVertexCount = 40000;
  const a = {
    positions: new Float32Array(bigVertexCount * 3),
    indices: new Uint32Array([0, 1, 2]),
  };
  const b = { positions: new Float32Array(bigVertexCount * 3) };
  const merged = mergeMeshChunks([a, b]);
  assert.ok(merged.indices instanceof Uint32Array);
});
