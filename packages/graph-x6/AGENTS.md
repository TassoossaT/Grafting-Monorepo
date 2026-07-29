# AGENTS.md — `@grafting/graph-x6`

Scope-local addendum to the root `AGENTS.md`.

This package visualizes Graph IR evidence. It MUST NOT edit derived facts,
invent dependencies, or treat approximate relations as normative. Product map
semantics do not belong here.

It consumes `@grafting/x6-canvas` and MUST NOT import `@antv/x6` or expose
vendor visualization types. Graph IR-to-canvas mapping has one authoritative
implementation in this package (DEC-049).
