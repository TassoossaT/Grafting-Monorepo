import assert from "node:assert/strict";
import test from "node:test";

import { brushSweptOutlinePolygons } from "../src/composition/tabletop/tools/preview-shapes.ts";

const RADIUS = 3;

function at(x, z) {
  return { x, y: 0, z };
}

/** Rough area of a multipolygon's outer rings, by the shoelace formula. */
function outerArea(multiPolygon) {
  let total = 0;
  for (const polygon of multiPolygon) {
    const ring = polygon[0];
    if (ring === undefined) continue;
    let area = 0;
    for (let index = 0; index < ring.length; index += 1) {
      const [ax, az] = ring[index];
      const [bx, bz] = ring[(index + 1) % ring.length];
      area += ax * bz - bx * az;
    }
    total += Math.abs(area) / 2;
  }
  return total;
}

test("a straight drag sweeps roughly the capsule it should", () => {
  const swept = brushSweptOutlinePolygons([at(0, 0), at(20, 0)], RADIUS);
  assert.ok(swept.length >= 1);
  // A 20-long capsule of radius 3: 20*6 body plus a radius-3 disc of caps.
  const expected = 20 * 2 * RADIUS + Math.PI * RADIUS * RADIUS;
  assert.ok(
    Math.abs(outerArea(swept) - expected) / expected < 0.05,
    `swept area ${outerArea(swept)} is not within 5% of ${expected}`,
  );
});

/**
 * The shapes that make `polygon-clipping` give up mid-ring are the ones
 * where many capsule outlines nearly touch. A gesture is a stream of mouse
 * samples, so those arrangements arrive on their own -- the union has to be
 * total, because it runs on every pointer move and again on release.
 */
test("a stroke that doubles back over itself still returns a usable footprint", () => {
  const samples = [];
  for (let step = 0; step <= 40; step += 1) samples.push(at(step * 0.4, 0));
  for (let step = 40; step >= 0; step -= 1) samples.push(at(step * 0.4, 0.001));
  const swept = brushSweptOutlinePolygons(samples, RADIUS);
  assert.ok(swept.length >= 1, "a doubled-back stroke still sweeps something");
  assert.ok(outerArea(swept) > 0);
});

test("a tight spiral -- many nearly-touching capsules -- never throws", () => {
  const samples = [];
  for (let step = 0; step < 400; step += 1) {
    const angle = step * 0.16;
    const radius = 0.5 + step * 0.05;
    samples.push(at(Math.cos(angle) * radius, Math.sin(angle) * radius));
  }
  const swept = brushSweptOutlinePolygons(samples, RADIUS);
  assert.ok(swept.length >= 1);
  assert.ok(outerArea(swept) > 0);
});

test("a stroke of coincident samples degenerates to a single dab, not an error", () => {
  const swept = brushSweptOutlinePolygons([at(4, 4), at(4, 4), at(4, 4)], RADIUS);
  const expected = Math.PI * RADIUS * RADIUS;
  assert.ok(
    Math.abs(outerArea(swept) - expected) / expected < 0.05,
    `a stationary stroke should cover one disc, got ${outerArea(swept)}`,
  );
});

/**
 * A drag that actually defeats `polygon-clipping`.
 *
 * Found by simulating wandering drags at the terrain brush's own radius: 12
 * of 2000 make the union give up mid-ring, which is the fraction of a
 * percent that shows up as a crash while somebody is still holding the mouse
 * down. Pinned as literal coordinates because the failure lives in
 * floating-point ordering -- only these exact numbers reproduce it.
 */
const DEFEATS_THE_UNION = [
  [1.672017, 0.855657], [5.07928, -0.396486], [6.783351, -1.485373], [8.04275, -2.990961],
  [10.019202, -3.390825], [11.589382, -3.384658], [14.255583, -2.598231], [15.602184, -1.18262],
  [17.363189, 0.143786], [18.992176, 2.066907], [20.584294, 2.450025], [22.945549, 3.416512],
  [24.47457, 3.370876], [26.475527, 4.08202], [28.803965, 3.551282], [30.478841, 2.114376],
  [31.177421, 0.748551], [31.494478, -1.593737], [32.062507, -3.321739], [32.887318, -5.398496],
  [34.446297, -7.048008], [37.533711, -7.408913], [38.787929, -6.216477], [39.66467, -4.502092],
  [40.844274, -1.917754], [42.171082, -0.042994], [43.048629, 1.319418], [44.756949, 3.807981],
  [47.534486, 5.021804], [49.407851, 4.561338], [50.759385, 3.055194], [50.960469, 1.174717],
  [52.038137, -0.679816], [53.535544, -2.358596], [54.642454, -4.705474], [56.048738, -6.668542],
  [56.585237, -8.849724], [57.473027, -11.450786], [59.139662, -12.247051], [60.812689, -12.870187],
  [62.491575, -14.432675], [64.475862, -15.55268], [66.725631, -18.28075], [67.968328, -19.538283],
  [69.274885, -21.650693], [69.41069, -25.310854], [68.337872, -27.29196], [68.139613, -29.167531],
  [69.083761, -32.116808], [70.331001, -34.778223], [70.502012, -37.545123], [71.097151, -39.304124],
  [72.812218, -40.848958], [73.66282, -42.955194], [73.257778, -45.165791], [72.9569, -47.24988],
  [73.44778, -48.963743], [75.97808, -51.615888], [77.066047, -52.715513], [77.672206, -54.346813],
  [77.959984, -57.228232], [78.564952, -59.148267], [78.91499, -61.323604], [79.943117, -63.333032],
  [80.494049, -65.434662], [81.038262, -67.706705], [82.770214, -69.626998], [84.381734, -70.297065],
  [86.441618, -70.754631], [88.379086, -71.859998], [91.164199, -73.075446], [94.178636, -73.524888],
  [96.524525, -73.619847], [98.730223, -74.499095], [100.417409, -74.814106], [101.515882, -75.999389],
  [103.350678, -77.561411], [105.145071, -79.290917],
];

test("a drag the polygon union cannot resolve degrades instead of throwing", () => {
  const samples = DEFEATS_THE_UNION.map(([x, z]) => at(x, z));
  const swept = brushSweptOutlinePolygons(samples, RADIUS);
  assert.ok(swept.length >= 1, "the stroke still has a footprint");
  // The fallback keeps whatever it could not merge as its own polygon, so no
  // swept area is lost: this drag covers far more than a single dab.
  assert.ok(
    outerArea(swept) > Math.PI * RADIUS * RADIUS * 10,
    `degraded footprint lost too much area: ${outerArea(swept)}`,
  );
});
