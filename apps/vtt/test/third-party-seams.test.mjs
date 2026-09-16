import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * A third-party library lives behind one module of ours, and the rest of the
 * app speaks that module's types, so no domain contract carries a vendor type
 * and swapping the implementation is a change to one file. A library with no
 * owner listed is one the app does not use at all any more.
 */
const SEAMS = {
  // Planar booleans are the engine's own (`graph-core`'s `planar_boolean`),
  // reached through `topology/planar-area.ts`. Nothing imports a second
  // implementation of them.
  "polygon-clipping": [],
};

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

test("each seamed library is imported only by its own adapter", () => {
  const problems = [];
  for (const file of sourceFiles(SRC)) {
    const key = relative(SRC, file).replaceAll("\\", "/");
    const text = readFileSync(file, "utf8");
    for (const [library, owners] of Object.entries(SEAMS)) {
      const imported = new RegExp(`from\\s+["']${library}["']`).test(text);
      if (imported && !owners.includes(key)) problems.push(`${key} imports ${library}; use ${owners.join(" or ")}`);
    }
  }
  assert.deepEqual(problems, []);
});
