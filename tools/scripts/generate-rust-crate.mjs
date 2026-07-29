// G-006 (master source S17.1/S23): scaffolds a new Rust crate following
// the exact shape every existing crate in this repo already uses
// (Cargo.toml, src/lib.rs, README.md, AGENTS.md, project.json with
// check/test targets). Exported as a library (`scaffoldCrateFiles`,
// `appendWorkspaceMember`) so both the CLI below and G-007's domain
// generator (which reuses this crate-scaffolding logic) can call it
// directly, and so tests can exercise each piece independently without
// touching the real workspace (see generate-rust-crate.test.mjs).
//
// Deliberately does NOT create any permanent crate under the real tree
// by default -- master source S4.3 (LOCKED): "Empty directories must
// not be created ahead of time." This script is a real, working tool;
// using it to scaffold a real crate is a decision for whoever has a
// real crate to add, not something this task does on its own.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "../..");

/**
 * Pure text transform: inserts `newPath` into a Cargo workspace
 * `members = [...]` array, alphabetically, preserving existing
 * formatting. Idempotent -- returns the input unchanged if `newPath` is
 * already present. Never touches a real file itself (callers decide
 * what to read/write) so it's independently unit-testable against a
 * scratch copy of Cargo.toml's text.
 */
export function appendWorkspaceMember(cargoTomlText, newPath) {
  const membersMatch = cargoTomlText.match(/members\s*=\s*\[([\s\S]*?)\]/);
  if (!membersMatch) throw new Error("no `members = [...]` array found in Cargo.toml text");

  const listText = membersMatch[1];
  const entries = [...listText.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

  if (entries.includes(newPath)) {
    return cargoTomlText; // idempotent: already a member
  }

  const updated = [...entries, newPath].sort((left, right) => left.localeCompare(right));
  const rendered = `members = [\n${updated.map((entry) => `    "${entry}",`).join("\n")}\n]`;
  return cargoTomlText.slice(0, membersMatch.index) + rendered + cargoTomlText.slice(membersMatch.index + membersMatch[0].length);
}

/**
 * Scaffolds the crate's files into `targetDir` (an absolute path).
 * Never touches root Cargo.toml or any workspace file -- purely file
 * creation under `targetDir`, so callers (and tests) control exactly
 * where that is.
 *
 * @returns {{ files: string[] }} the absolute paths written, for
 *   assertions/cleanup.
 */
export async function scaffoldCrateFiles({ targetDir, name, packageName, tags, description }) {
  const cargoToml = `[package]
name = "${packageName}"
version = "0.0.0"
edition = "2024"
publish = false
description = "${description}"

[dependencies]
`;

  const libRs = `//! ${description}
`;

  const readme = `# \`${name}\` (\`${packageName}\`)

${description}

## Status

Freshly scaffolded by \`tools/scripts/generate-rust-crate.mjs\` (G-006) --
no real logic yet. Fill in this README once real content lands.

## Targets

- \`check\` -- \`cargo check -p ${packageName}\`
- \`test\` -- \`cargo test -p ${packageName}\`

Run via Nx: \`pnpm exec nx run ${name}:check\` / \`pnpm exec nx run ${name}:test\`.
`;

  const agents = `# AGENTS.md -- \`${packageName}\`

Scope-local addendum to the root \`AGENTS.md\`. Root rules still apply.

Freshly scaffolded by \`tools/scripts/generate-rust-crate.mjs\` (G-006) --
record this crate's real invariants, boundaries, and forbidden
dependencies here once they exist.
`;

  const projectJson = `${JSON.stringify(
    {
      name,
      root: null, // filled in below once we know the repo-relative path
      projectType: "library",
      tags,
      metadata: {
        graphIr: {
          id: name,
          kind: "lib",
          tags,
        },
      },
      targets: {
        check: {
          executor: "nx:run-commands",
          options: { command: `cargo check -p ${packageName}` },
          cache: true,
          inputs: [
            "{projectRoot}/**/*",
            "{workspaceRoot}/Cargo.toml",
            "{workspaceRoot}/Cargo.lock",
            "{workspaceRoot}/rust-toolchain.toml",
          ],
        },
        test: {
          executor: "nx:run-commands",
          options: { command: `cargo test -p ${packageName}` },
          cache: true,
          inputs: [
            "{projectRoot}/**/*",
            "{workspaceRoot}/Cargo.toml",
            "{workspaceRoot}/Cargo.lock",
            "{workspaceRoot}/rust-toolchain.toml",
          ],
        },
      },
    },
    null,
    2,
  )}\n`;

  await mkdir(resolve(targetDir, "src"), { recursive: true });

  const files = [
    [resolve(targetDir, "Cargo.toml"), cargoToml],
    [resolve(targetDir, "src/lib.rs"), libRs],
    [resolve(targetDir, "README.md"), readme],
    [resolve(targetDir, "AGENTS.md"), agents],
    [resolve(targetDir, "project.json"), projectJson],
  ];

  for (const [path, content] of files) {
    await writeFile(path, content);
  }

  return { files: files.map(([path]) => path) };
}

/**
 * Fixes up the `project.json` that `scaffoldCrateFiles` wrote with the
 * real repo-relative `root` path (unknown to that function, which only
 * knows an absolute `targetDir` that may be a scratch location during
 * tests, not the crate's real workspace-relative identity).
 */
export async function setProjectRoot(targetDir, repoRelativeRoot) {
  const path = resolve(targetDir, "project.json");
  const project = JSON.parse(await readFile(path, "utf8"));
  project.root = repoRelativeRoot;
  await writeFile(path, `${JSON.stringify(project, null, 2)}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => {
    const index = args.indexOf(`--${name}`);
    return index === -1 ? fallback : args[index + 1];
  };

  const name = flag("name");
  const repoRelativePath = flag("path");
  const tags = (flag("tags", "") || "").split(",").filter(Boolean);
  if (!name || !repoRelativePath) {
    console.error("usage: generate-rust-crate.mjs --name <nx-name> --path <libs/area/crate-dir> --tags <tag,tag> [--package <cargo-name>] [--description <text>] [--out-dir <repo-relative-dir>]");
    process.exit(1);
  }
  const packageName = flag("package", `grafting-${name}`);
  const description = flag("description", `${name} crate.`);
  const outDirRelative = flag("out-dir", repoRelativePath);

  const targetDir = resolve(root, outDirRelative);
  await scaffoldCrateFiles({ targetDir, name, packageName, tags, description });
  await setProjectRoot(targetDir, repoRelativePath.replace(/\\/g, "/"));

  const cargoTomlPath = resolve(root, "Cargo.toml");
  const cargoTomlText = await readFile(cargoTomlPath, "utf8");
  const updated = appendWorkspaceMember(cargoTomlText, repoRelativePath.replace(/\\/g, "/"));
  if (updated !== cargoTomlText) {
    await writeFile(cargoTomlPath, updated);
  }

  console.log(`Scaffolded ${name} (${packageName}) at ${targetDir}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
