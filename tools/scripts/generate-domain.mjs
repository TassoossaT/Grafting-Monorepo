// G-007 (master source S17.2/S23): scaffolds a new domain slice under
// `libs/domains/<name>`, per §17.2's exact input/output spec (name,
// tags, needs a contract?, needs compute?, needs a public binding? ->
// directory, member manifest, project.json, tests, local documentation,
// workspace update, graph dependencies). Reuses G-006's crate-scaffolding
// logic (a domain is still a Cargo crate) rather than duplicating it.
//
// "Do not create bindings for every domain automatically. Prefer an
// aggregated engine API" (S17.2, verbatim) -- --binding is refused
// unless --force-binding is also passed.
//
// Deliberately does NOT create any permanent domain under the real tree
// by default -- master source S4.3 (LOCKED): "Empty directories must
// not be created ahead of time." No real domain need exists yet; this
// is a real, working generator, not a reason to invent one.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { appendWorkspaceMember, scaffoldCrateFiles, setProjectRoot } from "./generate-rust-crate.mjs";

const root = resolve(import.meta.dirname, "../..");

/**
 * Scaffolds a domain slice into `targetDir` (absolute path). Returns the
 * absolute file paths written, for assertions/cleanup in tests.
 */
export async function scaffoldDomainFiles({ targetDir, name, repoRelativeRoot, contract, compute, binding, forceBinding }) {
  if (binding && !forceBinding) {
    throw new Error(
      "refusing to scaffold a public binding automatically (master source S17.2: " +
        "\"do not create bindings for every domain automatically; prefer an aggregated " +
        "engine API\") -- pass --force-binding if this domain genuinely needs its own, " +
        "after confirming the aggregated engine API really can't cover it.",
    );
  }

  const packageName = `grafting-domain-${name}`;
  const tags = ["scope:domain", "lang:rust", "platform:cross", "type:domain"];
  const description = `${name} domain slice (master source S4.3) -- feature-sliced, born when a real feature needed it.`;

  const { files: crateFiles } = await scaffoldCrateFiles({
    targetDir,
    name: `domain-${name}`,
    packageName,
    tags,
    description,
  });
  await setProjectRoot(targetDir, repoRelativeRoot);

  const files = [...crateFiles];

  // Tests directory -- §17.2's "tests" output, a real (if empty-of-cases)
  // integration test file, not just a bare directory (S4.3 still applies:
  // no invented domain content, but the *harness* is real).
  const testsDir = resolve(targetDir, "tests");
  await mkdir(testsDir, { recursive: true });
  const smokeTestPath = resolve(testsDir, "smoke.rs");
  const smokeTestContent = `//! Placeholder integration test -- replace once this domain has real
//! behavior. Exists so \`cargo test\` has something real to run, not an
//! empty tests/ directory with nothing in it.

#[test]
fn crate_compiles_and_links() {
    // Intentionally trivial: proves the crate/test harness wiring
    // itself works, before any real domain logic exists.
    assert!(true);
}
`;
  await writeFile(smokeTestPath, smokeTestContent);
  files.push(smokeTestPath);

  const projectJsonPath = resolve(targetDir, "project.json");
  const project = JSON.parse(await readFile(projectJsonPath, "utf8"));

  if (compute) {
    // "graph dependencies" (S17.2): a real Nx implicitDependencies edge,
    // matching how isekai-wasm-bridge/isekai-dotnet-protocol already
    // declare theirs -- not a fake ComputeBackend implementation.
    project.implicitDependencies = ["engine-domain-core"];
  }

  if (contract) {
    // Scoped to Rust-only generation for now -- no known TS/C# consumer
    // exists yet for a domain nobody has asked for; extend the target
    // (mirroring engine-domain-core:generate's --rust/--ts/--csharp
    // triple invocation from C-005/C-006) once a real consumer needs it.
    project.targets.generate = {
      executor: "nx:run-commands",
      options: {
        command: `flatc --rust -o ${repoRelativeRoot}/src/generated ${repoRelativeRoot}/contracts/${name}.fbs`,
      },
      cache: true,
      inputs: [`{projectRoot}/contracts/*.fbs`, "{workspaceRoot}/tools/flatc-version.txt"],
      outputs: [`{projectRoot}/src/generated`],
    };
    project.targets.check.dependsOn = ["generate"];
    project.targets.test.dependsOn = ["generate"];
  }

  await writeFile(projectJsonPath, `${JSON.stringify(project, null, 2)}\n`);

  if (contract) {
    const contractsDir = resolve(targetDir, "contracts");
    await mkdir(contractsDir, { recursive: true });
    const fbsPath = resolve(contractsDir, `${name}.fbs`);
    const fbsContent = `// Starter schema for the \`${name}\` domain (G-007, master source S10.1-2).
// Not the source of truth -- replace \`Placeholder\` with this domain's
// real Command/DomainEvent/Snapshot-equivalent shapes once they exist.
// See libs/engine/domain-core/contracts/README.md for the established
// union-of-tables design this domain's own contracts should follow once
// real content lands here.

namespace Grafting.Domains.${name[0].toUpperCase()}${name.slice(1)};

table Placeholder {
  reserved: bool (id: 0);
}

root_type Placeholder;
`;
    await writeFile(fbsPath, fbsContent);
    files.push(fbsPath);
  }

  return { files };
}

async function main() {
  const args = process.argv.slice(2);
  const has = (name) => args.includes(`--${name}`);
  const flag = (name, fallback) => {
    const index = args.indexOf(`--${name}`);
    return index === -1 ? fallback : args[index + 1];
  };

  const name = flag("name");
  if (!name) {
    console.error(
      "usage: generate-domain.mjs --name <domain-name> [--contract] [--compute] [--binding] [--force-binding] [--out-dir <repo-relative-dir>]",
    );
    process.exit(1);
  }

  const repoRelativeRoot = `libs/domains/${name}`;
  const outDirRelative = flag("out-dir", repoRelativeRoot);
  const targetDir = resolve(root, outDirRelative);

  await scaffoldDomainFiles({
    targetDir,
    name,
    repoRelativeRoot,
    contract: has("contract"),
    compute: has("compute"),
    binding: has("binding"),
    forceBinding: has("force-binding"),
  });

  const cargoTomlPath = resolve(root, "Cargo.toml");
  const cargoTomlText = await readFile(cargoTomlPath, "utf8");
  const updated = appendWorkspaceMember(cargoTomlText, repoRelativeRoot);
  if (updated !== cargoTomlText) {
    await writeFile(cargoTomlPath, updated);
  }

  console.log(`Scaffolded domain "${name}" at ${targetDir}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
