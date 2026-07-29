# AGENTS.md — Architecture Studio

Scope-local addendum to the root `AGENTS.md`.

Derived Graph IR is read-only. This app MUST NOT edit generated facts or bypass
schema/policy/plan review for authored workflows. It consumes `graph-x6`; it
does not import raw X6 or VTT map semantics.
