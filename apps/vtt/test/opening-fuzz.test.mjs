// Permanent randomized suite for the opening (door/window) redesign -- see
// apps/vtt/test/zz-opening-contract.md, section "Invariants the permanent
// randomized test enforces". Drives the REAL runtime (AppTabletopRuntime +
// real WASM adapter + a fake render port that only tracks pick targets and
// render chunks) through seeded random opening/wall ops and checks, after
// every op:
//   1. screen (pick targets + render chunks) matches engine surfaces
//   2. no topological holes on partition-type hosts (detected via hasTrait,
//      never a type-name string)
//   3. coverage: sampled points of the host's own (u,v) frame (via
//      runtime.resolveOnHost -- true positions on curved hosts too, not a
//      flat-projection guess) are drawn -- checked by a ray cast along the
//      LOCAL surface normal against the host's mesh -- iff inside the host
//      face and outside every opening pinned to it (no overdraw, no missing
//      wall). Every host-mesh triangle centroid must also round-trip through
//      projectToHost/resolveOnHost back onto the true surface within 0.05m
//      (no flat-chord triangles floating off a curved host).
//   4. pinned opening nodes lie on resolve(u,v) of their host, within 1e-4,
//      u,v in [0,1] -- guarded: only runs once nodes expose a `pin` field
//      AND the runtime exposes `resolveOnHost`; otherwise skipped with a note
//   5. openings stay attached to their host through wall edits (exercised by
//      running the wall-vertex/edge/height ops in the same op mix)
//   6. openings on the same host never overlap (checked in the host's own
//      (u,v) frame via projectToHost, so it works on curved hosts too)
//
// Host shapes: straight (wallLineTool, the original regression seeds),
// arc and Bezier (built with the real commitWallContour, the same function
// the product's wall tools call -- see apps/vtt/test/zz-bez-repro.mjs, which
// this suite's arc/Bezier setup mirrors). The straight and arc suites are
// expected to be green; the Bezier ones are EXPECTED TO FAIL right now --
// an engine fix for curved-host mesh-time cuts is in progress elsewhere.
//
// wall-line-tool.ts imports via the "@/..." alias, which plain Node has no
// resolver for. Solved locally, no --import flag needed: register a resolve
// hook synchronously, then dynamically import everything that reaches it.
import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { createAliasResolveHook } from "./support/alias-resolve-hook.mjs";

const SRC_URL = new URL("../src/", import.meta.url);
registerHooks(createAliasResolveHook(SRC_URL));

process.env.WALLS = "1"; // exercise wall vertex/edge/height edits (invariant 5)

const { readFileSync } = await import("node:fs");
const { initSync } = await import(
  "../../../libs/domains/procgen/construction-wasm/pkg/grafting_procgen_construction_wasm.js"
);
initSync({
  module: readFileSync(
    new URL("../../../libs/domains/procgen/construction-wasm/pkg/grafting_procgen_construction_wasm_bg.wasm", import.meta.url),
  ),
});

const { AppTabletopRuntime } = await import("../src/composition/tabletop/tabletop-runtime.ts");
const { createConstructionSessionAdapter } = await import("../src/adapters/construction/construction-session-wasm-adapter.ts");
const {
  createEditHistoryStack,
  DEFAULT_TOOL_PARAMS,
  panelHeightWidgetPickId,
  hasTrait,
  openingStructureType,
} = await import("../src/features/edit-construction/index.ts");
const { surfaceRefFromNodeSet } = await import("../src/entities/map/index.ts");
const { openingTool } = await import("../src/composition/tabletop/tools/openings/opening-tool.ts");
const { wallLineTool } = await import("../src/composition/tabletop/tools/walls/wall-line-tool.ts");
const { commitWallContour } = await import("../src/composition/tabletop/tools/walls/wall-shared.ts");

// ---------- generic helpers ----------

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function meshArea(mesh) {
  const P = mesh.positions, I = mesh.indices ?? Array.from({ length: P.length / 3 }, (_, i) => i);
  let a = 0;
  for (let i = 0; i + 2 < I.length; i += 3) {
    const [p, q, r] = [I[i], I[i + 1], I[i + 2]].map((k) => [P[3 * k], P[3 * k + 1], P[3 * k + 2]]);
    const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], v = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    a += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
  }
  return a;
}

