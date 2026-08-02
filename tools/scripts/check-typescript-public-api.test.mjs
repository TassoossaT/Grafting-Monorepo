import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertBaselineMatches,
  assertNoForbiddenModules,
  collectModuleSpecifiers,
  collectUndocumentedPublicApi,
  expandLocalReExports,
  loadTypeScriptForProject,
  resolveWithinProject,
} from "./check-typescript-public-api.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const typescript = loadTypeScriptForProject(resolve(root, "packages/x6-canvas"));

// Statements declared directly in the entry point never reach the
// re-export-resolution branch, so a placeholder checker is safe here --
// see the dedicated re-export test below for the branch that uses it.
const unusedChecker = undefined;

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

  assert.deepEqual(collectUndocumentedPublicApi(typescript, unusedChecker, source), [
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

  assert.deepEqual(collectUndocumentedPublicApi(typescript, unusedChecker, source), [
    "export EmptyDocs",
    "member EmptyDocs.value",
  ]);
});

test("baseline rendering keeps each directly-declared statement's own leading JSDoc comment", () => {
  // Regression test: expandLocalReExports's direct-declaration branch used
  // to call statement.getText(sourceFile), which excludes leading trivia --
  // the statement's own doc comment lives there, not in the node's own span.
  // That silently dropped every doc comment from the baseline for any
  // project with statements declared directly in the entry point (i.e. not
  // 100% re-exports), and went unnoticed because it was never exercised by
  // a test until now.
  const declarationText =
    "/** Public inputs for Foo. */\n" +
    "export interface FooProps {\n" +
    "  /** A field. */\n" +
    "  readonly a: string;\n" +
    "}\n\n" +
    "/** Runs Foo. */\n" +
    "export declare function run(): void;\n";

  const expanded = expandLocalReExports(typescript, {}, "/virtual/index.ts", declarationText, new Map());

  assert.match(expanded, /\/\*\* Public inputs for Foo\. \*\//);
  assert.match(expanded, /\/\*\* A field\. \*\//);
  assert.match(expanded, /\/\*\* Runs Foo\. \*\//);
});

test("named re-exports resolve documentation from the original declaration, not the re-export line", () => {
  const projectDir = mkdtempSync(join(tmpdir(), "check-typescript-public-api-"));
  try {
    const otherPath = join(projectDir, "other.ts");
    const indexPath = join(projectDir, "index.ts");
    writeFileSync(
      otherPath,
      "/** Public inputs for Foo. */\n" +
        "export interface FooProps {\n" +
        "  /** A field. */\n" +
        "  readonly a: string;\n" +
        "}\n\n" +
        "/** Renders Foo. */\n" +
        "export function Foo(props: FooProps): string {\n" +
        "  return props.a;\n" +
        "}\n",
      "utf8",
    );
    writeFileSync(indexPath, 'export { Foo, type FooProps } from "./other.js";\n', "utf8");

    const options = {
      module: typescript.ModuleKind.ESNext,
      moduleResolution: typescript.ModuleResolutionKind.Bundler,
      target: typescript.ScriptTarget.ES2022,
      strict: true,
    };
    const program = typescript.createProgram({
      rootNames: [indexPath],
      options,
      host: typescript.createCompilerHost(options),
    });
    const checker = program.getTypeChecker();
    const entry = program.getSourceFile(indexPath);

    assert.deepEqual(collectUndocumentedPublicApi(typescript, checker, entry), []);

    writeFileSync(indexPath, 'export { Foo, type FooProps } from "./undocumented.js";\n', "utf8");
    writeFileSync(
      join(projectDir, "undocumented.ts"),
      "export interface FooProps { readonly a: string }\nexport function Foo(props: FooProps): string { return props.a; }\n",
      "utf8",
    );
    const undocumentedProgram = typescript.createProgram({
      rootNames: [indexPath],
      options,
      host: typescript.createCompilerHost(options),
    });
    const undocumentedChecker = undocumentedProgram.getTypeChecker();
    const undocumentedEntry = undocumentedProgram.getSourceFile(indexPath);

    assert.deepEqual(
      collectUndocumentedPublicApi(typescript, undocumentedChecker, undocumentedEntry).sort(),
      ["export Foo", "export FooProps", "member FooProps.a"].sort(),
    );
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
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
