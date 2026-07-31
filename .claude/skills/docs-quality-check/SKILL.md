---
name: docs-quality-check
description: Re-analyzes a just-(re)generated API-reference file under docs/generated/api/ for size, emptiness, noise-ratio, and formatting problems, and suggests a concrete fix to the generator instead of hand-editing the generated file. Run after regenerating a project's docs (PROTOCOL.md rule 6), before marking a task complete.
argument-hint: "[project-or-crate-name]"
disallowed-tools: Write, Edit
---

# Documentation quality check

Read-only review. A file under `docs/generated/api/` is generated
evidence, not authored content -- if something about it is wrong, the
fix belongs in the generator that produced it, never in the file itself.
`Write`/`Edit` are disallowed for the rest of this turn so that stays
true structurally, not just by instruction.

## What to review

The file just regenerated: `docs/generated/api/ts/$1.api.md` (TypeScript)
or `docs/generated/api/rust/$1.md` (Rust) if a name was given; otherwise
infer it from what the current task just ran `docs-generate` for.

## Checks

Compare the file against its siblings in the same directory
(`docs/generated/api/ts/*.md` or `docs/generated/api/rust/*.md`) and read
it directly. These four categories are exactly the real bugs already
found and fixed by hand in this repo's own doc generators -- not a
speculative checklist:

1. **Size outlier.** Roughly 3x+ larger than sibling files with no
   obvious reason (a genuinely large, complex project is a legitimate
   reason -- this is a prompt to look closer, not an automatic verdict).
   Precedent: raw Rustdoc JSON once inflated one file to 1.5 MB because
   the generator emitted every `impl` block as its own entry.
2. **Suspiciously empty output.** The source project clearly has real
   public exports (skim its `src/` briefly) but the file has few or no
   entries -- the extractor likely failed silently: wrong entry point,
   tsconfig mismatch, or a build error swallowed somewhere.
3. **Undocumented-noise ratio.** A high share of headers with no doc
   paragraph under them is not automatically wrong (real code is often
   under-documented), but skim it: is this genuinely undocumented source,
   or generator noise that should have been filtered? Precedent:
   `is_undocumented_derive_noise` in `tools/rust-api-docgen/src/main.rs`
   exists because `#[derive(...)]`-generated impls/methods were drowning
   real signal; a new noise pattern needs a new filter rule the same way.
4. **Formatting artifacts.** Raw absolute filesystem paths
   (`C:\Users\...`, `/home/...`), a qualified name repeating a full file
   path instead of a short segment (precedent:
   `pathSegmentName` in `tools/scripts/generate-api-docs.mjs`, fixed once
   already), duplicate consecutive headers, mojibake, stray HTML-looking
   angle brackets, or a leftover corruption marker.

## If you find a real problem

Identify the specific function responsible in whichever generator
produced the file --
`tools/scripts/generate-api-docs.mjs` (TypeScript discovery/rendering),
`tools/scripts/generate-rust-api-docs.mjs` (Rust discovery/orchestration),
or `tools/rust-api-docgen/src/main.rs` (Rust curation/rendering) -- and
report, as text to the user, not as a file edit:

- what is wrong, with the specific evidence (file, entry, byte count);
- why it is wrong -- what it would cost an agent reading this file to
  understand the project;
- a concrete suggested code change in the generator.

The fix itself is normal generator work: a real coordination task,
claimed, with the generator file in `affected_paths`, same as every
other change to these scripts. This skill only produces the suggestion.

## If nothing looks wrong

Say so briefly. Do not manufacture a finding to justify the check.
