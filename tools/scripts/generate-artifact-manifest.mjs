// G-004 (master source S18.5/S23): a deterministic artifact manifest,
// matching S18.5's literal example shape (productVersion, coreVersion,
// abi, protocol, gitSha, target, profile, features). Mirrors
// generate-graph-ir.mjs's --check-flag convention. `abi`/`protocol`/
// `features` come from a real runtime value (`cargo run -p
// grafting-isekai-capi --features abi-info-cli --bin abi-info-cli`),
// not from parsing Rust source -- see that crate's own
// src/bin/abi_info_cli.rs for why.

import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const outputPath = resolve(root, "docs/generated/artifact-manifest.json");
const check = process.argv.includes("--check");
const profile = process.argv.includes("--release") ? "release" : "dev";

const run = (command, args) => execFileSync(command, args, { cwd: root, encoding: "utf8" }).trim();

// Cargo.toml is TOML, not JSON -- avoid a new parser dependency for one
// field by reading the `version = "..."` line directly (mirrors this
// repo's own "text-level append" treatment of Cargo.toml's `members`
// array in the crate/domain generators, not a new pattern).
async function readCargoVersion(relativeCargoToml) {
  const text = await readFile(resolve(root, relativeCargoToml), "utf8");
  const match = text.match(/^version\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error(`no version field found in ${relativeCargoToml}`);
  return match[1];
}

const abiInfoRaw = run("cargo", [
  "run",
  "--quiet",
  "-p",
  "grafting-isekai-capi",
  "--features",
  "abi-info-cli",
  "--bin",
  "abi-info-cli",
]);
const abiInfo = JSON.parse(abiInfoRaw);

const gitSha = run("git", ["rev-parse", "HEAD"]);
// `rustc -vV`'s `host:` line -- the actual machine/toolchain this
// manifest was generated on, not a guessed/hardcoded triple. Matches
// §18.5's literal example, which is a single string, not an array.
const rustcVv = run("rustc", ["-vV"]);
const hostMatch = rustcVv.match(/^host:\s*(\S+)/m);
if (!hostMatch) throw new Error("could not parse `host:` from `rustc -vV`");
const target = hostMatch[1];

const coreVersionValue = await readCargoVersion("libs/engine/domain-core/Cargo.toml");

const manifest = {
  // No separate product-versioning scheme exists yet (every crate/
  // package in this repo is still 0.0.0) -- honestly the same value as
  // coreVersion for now, not invented, per §18.5's own "while everything
  // is internal: one product version."
  productVersion: coreVersionValue,
  coreVersion: coreVersionValue,
  abi: { major: abiInfo.abiMajor, minor: abiInfo.abiMinor },
  protocol: { major: abiInfo.protocolMajor, minor: abiInfo.protocolMinor },
  gitSha,
  target,
  profile,
  features: abiInfo.features,
};

const rendered = `${JSON.stringify(manifest, null, 2)}\n`;

if (check) {
  const existing = await readFile(outputPath, "utf8");
  const existingParsed = JSON.parse(existing);
  // gitSha/target legitimately change between runs on different
  // commits/machines -- --check only needs to prove the *shape and
  // derivation* still work, not byte-for-byte staleness the way
  // repo-map.md's --check does. Compare everything except those two.
  const { gitSha: _existingSha, target: _existingTarget, ...existingRest } = existingParsed;
  const { gitSha: _newSha, target: _newTarget, ...newRest } = manifest;
  if (JSON.stringify(existingRest) !== JSON.stringify(newRest)) {
    throw new Error("artifact-manifest.json is stale (excluding gitSha/target); run `pnpm graph:manifest`");
  }
  console.log("artifact-manifest.json is current (excluding gitSha/target, which legitimately vary per run).");
} else {
  await writeFile(outputPath, rendered);
  console.log(`Generated ${outputPath}`);
}
