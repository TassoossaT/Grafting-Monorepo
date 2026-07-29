# ADR-0011: package autonomy, external dependency isolation, and authoritative reuse

- Status: **Accepted.** Recorded from the repository owner's explicit decision
  on 2026-07-29.
- Decision date: 2026-07-29.
- Record: DEC-049.
- Related: DEC-001, DEC-002, DEC-013, DEC-046, ADR-0008, master source
  sections 2.1, 2.2, 4.4, and 16.8.

## Context

The monorepo is intended to support multiple products without binding reusable
capabilities to one application or to one replaceable third-party library. The
owner established three repository-wide requirements:

1. reusable capabilities remain generic and consumer-agnostic without forcing
   every capability or dependency into a separate package;
2. third-party code is accessed only inside its designated owning boundary and
   is presented to consumers through a Grafting-owned surface;
3. authoritative logic is implemented once rather than copied.

DEC-001 already prevents hosts from reproducing Rust domain logic, and DEC-046
already promotes reusable capabilities out of applications. This decision
extends both rules to package APIs and external runtime dependencies.

## Decision

### Capability autonomy and package granularity

Each reusable boundary owns one coherent capability and exposes contracts in
Grafting's vocabulary. It can be an internal module tree, a package, or a host
application boundary. Reusable logic must not contain product-specific routes,
workflows, or presentation policy. Applications compose capabilities, present
UI, and own host-specific integration.

The default is the smallest boundary that preserves reuse and replacement. An
internal module tree is sufficient when one project owns all consumers. A
separate package is justified when a capability needs independent reuse across
projects, an enforceable dependency/public-API boundary, separate build/test
ownership, or a forked/vendor source tree. Generic does not mean speculative;
empty future packages remain prohibited.

### External dependency isolation

Every third-party runtime/library API has a designated owning boundary:

- only code inside that boundary imports the external API in repository
  runtime code;
- code outside it consumes a Grafting-owned contract, facade, function, or
  component;
- public APIs must not expose external classes, handles, enums, errors, or
  configuration objects;
- replacement of the dependency must be localized to the owning boundary;
- a second independent integration for the same external capability is
  prohibited unless a different runtime or incompatible boundary is documented
  explicitly.

The owning boundary can be a module/subtree within an existing project, a
reusable package, or the application that owns a host framework. A project may
use a third-party dependency privately without creating an extra package when
external types and vendor-specific behavior remain inside that module tree.

This rule applies to runtime/library APIs used by repository code. Native
compilers, package managers, code generators, test runners, build plugins, and
their configuration remain operated directly by their sovereign toolchains;
creating facades for commands such as Cargo, `dotnet`, `flatc`, pytest, Vite,
or Nx would add indirection without isolating a runtime contract.

### Cloned or modified third-party source

If the repository needs to clone, vendor, or modify an upstream codebase, that
source may become its own package or source subtree because it now has distinct
provenance and maintenance. This is not an automatic consequence of importing a
library. The fork requires a separate review/ADR covering:

- upstream repository and pinned commit/tag;
- license, copyright notices, and redistribution obligations;
- local modifications and patch/update strategy;
- vulnerability and upstream-release monitoring;
- package naming and whether upstream import compatibility must be preserved;
- rollback or return-to-upstream strategy.

A fork remains inside the existing workspace and lockfile unless another ADR
explicitly authorizes otherwise. Retaining an upstream package name such as
`@antv/x6` is allowed only when compatibility and provenance are explicit; a
Grafting-owned name is preferred when it avoids confusing the fork with the
upstream release.

### One authoritative implementation

Behavior that carries repository meaning has exactly one authoritative
implementation or canonical source. Copying it into another package,
application, language, or adapter is prohibited. A consumer delegates to that
implementation or consumes a generated projection of its canonical contract.

"Zero repetition" means zero duplicated authoritative behavior, not zero
repeated text. The following remain valid when their source and purpose are
traceable:

- independent tests that repeat expectations to verify behavior;
- deterministic bindings generated from one canonical schema;
- frozen compatibility fixtures;
- thin translations at ABI, process, protocol, or runtime boundaries;
- derived documentation and Graph IR projections with evidence.

These exceptions must not become an alternate place to maintain the same
business rule.

## Reference example

The current Architecture Studio visualization path is one valid reference:

```text
apps/architecture-studio
  -> @grafting/graph-x6
  -> @grafting/x6-canvas
  -> @antv/x6
```

`@grafting/x6-canvas` is the only TypeScript project in this path that imports
`@antv/x6`. It exports Grafting-owned canvas types and does not expose the
mutable X6 `Graph`. `@grafting/graph-x6` owns Graph IR visualization semantics,
while the application owns composition and presentation.

This split is not a mandate to create one package per layer or dependency. A
single owning package could instead use an internal tree such as:

```text
src/
  vendor/x6-adapter.ts
  graph/model.ts
  graph/layout.ts
  facade.ts
```

Both forms satisfy DEC-049 when consumers see Grafting contracts, vendor types
stay internal, and authoritative graph behavior has one implementation. The
physical package boundary is chosen from demonstrated reuse and ownership, not
from a fixed layer count.

## Consequences

- Code outside an owning boundary cannot import its replaceable third-party
  capability API directly.
- Package public API review must check for external-type leakage.
- A second consumer reuses or promotes an existing capability before adding
  code.
- Vendor replacement is localized to the smallest owning boundary when the
  internal contract remains valid.
- Package count stays evidence-driven; internal modules are preferred until a
  real cross-project/build/ownership boundary exists.
- Native toolchains remain sovereign under DEC-002.

## Validation and enforcement

Initially the rule is enforced through root/scope `AGENTS.md`, dependency and
public-API review, Nx graph inspection, and tests at the internal boundary.
Automated dependency-boundary and forbidden-import checks may be added only
after the conventions have enough real examples to avoid encoding a false
abstraction.

## Risks

- Turning every small utility or external dependency into a package would
  create package sprawl and forwarding layers with no architectural value;
  reuse, ownership, build isolation, and public API leakage determine package
  granularity.
- Over-applying deduplication can couple unrelated concepts that merely look
  similar. Only shared meaning and behavior are centralized.
- A weak internal facade can mirror a vendor API so closely that replacement is
  still expensive; contracts must use Grafting concepts rather than renamed
  vendor types.
- A fork can silently diverge from upstream or lose security fixes; it requires
  explicit provenance and maintenance rather than being treated as an ordinary
  imported dependency.

## Rollback

Rollback requires an explicit owner decision because DEC-049 is `LOCKED`.
Reverting this ADR alone does not authorize new direct imports or duplicated
logic; the master decision and operational contracts must be changed together.
