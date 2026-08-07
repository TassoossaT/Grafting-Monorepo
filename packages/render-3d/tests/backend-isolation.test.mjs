import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/**
 * The package's `AGENTS.md` states that `three` may be imported only under
 * `src/backend/`. That rule was already broken once by the engine itself, and
 * nothing caught it: `api-check` inspects the public API, so a vendor import
 * buried in an internal module is invisible to it.
 *
 * This is that rule as a check rather than as prose.
 */

const SOURCE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const ALLOWED_PREFIX = path.join("backend", path.sep);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(full)));
    else if (entry.name.endsWith(".ts")) files.push(full);
  }
  return files;
}

test("three is imported only under src/backend/", async () => {
  const files = await sourceFiles(SOURCE_ROOT);
  const offenders = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (!/\bfrom\s+["']three["']/.test(source)) continue;

    const relative = path.relative(SOURCE_ROOT, file);
    if (!relative.startsWith(ALLOWED_PREFIX)) offenders.push(relative);
  }

  assert.deepEqual(
    offenders,
    [],
    `these files import the renderer outside src/backend/: ${offenders.join(", ")}`,
  );
});

test("the public entry point exposes no renderer type", async () => {
  const source = await readFile(path.join(SOURCE_ROOT, "index.ts"), "utf8");

  assert.equal(/\bthree\b/i.test(source), false, "src/index.ts must not mention the renderer");
  assert.equal(
    source.includes("backend/"),
    false,
    "src/index.ts must not re-export anything from the backend",
  );
});
