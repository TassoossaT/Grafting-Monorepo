# Grafting Graph IR

Graph IR v1 is the vendor-neutral interchange and query contract for repository
knowledge. It carries evidence about source facts; it does not replace the
source code, manifest, schema, ADR, or operational record that owns each fact.

## Versioned artifacts

- `graph-ir-v1.schema.json`: accepted v1 contract from I-002;
- `graph-ir-candidate.schema.json`: frozen spike-era candidate, retained only
  while the spike viewer is migrated;
- `fixtures/`: positive and negative examples used by the deterministic
  validator.

No X6, DOM, viewport, layout, color, or UI state belongs in Graph IR.

## Stable identifiers

Node IDs use `<kind>:<canonical-key>`, for example:

```text
project:architecture-studio
task:I-002-GRAPH-IR-V1
document:docs/adr/ADR-0012-knowledge-automation-plane.md
```

Keys are repository-relative and use forward slashes. They must not depend on
an absolute checkout path, machine, provider chat, array position, or generated
display label.

Edge IDs are derived from their complete tuple:

```text
edge:<encoded-source>--<kind>--<encoded-target>
```

The source and target are encoded with JavaScript `encodeURIComponent`. This
makes one canonical edge ID for a relation and prevents a second maintained
identifier source.

## Evidence and provenance

Every node and edge records:

- extractor ID and semantic version;
- the source revision used by the graph;
- confidence from `0` to `1`;
- at least one repository-relative evidence locator and SHA-256 content hash;
- an optional JSON Pointer or symbol within that evidence file.

The root `sourceRevision` is either a committed Git revision
(`git:<40-lowercase-hex>`) or a deterministic dirty-workspace fingerprint
(`workspace:sha256:<64-lowercase-hex>`). Every record must use the same source
revision as the graph document.

Declared relations have confidence `1`. Approximate relations must have
confidence below `1` and can never be presented as normative truth.

## Deterministic invariants

The JSON Schema validates record shape. The adjacent semantic validator also
enforces constraints JSON Schema cannot express locally:

- unique node and edge IDs;
- node ID prefix matches node kind;
- canonical edge IDs match source/kind/target;
- all edge endpoints exist;
- node and edge arrays are sorted by ID;
- evidence paths are relative, normalized, and traversal-free;
- record revisions match the root source revision;
- confidence agrees with declared or approximate relation class.

Run:

```powershell
pnpm graph:v1:check
pnpm graph:v1:test
```

Schema compilation uses Ajv `8.20.0` as a pinned MIT-licensed development
dependency. It is a toolchain validator and is not included in application
runtime code.

I-002 defines and validates the contract. I-004 will implement the real Nx to
Graph IR v1 extractor and generate `docs/generated/grafting.graph.json`. Until
that atomic cutover, `grafting.graph.spike.json` remains explicitly
experimental rather than being relabeled as v1.