const isOpening = (t) => t.surfaceType === openingStructureType.surfaceType;
const isPartition = (t) => hasTrait(t.surfaceType, "partition");
const bbox = (t) => {
  const xs = t.nodes.map((n) => n.position.x), ys = t.nodes.map((n) => n.position.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};
const posOf = (t, id) => t.nodes.find((n) => n.id === id).position;
/** Point-in-polygon; used on (u,v) pairs (host-local) and, in `hostOf`, on world (x,y) bboxes. */
const inPoly = (x, y, pts) => {
  let c = false;
  for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
    const [xi, yi] = pts[a], [xj, yj] = pts[b];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

/** Möller-Trumbore ray/triangle-mesh hit test, world space (any host orientation). */
function hitMesh(mesh, origin, dir, maxT) {
  const P = mesh.positions, I = mesh.indices ?? Array.from({ length: P.length / 3 }, (_, i) => i);
  for (let i = 0; i < I.length; i += 3) {
    const v0 = [P[3 * I[i]], P[3 * I[i] + 1], P[3 * I[i] + 2]];
    const v1 = [P[3 * I[i + 1]], P[3 * I[i + 1] + 1], P[3 * I[i + 1] + 2]];
    const v2 = [P[3 * I[i + 2]], P[3 * I[i + 2] + 1], P[3 * I[i + 2] + 2]];
    const e1 = v1.map((x, k) => x - v0[k]), e2 = v2.map((x, k) => x - v0[k]);
    const p = [dir[1] * e2[2] - dir[2] * e2[1], dir[2] * e2[0] - dir[0] * e2[2], dir[0] * e2[1] - dir[1] * e2[0]];
    const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
    if (Math.abs(det) < 1e-12) continue;
    const tv = origin.map((x, k) => x - v0[k]);
    const u = (tv[0] * p[0] + tv[1] * p[1] + tv[2] * p[2]) / det;
    if (u < 0 || u > 1) continue;
    const q = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]];
    const v = (dir[0] * q[0] + dir[1] * q[1] + dir[2] * q[2]) / det;
    if (v < 0 || u + v > 1) continue;
    const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
    if (Math.abs(t) <= maxT) return true;
  }
  return false;
}

/** Whether (u,v) sits right on a polygon's boundary -- a perturbed neighbour disagrees on inside/outside. */
function isNearPolyBoundaryUV(u, v, poly, du, dv) {
  const base = inPoly(u, v, poly);
  for (const [su, sv] of [[du, 0], [-du, 0], [0, dv], [0, -dv]]) {
    if (inPoly(u + su, v + sv, poly) !== base) return true;
  }
  return false;
}

/** An opening's outer loop, expressed in ITS HOST's own (u,v) frame via the real projectToHost -- works on any host shape. */
function openingUVPolygon(opening, host, runtime) {
  const points = opening.outerLoops[0].map((e) => posOf(opening, e.startNodeId));
  try {
    return runtime.projectToHost({ hostSurfaceKey: host.surfaceKey, points }).map((p) => [p.u, p.v]);
  } catch {
    return null;
  }
}

/**
 * The wall hosting `opening`. Prefers a real pin (target design); falls back
 * to a bbox-overlap heuristic for the current pre-pin model, so the coverage
 * and overlap invariants (3, 6) still run meaningfully today.
 */
function hostOf(opening, wallTopos, ref) {
  const pinnedNode = opening.nodes.find((n) => n.pin && n.pin.hostSurfaceKey);
  if (pinnedNode) {
    const hostRef = surfaceRefFromNodeSet(pinnedNode.pin.hostSurfaceKey);
    const byPin = wallTopos.find((w) => ref(w) === hostRef);
    if (byPin) return byPin;
  }
  const b = bbox(opening);
  let best, bestScore = -Infinity;
  for (const w of wallTopos) {
    const wb = bbox(w);
    const ox = Math.min(b.x1, wb.x1) - Math.max(b.x0, wb.x0);
    const oy = Math.min(b.y1, wb.y1) - Math.max(b.y0, wb.y0);
    const score = Math.min(ox, oy);
    if (score > bestScore) { bestScore = score; best = w; }
  }
  return best;
}

/**
 * Invariant 3: sample the host's own (u,v) frame (works for straight, arc
 * and Bezier hosts alike, since (u,v) is defined the same way for all of
 * them), resolve each sample to its TRUE world position, and cast a ray
 * along the LOCAL surface normal (from the tangent at that (u,v), via a
 * second resolve a hair further along u) against the host's rendered mesh.
 * Drawn iff inside the host face and outside every cutter pinned to it.
 */
