# Note 0010 — The construction graph is a structural demarcation, not final geometry

- Recorded: 2026-09-24
- Status: owner decision; governs every construction and edit tool
- Related: 0008 (openings), 0009 (graph overlay), Epic 4 (assets), #274, #231

## Rule

The construction graph (nodes, edges, faces/regions) is a **structural demarcation**: it says where walls,
floors, roofs, openings, roads are and how they relate. It is **not** the final rendered geometry.

- **Assets are assembled on top later** by a separate, centralized engine that reads the graph's faces and
  edges as its input. That engine owns everything physical/visual the graph does not: wall **thickness**,
  jambs / sill / lintel lining an opening, frames, trims, materials, detail.
- **Current scope is structural construction and editing only:** creating, editing and keeping the
  demarcation consistent (pinning, cuts, groups, shapes, handles). Do not add thickness, linings or
  asset-like detail to the graph or its tools.
- Rendered faces today (painted panes, flat walls) are placeholders that make the demarcation visible.

## Consequences

- An opening's "tunnel" through a thick wall (jambs, sill, lintel) is NOT graph work; it belongs to the
  future asset engine, which reads the opening's pinned outline and its host faces.
- Keep demarcation data rich enough for that engine: stable region ids, per-region property bags (e.g. which
  asset goes here), groups, pins, exact curved edges (no sampled vertices) -- all already generic.
