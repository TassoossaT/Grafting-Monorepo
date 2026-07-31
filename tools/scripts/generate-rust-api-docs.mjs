// G-DOCS-API-COVERAGE-EXPANSION / G-DOCS-API-AUTODISCOVERY-AND-NOISE-FILTER:
// the Rust counterpart to generate-api-docs.mjs (same generate-by-default
// / --check-diffs shape). Shells out to tools/rust-api-docgen, the shared
// binary that generalizes the Rustdoc JSON + public-api curation
// libs/graph/core/tests/public_api_snapshot.rs already proves for its own
// narrow public-API drift check (see I-003A) to any real Cargo workspace
// member: build Rustdoc JSON with the pinned nightly, derive the
// genuinely public surface (blanket impls omitted, undocumented
// derive-generated impls/methods filtered), and render a flat
// `### signature` + doc-body Markdown document -- the same shape
// generate-api-docs.mjs renders for the TypeScript side. Deliberately
// NOT the raw Rustdoc JSON model -- an earlier version of this script
// committed that directly and produced a 1.5 MB file for one crate,
// because rustdoc's own JSON index carries one entry per impl block;
// useless as agent-facing evidence. Also deliberately not JSON at all
// after that fix: the one real consumer today is an agent reading the
// whole file, and Markdown suits that better than a punctuation-heavy
// signature -> doc map.
//
// Crate discovery reads the root Cargo.toml's own [workspace] members
// list (the same source `cargo` itself uses) instead of a hardcoded
// array, same convention as generate-artifact-manifest.mjs's Cargo.toml
// text-level reads -- avoids a TOML parser dependency for one field.
// Members without a src/lib.rs (bin-only crates, including this
// generator's own tools/rust-api-docgen) are skipped: `--lib` has
// nothing to document there.
//
// An optional positional argument scopes generation to one crate instead
// of every discovered member (G-DOCS-PER-PROJECT-REGEN-RULE): `node
// tools/scripts/generate-rust-api-docs.mjs grafting-graph-core`
// regenerates only docs/generated/api/rust/grafting-graph-core.md. Per
// PROTOCOL.md, an agent completing a task regenerates docs scoped to
// whatever it touched, not the whole repo -- each of the 6 real crates
// also has this wired as its own `docs-generate`/`docs-check` Nx target,
// so `nx run graph-core:docs-generate` is the normal way to invoke it.
// The unscoped, all-crates form (no argument, what CI's docs:check chain
// calls) remains the backstop that catches anyone who skipped that step.

import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const check = process.argv.includes("--check");

async function discoverCrates() {
  const workspaceToml = await readFile(resolve(root, "Cargo.toml"), "utf8");
  const membersMatch = workspaceToml.match(/members\s*=\s*\[([\s\S]*?)\]/);
  if (!membersMatch) throw new Error("no [workspace] members array found in root Cargo.toml");
  const memberPaths = [...membersMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);

  const crates = [];
  for (const memberPath of memberPaths) {
    if (!existsSync(resolve(root, memberPath, "src/lib.rs"))) continue;
    const memberToml = await readFile(resolve(root, memberPath, "Cargo.toml"), "utf8");
    const nameMatch = memberToml.match(/^name\s*=\s*"([^"]+)"/m);
    if (!nameMatch) throw new Error(`no [package] name field found in ${memberPath}/Cargo.toml`);
    crates.push(nameMatch[1]);
  }
  return crates;
}

function generate(crateName, outputPath) {
  execFileSync(
    "cargo",
    ["run", "--locked", "-p", "grafting-rust-api-docgen", "--", crateName, outputPath],
    { cwd: root, stdio: "pipe" },
  );
}

async function main() {
  const requestedName = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
  let crates = await discoverCrates();
  if (requestedName) {
    crates = crates.filter((crateName) => crateName === requestedName);
    if (crates.length === 0) {
      throw new Error(`no documentable crate named "${requestedName}" was discovered`);
    }
  }
  for (const crateName of crates) {
    const outputPath = resolve(root, "docs/generated/api/rust", `${crateName}.md`);
    if (check) {
      const scratch = await mkdtemp(join(tmpdir(), "rust-api-docgen-check-"));
      const scratchPath = join(scratch, `${crateName}.md`);
      generate(crateName, scratchPath);
      const [fresh, existing] = await Promise.all([
        readFile(scratchPath, "utf8"),
        readFile(outputPath, "utf8"),
      ]);
      await rm(scratch, { recursive: true, force: true });
      if (fresh.trim() !== existing.trim()) {
        throw new Error(`${outputPath} is stale; run \`pnpm run docs:api:rust:generate\``);
      }
      console.log(`${crateName}.md is current.`);
    } else {
      generate(crateName, outputPath);
      console.log(`Generated ${outputPath}`);
    }
  }
}

await main();