function coverageProblems(t, cutterPolysUV, pickTargets, ref, runtime) {
  const problems = [];
  const mesh = pickTargets.get(ref(t));
  if (!mesh) return problems; // MISSING is already reported elsewhere
  const N_U = 60, N_V = 20;
  const du = 1 / N_U, dv = 1 / N_V;
  const marginU = 1.5 * du, marginV = 1.5 * dv;
  const uvs = [];
  for (let i = 1; i < N_U; i++) for (let j = 1; j < N_V; j++) uvs.push([i / N_U, j / N_V]);
  const uvsAhead = uvs.map(([u, v]) => [Math.min(1, u + du * 0.5), v]);
  let resolved, resolvedAhead;
  try {
    resolved = runtime.resolveOnHost({ hostSurfaceKey: t.surfaceKey, uv: uvs });
    resolvedAhead = runtime.resolveOnHost({ hostSurfaceKey: t.surfaceKey, uv: uvsAhead });
  } catch (error) {
    problems.push(`RESOLVE threw on ${t.surfaceType}: ${error?.message ?? error}`);
    return problems;
  }
  let missing = 0, extra = 0, total = 0;
  for (let k = 0; k < uvs.length; k++) {
    const [u, v] = uvs[k];
    if (u < marginU || u > 1 - marginU || v < marginV || v > 1 - marginV) continue;
    if (cutterPolysUV.some((poly) => isNearPolyBoundaryUV(u, v, poly, du, dv))) continue;
    const inCut = cutterPolysUV.some((poly) => inPoly(u, v, poly));
    const p = resolved[k], p2 = resolvedAhead[k];
    const tx = p2.x - p.x, tz = p2.z - p.z;
    const tl = Math.hypot(tx, tz) || 1;
    const nrm = [-tz / tl, 0, tx / tl]; // horizontal normal to the tangent, for an upright host
    const origin = [p.x - nrm[0] * 0.25, p.y, p.z - nrm[2] * 0.25];
    const drawn = hitMesh(mesh, origin, nrm, 0.5);
    if (!inCut) { total++; if (!drawn) missing++; } else if (drawn) extra++;
  }
  if (missing > 2) problems.push(`WALL MISSING ${missing}/${total} samples on ${t.surfaceType} (host (u,v) sampling, normal-ray cast)`);
  if (extra > 2) problems.push(`OVERDRAW ${extra} samples drawn inside a cutter on ${t.surfaceType} (host (u,v) sampling, normal-ray cast)`);
  return problems;
}

/**
 * Every host-mesh triangle centroid must lie on the TRUE surface: project it
 * to (u,v) and resolve back -- a flat-chord triangle across a curve fails
 * this even though it may still look area-correct from above.
 */
function offSurfaceProblems(t, pickTargets, ref, runtime, tol = 0.05) {
  const mesh = pickTargets.get(ref(t));
  if (!mesh) return [];
  const P = mesh.positions, I = mesh.indices ?? Array.from({ length: P.length / 3 }, (_, i) => i);
  if (I.length === 0) return [];
  const centroids = [];
  for (let i = 0; i < I.length; i += 3) {
    centroids.push({
      x: (P[3 * I[i]] + P[3 * I[i + 1]] + P[3 * I[i + 2]]) / 3,
      y: (P[3 * I[i] + 1] + P[3 * I[i + 1] + 1] + P[3 * I[i + 2] + 1]) / 3,
      z: (P[3 * I[i] + 2] + P[3 * I[i + 1] + 2] + P[3 * I[i + 2] + 2]) / 3,
    });
  }
  let proj, resolvedBack;
  try {
    proj = runtime.projectToHost({ hostSurfaceKey: t.surfaceKey, points: centroids });
    resolvedBack = runtime.resolveOnHost({
      hostSurfaceKey: t.surfaceKey,
      uv: proj.map((p) => [Math.min(1, Math.max(0, p.u)), Math.min(1, Math.max(0, p.v))]),
    });
  } catch (error) {
    return [`OFF-SURFACE check threw on ${t.surfaceType}: ${error?.message ?? error}`];
  }
  let maxOff = 0;
  for (let i = 0; i < centroids.length; i++) {
    const b = resolvedBack[i];
    maxOff = Math.max(maxOff, Math.hypot(b.x - centroids[i].x, b.y - centroids[i].y, b.z - centroids[i].z));
  }
  if (maxOff > tol) return [`OFF-SURFACE triangle centroid ${maxOff.toFixed(4)}m from ${t.surfaceType}'s true surface (tol ${tol})`];
  return [];
}

/** Invariant 6: no two openings on the same host may overlap, checked in the host's own (u,v) frame. */
function overlapProblems(cutterPolysUV) {
  const problems = [];
  const bboxUV = (poly) => ({
    u0: Math.min(...poly.map((p) => p[0])), u1: Math.max(...poly.map((p) => p[0])),
    v0: Math.min(...poly.map((p) => p[1])), v1: Math.max(...poly.map((p) => p[1])),
  });
  for (let i = 0; i < cutterPolysUV.length; i++) {
    for (let j = i + 1; j < cutterPolysUV.length; j++) {
      const A = cutterPolysUV[i], B = cutterPolysUV[j];
      const ba = bboxUV(A), bb = bboxUV(B);
      const u0 = Math.max(ba.u0, bb.u0), u1 = Math.min(ba.u1, bb.u1);
      const v0 = Math.max(ba.v0, bb.v0), v1 = Math.min(ba.v1, bb.v1);
      if (u1 <= u0 || v1 <= v0) continue;
      let hit = 0, total = 0;
      for (let v = v0 + 0.003; v < v1; v += 0.01) {
        for (let u = u0 + 0.002; u < u1; u += 0.01) {
          total++;
          if (inPoly(u, v, A) && inPoly(u, v, B)) hit++;
        }
      }
      if (total > 0 && hit / total > 0.02) problems.push(`OVERLAP ${hit}/${total} (u,v) samples shared between two openings on the same host`);
    }
  }
  return problems;
}

