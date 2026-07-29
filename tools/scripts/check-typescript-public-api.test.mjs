import assert from "node:assert/strict";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertBaselineMatches,
  assertNoForbiddenModules,
  collectModuleSpecifiers,
  collectUndocumentedPublicApi,
  loadTypeScriptForProject,
  resolveWithinProject,
} from "./check-typescript-public-api.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const typescript = loadTypeScriptForProject(resolve(root, "packages/x6-canvas"));

test("baseline comparison accepts identity and rejects drift", () => {
  assert.doesNotThrow(() => assertBaselineMatches("public API\n", "public API\r\n"));
  assert.throws(
    () => assertBaselineMatches("public API", "changed API"),
    /TypeScript public API drifted/,
  );
});

test("documentation policy reports exported declarations and members without TSDoc", () => {
  const source = typescript.createSourceFile(
    "index.ts",
    "export interface Contract { value: string }\nexport function run(): void {}\n",
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.TS,
  );

  assert.deepEqual(collectUndocumentedPublicApi(typescript, source), [
    "export Contract",
    "export run",
    "member Contract.value",
  ]);
});

test("empty documentation blocks do not satisfy the public obligation", () => {
  const source = typescript.createSourceFile(
    "index.ts",
    "/** */ export interface EmptyDocs { /** */ value: string }\n",
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.TS,
  );

  assert.deepEqual(collectUndocumentedPublicApi(typescript, source), [
    "export EmptyDocs",
    "member EmptyDocs.value",
  ]);
});

test("forbidden modules are detected in declaration imports and import types", () => {
  const modules = collectModuleSpecifiers(
    typescript,
    'import type { Graph } from "@antv/x6";\nexport type Leaked = import("@antv/x6/lib").Cell;\n',
  );

  assert.deepEqual(modules, ["@antv/x6", "@antv/x6/lib"]);
  assert.throws(
    () => assertNoForbiddenModules(modules, ["@antv/x6"]),
    /public declaration leaks forbidden module/,
  );
});

test("contract paths cannot escape the owning project", () => {
  assert.equal(
    resolveWithinProject(resolve(root, "packages/x6-canvas"), "src/index.ts", "entryPoint"),
    resolve(root, "packages/x6-canvas/src/index.ts"),
  );
  assert.throws(
    () => resolveWithinProject(resolve(root, "packages/x6-canvas"), "../outside.md", "baseline"),
    /must stay inside the project root/,
  );
  assert.throws(
    () =>
      resolveWithinProject(
        resolve(root, "packages/x6-canvas"),
        resolve(root, "packages/x6-canvas/src/index.ts"),
        "entryPoint",
      ),
    /must be project-relative/,
  );
});
