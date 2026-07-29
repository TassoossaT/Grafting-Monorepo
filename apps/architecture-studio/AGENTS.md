# AGENTS.md — Architecture Studio

Scope-local addendum to the root `AGENTS.md`.

Derived Graph IR is read-only. This app MUST NOT edit generated facts or bypass
schema/policy/plan review for authored workflows. It consumes `graph-x6`; it
does not import raw X6 or VTT map semantics.

The app only composes and presents capabilities. Reusable repository,
documentation, test-evidence, and graph logic belongs in Grafting packages.
External visualization APIs must remain behind their designated smallest
owning boundary. This does not require a separate package for every library or
layer (DEC-049).