let pinNoteLogged = false;
/** Invariant 4, guarded: only runs when nodes expose `pin` and the runtime exposes `resolveOnHost`. */
function pinProblems(topos, runtime) {
  const anyPin = topos.some((t) => t.nodes.some((n) => Object.prototype.hasOwnProperty.call(n, "pin") && n.pin));
  const hasResolve = typeof runtime.resolveOnHost === "function";
  if (!anyPin || !hasResolve) {
    if (!pinNoteLogged) {
      pinNoteLogged = true;
      console.log(
        `  [invariant 4 skipped] ${anyPin ? "" : "no topology node exposes a `pin` field yet; "}` +
          `${hasResolve ? "" : "runtime has no resolveOnHost yet"} -- pin-resolve invariant not checked until the tool rewrite lands`,
      );
    }
    return [];
  }
  const problems = [];
  for (const t of topos) {
    for (const n of t.nodes) {
      if (!n.pin) continue;
      const { u, v, hostSurfaceKey } = n.pin;
      if (!(u >= -1e-9 && u <= 1 + 1e-9 && v >= -1e-9 && v <= 1 + 1e-9)) {
        problems.push(`PIN u,v out of [0,1] on node ${n.id}: u=${u} v=${v}`);
        continue;
      }
      let resolved;
      try {
        [resolved] = runtime.resolveOnHost({ hostSurfaceKey, uv: [[u, v]] });
      } catch (error) {
        problems.push(`PIN resolveOnHost threw for node ${n.id}: ${error?.message ?? error}`);
        continue;
      }
      if (!resolved) { problems.push(`PIN resolveOnHost returned nothing for node ${n.id}`); continue; }
      const [rx, ry, rz] = Array.isArray(resolved) ? resolved : [resolved.x, resolved.y, resolved.z];
      const dist = Math.hypot(rx - n.position.x, ry - n.position.y, rz - n.position.z);
      if (dist > 1e-4) {
        problems.push(
          `PIN node ${n.id} off host by ${dist.toFixed(6)}: resolve(${u},${v})=(${rx},${ry},${rz}) vs position (${n.position.x},${n.position.y},${n.position.z})`,
        );
      }
    }
  }
  return problems;
}

function checkInvariants({ topos, pickTargets, chunks, wallCount, runtime, ref }) {
  const problems = [];
  const refs = new Map(topos.map((t) => [ref(t), t]));

  // Invariant 1: screen (pick targets + render chunks) matches engine surfaces exactly.
  for (const [k, t] of refs) if (!pickTargets.has(k)) problems.push(`MISSING on screen: ${t.surfaceType}`);
  for (const k of pickTargets.keys()) if (!refs.has(k)) problems.push(`STALE on screen: ${k.slice(0, 50)}`);
  {
    let visible = 0, expected = 0;
    for (const c of chunks.values()) visible += meshArea(c.mesh);
    for (const t of topos) if (pickTargets.has(ref(t))) expected += meshArea(pickTargets.get(ref(t)));
    if (Math.abs(visible - expected) > 0.01 * Math.max(expected, 1)) {
      problems.push(`CHUNKS visible ${visible.toFixed(3)} vs faces ${expected.toFixed(3)}`);
    }
  }

  // Invariant 2: no topological holes on partition-type hosts (hasTrait, never a type-name string).
  const wallTopos = topos.filter(isPartition);
  for (const w of wallTopos) {
    if (w.holes.length !== 0) problems.push(`TOPOLOGICAL HOLE on partition ${ref(w).slice(0, 40)}: holes.length=${w.holes.length}`);
  }
  if (wallTopos.length !== wallCount) problems.push(`WALL COUNT ${wallTopos.length} != ${wallCount}`);

  // Invariants 3 + 6: per-host coverage (against openings-as-cutters, not holes) and no opening overlap.
  const openings = topos.filter(isOpening);
  const byHost = new Map();
  for (const o of openings) {
    const host = hostOf(o, wallTopos, ref);
    if (!host) continue;
    const key = ref(host);
    if (!byHost.has(key)) byHost.set(key, []);
    byHost.get(key).push(o);
  }
  for (const w of wallTopos) {
    const hosted = byHost.get(ref(w)) ?? [];
    const cutterPolysUV = hosted.map((o) => openingUVPolygon(o, w, runtime)).filter((poly) => poly !== null);
    problems.push(...coverageProblems(w, cutterPolysUV, pickTargets, ref, runtime));
    problems.push(...overlapProblems(cutterPolysUV));
    problems.push(...offSurfaceProblems(w, pickTargets, ref, runtime));
  }

  // Invariant 4 (guarded).
  problems.push(...pinProblems(topos, runtime));

  return problems;
}

// ---------- harness ----------

