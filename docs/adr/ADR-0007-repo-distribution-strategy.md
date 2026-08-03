# ADR-0007: Repository and distribution strategy for multi-product reuse (GATE-007)

- Status: **Accepted — GATE-007 closed.**
- Date: 2026-07-26
- Related gate: `GATE-007`
- Related `LOCKED` decisions: DEC-002 (Nx meta-orchestrator), section 6.2 (one workspace root and lockfile per ecosystem)
- Authority: in case of conflict, `GRAFTING_MASTER_SOURCE.md` prevails over this ADR.

## Context

The owner wants to use this monorepo as a base for multiple products (the VTT
first, others later), reusing code between them, and eventually to build, test,
validate, and **sell** each product independently. This raises a question the
master source already recorded as `GATE-007`, still open: is distribution
monolithic (one repository, one workspace) or based on publishable packages
consumed by separate per-product repositories?

## Options considered

### A — Single monorepo, all products as separate `apps/`

- Pros: reuse of `libs/` is trivial (same `Cargo.toml`/`pnpm-workspace.yaml`,
  no versioning between packages); a single `nx affected` covers everything;
  no publishing infrastructure is needed right away.
- Cons: "selling an isolated product" does not mean delivering a dedicated
  repository to a buyer/partner — it means packaging that product's build
  artifact (`dist/<app>`), while keeping the rest of the code private.

### B — Platform + satellite repositories per product

- Pros: cleaner isolation per product; a buyer can literally receive a
  repository.
- Cons: requires an internal package publishing/versioning pipeline starting
  in Phase 1 (none exists yet), increases maintenance surface (multiple
  `Cargo.lock`/`pnpm-lock.yaml`), and contradicts the already-`LOCKED` rule of
  a single workspace root per ecosystem (section 6.2) — it would need an
  additional ADR just to justify the exception.

## Decision

> **Closed on 2026-07-26 by the project owner: Option A — single monorepo
> continues.** VTT and future products are born as distinct `apps/` within the
> same Nx/Cargo/pnpm/.NET workspace. There is, for now, no plan to split this
> repository into platform + satellites.
>
> "Selling an isolated product" does not imply splitting repositories now — it
> implies packaging and distributing the build artifact of that specific
> `app` (`dist/<app>/...`, section 6.3) when the commercial need arises. This
> per-app packaging capability is already native to Nx's role (section 7.1)
> and requires no new structure today.

## Consequences

- `libs/domains/*`, `libs/engine/*`, `libs/platform/polymath`, `packages/*`, and
  `dotnet/*` remain the only source of logic reused across products — no
  product duplicates what another has already solved (reinforces DEC-001 and
  the rule proposed in `docs/adr/ADR-0008-libs-boundary-and-domain-map.md`).
- Each new product is born as a new directory under `apps/` (e.g.,
  `apps/web-vtt` already planned; a next product would be `apps/<name>`),
  never as a new workspace.
- Per-product licensing and ownership (`GATE-008`, still open) are resolved
  by **code and review convention**, not by repository boundary — if two
  products ever have different owners or prices in the future, this needs to
  be reassessed in this same ADR.
- If the number of products grows to the point where coordination cost
  outweighs the benefit of reuse, Option B may be revisited — but that is an
  explicit future decision, not a silent default.

## Risks

- A single monorepo with multiple commercial products requires extra
  access/review discipline if external partners ever need to see only one
  product — mitigated, when needed, by exporting an `app`'s history to a new
  repository at the time of sale (`git subtree split` or equivalent), not by
  restructuring the monorepo preemptively.
- Without a clear `libs/` boundary rule (see ADR-0008), a single monorepo
  makes reuse easy *or* makes accidental duplication within each `app` easy —
  the structure alone does not guarantee discipline.

## Next steps

- [x] Update `docs/decisions/DECISION-LOG.md` (record as `LOCKED`)
      citing this ADR — done in this revision (see new DEC).
- [ ] Define, once the first sale is real, the concrete mechanism for
      extracting that product's artifact/history.
