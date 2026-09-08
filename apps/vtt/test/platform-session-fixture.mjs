import { readFileSync } from "node:fs";
import { initSync, ConstructionSession } from "../../../libs/domains/procgen/construction-wasm/pkg/grafting_procgen_construction_wasm.js";
import { createEditHistoryStack } from "../src/features/edit-construction/index.ts";

initSync({ module: readFileSync(new URL("../../../libs/domains/procgen/construction-wasm/pkg/grafting_procgen_construction_wasm_bg.wasm", import.meta.url)) });
const vector = (p) => [p.x, p.y, p.z];
const position = (p) => ({ x: p[0], y: p[1], z: p[2] });
const topology = (t) => t && ({ ...t, nodes: t.nodes.map((n) => ({ ...n, position: position(n.position) })) });
const wirePatch = (p) => ({ ...p, nodes: p.nodes.map((n) => ({ ...n, position: vector(n.position) })) });

/** A real WASM session behind the narrow source used by tools and the planner. */
export function sessionFixture() {
  const session = new ConstructionSession();
  let sequence = 0;
  const calls = { plans: 0, batches: 0, feedback: [] };
  const runtime = {
    getGraphSnapshot() { const s = JSON.parse(session.snapshot_json()); return { nodes: s.nodes.map((n) => ({ ...n, position: position(n.position) })), edges: s.edges }; },
    getAllRegionTopologies: () => JSON.parse(session.all_region_topologies_json()).map(topology),
    getRegionTopology: (surfaceKey) => topology(JSON.parse(session.region_topology_json(JSON.stringify({ surfaceKey })))),
    cloudFor: (request) => JSON.parse(session.cloud_json(JSON.stringify(request))),
    planMotion(request) {
      calls.plans++;
      const result = JSON.parse(session.plan_motion_json(JSON.stringify({ ...request, seeds: request.seeds.map((s) => ({ ...s, delta: vector(s.delta) })) })));
      return { ...result, moves: result.moves.map((m) => ({ ...m, position: position(m.position) })) };
    },
    curvedPlanarBoolean: (request) => JSON.parse(session.curved_planar_boolean_json(JSON.stringify(request))),
    planarBoolean: (request) => JSON.parse(session.planar_boolean_json(JSON.stringify(request))),
    applyRegionEdit(ops) { calls.batches++; return JSON.parse(session.move_vertices_json(JSON.stringify(ops.map((m) => ({ nodeId: m.nodeId, position: vector(m.position) }))))); },
    addPatch(patch) { const result = JSON.parse(session.add_patch_json(JSON.stringify(wirePatch(patch)))); if (result.skippedRegionIds.length) throw new Error(JSON.stringify(result)); return result; },
    applyPatchReplacement(request) { return JSON.parse(session.apply_patch_replacement_json(JSON.stringify({ ...request, patch: wirePatch(request.patch) }))); },
  };
  const ctx = { runtime, history: createEditHistoryStack(), tableId: "platform-test", snapToGrid: false, nextSequence: () => ++sequence, reportSelection() {}, reportFeedback: (f) => calls.feedback.push(f) };
  return { session, runtime, ctx, calls };
}

export function addFace(runtime, id, type, nodes) {
  const edges = nodes.map((n, i) => ({ edgeId: `${id}:edge:${i}`, startNodeId: n.id, endNodeId: nodes[(i + 1) % nodes.length].id }));
  runtime.addPatch({ nodes, edges, regions: [{ regionId: id, boundary: edges.map((e) => ({ edgeId: e.edgeId, reversed: false })), surfaceType: type, physical: true }] });
  return runtime.getAllRegionTopologies().find((t) => t.surfaceKey.includes(`region:${id}`) || t.nodes.some((n) => n.id === nodes[0].id) && t.surfaceType === type);
}

export function building() {
  const fixture = sessionFixture();
  const levels = [];
  for (let i = 0; i < 3; i++) {
    const nodes = [[0,0],[4,0],[4,4+i],[0,4+i]].map(([x,z], c) => ({ id: `p${i}:${c}`, position: { x, y: i*3, z } }));
    addFace(fixture.runtime, `platform-${i}`, "platform", nodes);
    levels.push(nodes);
  }
  for (let i = 0; i < 2; i++) addFace(fixture.runtime, `wall-${i}`, "wall-white", [levels[i][0], levels[i][1], levels[i+1][1], levels[i+1][0]]);
  addFace(fixture.runtime, "unconnected", "platform", [0,1,2,3].map((c) => ({ id: `u:${c}`, position: { x: c%2, y: 2, z: Math.floor(c/2) } })));
  return fixture;
}