function createHarness() {
  const pickTargets = new Map();
  const chunks = new Map();
  const renderPort = {
    async start() {}, attachView: () => "v", detachView() {}, resizeView() {}, setFloorClipHeight() {}, pick: () => undefined,
    getMetrics: () => ({}), async dispose() {},
    applyConfirmed(c) {
      if (c.type === "surface-pick-target-upserted") pickTargets.set(c.target.surfaceRef, c.target.mesh);
      else if (c.type === "surface-pick-target-removed") pickTargets.delete(c.surfaceRef);
      else if (c.type === "map-chunk-upserted") chunks.set(c.chunk.chunkId, c.chunk);
      else if (c.type === "map-chunk-removed") chunks.delete(c.chunkId);
    },
  };
  const runtime = new AppTabletopRuntime("t", renderPort, createConstructionSessionAdapter(), { async start() {}, async dispose() {} }, []);
  let seq = 0;
  const feedback = [];
  const ctx = {
    runtime, history: createEditHistoryStack(), tableId: "t", snapToGrid: false, structureEditParams: { mode: "shape" },
    nextSequence: () => ++seq, reportSelection() {}, reportFeedback: (f) => f && feedback.push(f),
  };
  return { runtime, ctx, pickTargets, chunks, feedback };
}

const ref = (t) => surfaceRefFromNodeSet(t.surfaceKey);

// Non-straight host shapes, built with the real `commitWallContour` (what the
// product's own wall tools call), mirroring apps/vtt/test/zz-bez-repro.mjs.
const HOST_HEIGHT = 3;
const CURVED_HOST_SHAPES = {
  arc: { geometry: { kind: "arc", center: [4, -3], clockwise: false }, a: { x: 0, y: 0, z: 0 }, b: { x: 8, y: 0, z: 0 } },
  bezier: { geometry: { kind: "bezier", handle1: [1, 4], handle2: [6, -2] }, a: { x: 0, y: 0, z: 0 }, b: { x: 8, y: 0, z: 0 } },
};
const cubicBezierXZ = (p0, p1, p2, p3, t) => {
  const s = 1 - t;
  return [0, 1].map((k) => s * s * s * p0[k] + 3 * s * s * t * p1[k] + 3 * s * t * t * p2[k] + t * t * t * p3[k]);
};
/** The true rail (x,z) of a curved host, for placing opening clicks near it. */
function railFor(kind, geometry, a, b) {
  if (kind === "bezier") return (t) => cubicBezierXZ([a.x, a.z], geometry.handle1, geometry.handle2, [b.x, b.z], t);
  const [cx, cz] = geometry.center;
  const rad = Math.hypot(a.x - cx, a.z - cz);
  const a0 = Math.atan2(a.z - cz, a.x - cx);
  let sweep = Math.atan2(b.z - cz, b.x - cx) - a0;
  if (geometry.clockwise) { while (sweep > 0) sweep -= 2 * Math.PI; } else { while (sweep < 0) sweep += 2 * Math.PI; }
  return (t) => [cx + rad * Math.cos(a0 + sweep * t), cz + rad * Math.sin(a0 + sweep * t)];
}

