// G-007 tests. Same in-repo scratch-directory discipline as
// generate-rust-crate.test.mjs (see that file's header for why an OS
// temp directory or `spikes/` wouldn't prove Nx discoverability) --
// nothing here is ever committed, all scratch output is deleted at the
// end of each test.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { scaffoldDomainFiles } from "./generate-domain.mjs";

const root = resolve(import.meta.dirname, "../..");

test("refuses to scaffold a public binding without --force-binding (master source S17.2)", async () => {
  await assert.rejects(
    scaffoldDomainFiles({
      targetDir: resolve(root, "libs/.wont-be-created"),
      name: "refused-binding-test",
      repoRelativeRoot: "libs/domains/refused-binding-test",
      binding: true,
      forceBinding: false,
    }),
    /do not create bindings for every domain automatically/,
  );
});

test("scaffoldDomainFiles produces a complete slice: crate + tests + contract + compute dependency, cargo-checkable and Nx-discoverable", async (t) => {
  const scratchId = randomUUID().slice(0, 8);
  const domainName = `generatortest${scratchId}`;
  const repoRelative = `libs/.generator-domain-test-${scratchId}`;
  const targetDir = resolve(root, repoRelative);
  const nxProjectName = `domain-${domainName}`;

  t.after(async () => {
    await rm(targetDir, { recursive: true, force: true });
  });

  const { files } = await scaffoldDomainFiles({
    targetDir,
    name: domainName,
    repoRelativeRoot: repoRelative,
    contract: true,
    compute: true,
    binding: false,
    forceBinding: false,
  });

  // Cargo.toml, src/lib.rs, README.md, AGENTS.md, project.json, tests/smoke.rs, contracts/<name>.fbs
  assert.equal(files.length, 7);

  const smokeTest = await readFile(resolve(targetDir, "tests/smoke.rs"), "utf8");
  assert.match(smokeTest, /#\[test\]/, "tests/ (S17.2's own output list) must be a real test file, not an empty directory");

  const fbs = await readFile(resolve(targetDir, `contracts/${domainName}.fbs`), "utf8");
  assert.match(fbs, /table Placeholder/);
  assert.match(fbs, new RegExp(`namespace Grafting\\.Domains\\.`));

  const projectJson = JSON.parse(await readFile(resolve(targetDir, "project.json"), "utf8"));
  assert.equal(projectJson.name, nxProjectName);
  assert.deepEqual(
    projectJson.implicitDependencies,
    ["engine-domain-core"],
    "--compute must produce a real Nx graph dependency (S17.2's 'graph dependencies' output), not just a comment",
  );
  assert.ok(projectJson.targets.generate, "--contract must produce a real generate target");
  assert.deepEqual(projectJson.targets.check.dependsOn, ["generate"]);

  const cargoTomlOriginal = await readFile(resolve(targetDir, "Cargo.toml"), "utf8");
  // Same Cargo workspace opt-out as generate-rust-crate.test.mjs, for
  // the same empirically-confirmed reason -- applied strictly after the
  // content assertions above.
  await writeFile(resolve(targetDir, "Cargo.toml"), `${cargoTomlOriginal}\n[workspace]\n`);
  execFileSync("cargo", ["check"], { cwd: targetDir, stdio: "pipe" });

  const nxProjectsRaw = execFileSync(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    ["exec", "nx", "show", "projects", "--json"],
    {
      cwd: root,
      encoding: "utf8",
      shell: true,
    },
  );
  const nxProjects = JSON.parse(nxProjectsRaw.trim().split("\n").pop());
  assert.ok(nxProjects.includes(nxProjectName), `expected Nx to discover ${nxProjectName}, got: ${nxProjectsRaw}`);
});
