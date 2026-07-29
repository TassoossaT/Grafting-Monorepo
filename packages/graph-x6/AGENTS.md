# AGENTS.md — `@grafting/graph-x6`

Scope-local addendum to the root `AGENTS.md`.

This package visualizes Graph IR evidence. It MUST NOT edit derived facts,
invent dependencies, or treat approximate relations as normative. Product map
semantics do not belong here.

This is a transitional spike boundary, not the target graph abstraction. New
reusable graph structures, semantic validation, algorithms, queries, ordering,
diffs, or layout mathematics MUST NOT be added here. Such behavior moves
atomically to `grafting-graph-core`; the application owns the Graph IR to
presentation projection before this package is removed (DEC-051).

It consumes `@grafting/x6-canvas` and MUST NOT import `@antv/x6` or expose
vendor visualization types. Graph IR-to-canvas mapping has one authoritative
implementation in this package (DEC-049).