async function runSeed(seed, opsCount = 40, hostKind = "straight") {
  const rnd = mulberry32(seed);
  const r = (a, b) => a + (b - a) * rnd();
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];

  const { runtime, ctx, pickTargets, chunks, feedback } = createHarness();
  await runtime.start();
  openingTool.onCancel(ctx);

  const log = [];
  const all = () => runtime.getAllRegionTopologies();
  const openings = () => all().filter(isOpening);
  const walls = () => all().filter(isPartition);
  const pickAt = (p) => {
    if (rnd() < 0.15) return undefined;
    const hit = openings().find((o) => { const b = bbox(o); return p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1; });
    return hit ? ref(hit) : walls()[0] && ref(walls()[0]);
  };

  function press(params, down, up, extra = {}) {
    const d = { point: down, surfaceRef: pickAt(down), ...extra };
    const g = { start: { point: down }, current: { point: up }, samples: [{ point: down }, { point: up }] };
    openingTool.onPointerDown(ctx, d, params);
    openingTool.onPointerMove(ctx, g, params);
    openingTool.previewFor?.(g, params, ctx);
    openingTool.onPointerUp(ctx, g, params);
    openingTool.onClick(ctx, { point: up, surfaceRef: pickAt(up) }, params);
  }

  const WALL = DEFAULT_TOOL_PARAMS["wall-line"];
  let length, top;
  if (hostKind === "straight") {
    // Unchanged from the original driver: the regression seeds (25, 93, 213)
    // depend on this exact rnd() call sequence for reproducibility.
    length = r(5, 12);
    wallLineTool.onPointerDown(ctx, { point: { x: 0, y: 0, z: 0 } }, WALL);
    wallLineTool.onPointerUp(ctx, { start: { point: { x: 0, y: 0, z: 0 } }, current: { point: { x: length, y: 0, z: 0 } }, samples: [] }, WALL);
    wallLineTool.onClick?.(ctx, { point: { x: length, y: 0, z: 0 } }, WALL);
    top = Math.max(...walls()[0].nodes.map((n) => n.position.y));
  } else {
    const spec = CURVED_HOST_SHAPES[hostKind];
    commitWallContour(ctx, [{ start: spec.a, end: spec.b, geometry: spec.geometry }], { ...WALL, height: HOST_HEIGHT }, "fuzz");
    length = 8;
    top = HOST_HEIGHT;
  }
  const wallCount = walls().length;
  log.push(`host=${hostKind} length~=${length} top=${top}`);
  const railFn = hostKind === "straight" ? (t) => [t * length, 0] : railFor(hostKind, CURVED_HOST_SHAPES[hostKind].geometry, CURVED_HOST_SHAPES[hostKind].a, CURVED_HOST_SHAPES[hostKind].b);

  const kinds = () => {
    const kind = rnd() < 0.3 ? "door" : "window";
    return { ...DEFAULT_TOOL_PARAMS.opening, openingKind: kind, width: r(0.5, 2.5), height: kind === "door" ? r(1.5, 2.6) : r(0.5, 1.8), sill: kind === "door" ? 0 : r(0.3, 1.5) };
  };
  const onWall = hostKind === "straight"
    ? () => ({ x: r(-0.3, length + 0.3), y: r(-0.1, top + 0.1), z: rnd() < 0.8 ? 0 : r(-0.05, 0.05) })
    : () => { const [rx, rz] = railFn(rnd()); return { x: rx + r(-0.15, 0.15), y: r(-0.1, top + 0.1), z: rz + r(-0.15, 0.15) }; };
  const q = (p) => `(${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)})`;

  for (let i = 0; i < opsCount; i++) {
    const params = kinds();
    const os = openings();
    const choice = rnd();
    let desc;
    const before = feedback.length;
    try {
      if (choice < 0.18 || os.length === 0) {
        const p = onWall(); desc = `clickCreate ${params.openingKind} w=${params.width.toFixed(2)} h=${params.height.toFixed(2)} at ${q(p)}`;
        press(params, p, p);
      } else if (choice < 0.36) {
        const a = onWall(), b = onWall(); desc = `dragCreate ${params.openingKind} ${q(a)} -> ${q(b)}`;
        press(params, a, b);
      } else if (choice < 0.58) {
        const o = pick(os), bx = bbox(o);
        const a = { x: r(bx.x0 + 0.15, bx.x1 - 0.15), y: r(bx.y0 + 0.15, bx.y1 - 0.15), z: 0 };
        const b = { x: a.x + r(-4, 4), y: a.y + r(-1.5, 1.5), z: 0 }; desc = `move ${q(a)} -> ${q(b)}`;
        press(params, a, b);
      } else if (choice < 0.76) {
        const o = pick(os), bx = bbox(o);
        const sx = pick([bx.x0, bx.x1, undefined]), sy = pick([bx.y0, bx.y1, undefined]);
        const a = { x: (sx ?? (bx.x0 + bx.x1) / 2) + r(-0.1, 0.1), y: (sy ?? (bx.y0 + bx.y1) / 2) + r(-0.1, 0.1), z: 0 };
        const b = { x: a.x + r(-3, 3), y: a.y + r(-1.5, 1.5), z: 0 }; desc = `edgeResize ${q(a)} -> ${q(b)}`;
        press(params, a, b);
      } else if (choice < 0.86) {
        const o = pick(os), bx = bbox(o);
        if (rnd() < 0.5) {
          const n = pick(o.nodes);
          const b = { x: n.position.x + r(-2, 2), y: n.position.y + r(-1, 1), z: 0 }; desc = `cornerDot ${q(n.position)} -> ${q(b)}`;
          press(params, { ...n.position, x: n.position.x + r(-0.05, 0.05) }, b, { nodeId: n.id });
        } else {
          const e = pick(o.outerLoops[0]);
          const zone = pick(["group", "single"]);
          const a = { x: (bx.x0 + bx.x1) / 2, y: (bx.y0 + bx.y1) / 2, z: 0 };
          const b = { x: a.x + r(-2, 2), y: a.y + r(-1.5, 1.5), z: 0 }; desc = `edgeDot ${zone} ${e.edgeId.slice(-12)} -> ${q(b)}`;
          press(params, a, b, { nodeId: panelHeightWidgetPickId(e.edgeId, zone) });
        }
      } else if (process.env.WALLS && choice < 0.90) {
        const w = pick(walls());
        const outer = w.outerLoops[0];
        const mode = pick(["vertex", "edge", "height"]);
        const steps = 1 + Math.floor(rnd() * 6);
        const delta = { x: r(-2, 2), y: r(-1.5, 1.5), z: rnd() < 0.5 ? 0 : r(-2, 2) };
        let down, extra;
        if (mode === "vertex") {
          const n = pick(w.nodes.filter((node) => outer.some((e) => e.startNodeId === node.id)));
          down = n.position; extra = { nodeId: n.id, surfaceRef: ref(w) };
        } else if (mode === "edge") {
          const e = pick(outer);
          const a = w.nodes.find((n) => n.id === e.startNodeId).position, b = w.nodes.find((n) => n.id === e.endNodeId).position;
          down = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }; extra = { surfaceRef: ref(w) };
        } else {
          const e = pick(outer);
          const a = w.nodes.find((n) => n.id === e.startNodeId).position, b = w.nodes.find((n) => n.id === e.endNodeId).position;
          down = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
          extra = { nodeId: panelHeightWidgetPickId(e.edgeId, pick(["group", "single"])) };
          delta.x = 0; delta.z = 0;
        }
        desc = `wall-${mode} ${q(down)} +${q(delta)} in ${steps} ticks`;
        const pts = Array.from({ length: steps + 1 }, (_, k) => ({ x: down.x + delta.x * k / steps, y: down.y + delta.y * k / steps, z: down.z + delta.z * k / steps }));
        const samples = pts.map((point) => ({ point }));
        wallLineTool.onPointerDown(ctx, { point: down, ...extra }, WALL);
        for (let k = 1; k < pts.length; k++) wallLineTool.onPointerMove(ctx, { start: samples[0], current: samples[k], samples: samples.slice(0, k + 1) }, WALL);
        wallLineTool.onPointerUp(ctx, { start: samples[0], current: samples.at(-1), samples }, WALL);
        wallLineTool.onClick?.(ctx, { point: pts.at(-1) }, WALL);
      } else if (choice < 0.93) {
        const o = pick(os), bx = bbox(o);
        const a = { x: (bx.x0 + bx.x1) / 2, y: (bx.y0 + bx.y1) / 2, z: 0 }; desc = `delete at ${q(a)}`;
        press(params, a, a);
        openingTool.onDeleteKey(ctx);
      } else {
        desc = "undo";
        const e = ctx.history.undo();
        if (e) e.kind === "transaction" ? runtime.undoTransaction(e.transactionId, "local") : runtime.applyRegionEdit(e.undo, "local", "undo");
        openingTool.onCancel(ctx);
      }
    } catch (error) {
      log.push(`#${i} ${desc}  THREW ${error?.message ?? error}`);
      return { seed, log, problems: [`THREW: ${error?.stack ?? error}`] };
    }
    const fb = feedback.slice(before).map((f) => `${f.tone}:${f.message}`).join(" / ");
    log.push(`#${i} ${desc}  => ${fb}`);
    const problems = checkInvariants({ topos: all(), pickTargets, chunks, wallCount, runtime, ref });
    if (problems.length > 0) return { seed, log, problems };
  }
  return undefined;
}

function assertNoFailure(fail) {
  if (!fail) return;
  const { seed, log, problems } = fail;
  assert.fail(
    `seed ${seed} violated invariant(s):\n  ${problems.join("\n  ")}\n\nop log:\n  ${log.join("\n  ")}`,
  );
}

// ---------- suite ----------

const DEFAULT_SEEDS = [25, 93, 213, 1, 2, 3, 4, 5, 6, 7];
const SWEEP_N = process.env.FUZZ_SEEDS ? Number(process.env.FUZZ_SEEDS) : undefined;
const SEEDS = SWEEP_N ? Array.from({ length: SWEEP_N }, (_, i) => i + 1) : DEFAULT_SEEDS;
const OPS = 40;

for (const seed of SEEDS) {
  test(`opening fuzz: seed ${seed} (straight host, ${OPS} ops, walls enabled) keeps all invariants`, async () => {
    assertNoFailure(await runSeed(seed, OPS, "straight"));
  });
}

// Arc and Bezier hosts (item 2): same op mix, built with the real
// commitWallContour instead of wallLineTool clicks. Not part of the
// FUZZ_SEEDS sweep -- that sweep is for the straight-host regression corpus.
const ARC_SEEDS = [901, 902, 903];
for (const seed of ARC_SEEDS) {
  test(`opening fuzz: seed ${seed} (arc host, ${OPS} ops, walls enabled) keeps all invariants`, async () => {
    assertNoFailure(await runSeed(seed, OPS, "arc"));
  });
}

const BEZIER_SEEDS = [801, 802, 803];
for (const seed of BEZIER_SEEDS) {
  // EXPECTED TO FAIL: curved-host mesh-time cut for Bezier hosts is being
  // fixed by another agent right now (flat-chord triangles / missing cut
  // coverage on the true curved surface).
  test(`opening fuzz: seed ${seed} (bezier host, ${OPS} ops, walls enabled) keeps all invariants`, async () => {
    assertNoFailure(await runSeed(seed, OPS, "bezier"));
  });
}

// ---------- deterministic scenario ----------

test("deterministic: lowering a wall's top corner through a window leaves no overdraw", async () => {
  const { runtime, ctx, pickTargets, chunks } = createHarness();
  await runtime.start();
  openingTool.onCancel(ctx);
  const WALL = DEFAULT_TOOL_PARAMS["wall-line"];

  // One wall, 8 units long.
  wallLineTool.onPointerDown(ctx, { point: { x: 0, y: 0, z: 0 } }, WALL);
  wallLineTool.onPointerUp(ctx, { start: { point: { x: 0, y: 0, z: 0 } }, current: { point: { x: 8, y: 0, z: 0 } }, samples: [] }, WALL);
  wallLineTool.onClick?.(ctx, { point: { x: 8, y: 0, z: 0 } }, WALL);
  const wall = runtime.getAllRegionTopologies().filter(isPartition)[0];
  const wallTop = Math.max(...wall.nodes.map((n) => n.position.y));
  const wallCount = 1;

  // One window near the top, centered on the wall.
  const windowParams = { ...DEFAULT_TOOL_PARAMS.opening, openingKind: "window", width: 1.4, height: 0.9, sill: wallTop - 1.0 };
  const a = { x: 3.3, y: wallTop - 1.0, z: 0 }, b = { x: 4.7, y: wallTop - 0.1, z: 0 };
  const down = { point: a, surfaceRef: ref(wall) };
  const gesture = { start: { point: a }, current: { point: b }, samples: [{ point: a }, { point: b }] };
  openingTool.onPointerDown(ctx, down, windowParams);
  openingTool.onPointerMove(ctx, gesture, windowParams);
  openingTool.onPointerUp(ctx, gesture, windowParams);
  openingTool.onClick(ctx, { point: b, surfaceRef: ref(wall) }, windowParams);

  assert.equal(runtime.getAllRegionTopologies().filter(isOpening).length, 1, "window was created");

  // Lower the wall's top-left corner through the window's vertical range (seed-213-style minimal replay).
  const outer = wall.outerLoops[0];
  const topLeft = wall.nodes.filter((n) => outer.some((e) => e.startNodeId === n.id))
    .reduce((best, n) => (n.position.y > (best?.position.y ?? -Infinity) && n.position.x < 4 ? n : best), undefined);
  assert.ok(topLeft, "wall has a top-left corner node");
  const dropTo = { x: topLeft.position.x, y: wallTop - 1.5, z: topLeft.position.z }; // below the window's sill
  const steps = 4;
  const pts = Array.from({ length: steps + 1 }, (_, k) => ({
    x: topLeft.position.x, z: topLeft.position.z,
    y: topLeft.position.y + (dropTo.y - topLeft.position.y) * k / steps,
  }));
  const samples = pts.map((point) => ({ point }));
  wallLineTool.onPointerDown(ctx, { point: topLeft.position, nodeId: topLeft.id, surfaceRef: ref(wall) }, WALL);
  for (let k = 1; k < pts.length; k++) wallLineTool.onPointerMove(ctx, { start: samples[0], current: samples[k], samples: samples.slice(0, k + 1) }, WALL);
  wallLineTool.onPointerUp(ctx, { start: samples[0], current: samples.at(-1), samples }, WALL);
  wallLineTool.onClick?.(ctx, { point: pts.at(-1) }, WALL);

  const problems = checkInvariants({ topos: runtime.getAllRegionTopologies(), pickTargets, chunks, wallCount, runtime, ref });
  const overdraw = problems.filter((p) => p.startsWith("OVERDRAW"));
  assert.deepEqual(overdraw, [], `unexpected overdraw after lowering the host's top corner through the window:\n  ${problems.join("\n  ")}`);
});

// EXPECTED TO FAIL right now: curved-host mesh-time cut is being fixed by
// another agent (flat-chord triangles / missing coverage on the true curve).
test("deterministic: a window mid-Bezier-wall has no missing coverage and no off-surface triangles", async () => {
  const { runtime, ctx, pickTargets, chunks } = createHarness();
  await runtime.start();
  openingTool.onCancel(ctx);
  const WALL = DEFAULT_TOOL_PARAMS["wall-line"];
  const spec = CURVED_HOST_SHAPES.bezier;

  commitWallContour(ctx, [{ start: spec.a, end: spec.b, geometry: spec.geometry }], { ...WALL, height: HOST_HEIGHT }, "fuzz");
  const wall = runtime.getAllRegionTopologies().filter(isPartition)[0];
  assert.ok(wall, "bezier wall was created");
  const wallCount = 1;

  const rail = railFor("bezier", spec.geometry, spec.a, spec.b);
  const [mx, mz] = rail(0.5); // wall midpoint by parameter (not exact arc-length midpoint, close enough to land the click)
  const windowParams = { ...DEFAULT_TOOL_PARAMS.opening, openingKind: "window", width: 1.2, height: 1.0, sill: 1 };
  const down = { point: { x: mx, y: 1.3, z: mz }, surfaceRef: ref(wall) };
  const gesture = { start: down, current: down, samples: [down] };
  openingTool.onPointerDown(ctx, down, windowParams);
  openingTool.onPointerMove(ctx, gesture, windowParams);
  openingTool.onPointerUp(ctx, gesture, windowParams);
  openingTool.onClick(ctx, down, windowParams);
  assert.equal(runtime.getAllRegionTopologies().filter(isOpening).length, 1, "window was created mid-wall");

  const problems = checkInvariants({ topos: runtime.getAllRegionTopologies(), pickTargets, chunks, wallCount, runtime, ref });
  const relevant = problems.filter((p) => p.startsWith("WALL MISSING") || p.startsWith("OFF-SURFACE"));
  assert.deepEqual(relevant, [], `bezier host has missing coverage or off-surface triangles:\n  ${problems.join("\n  ")}`);
});
