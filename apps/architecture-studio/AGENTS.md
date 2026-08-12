# AGENTS.md — Architecture Studio

Scope-local addendum to root `AGENTS.md`.

## 1. BOUNDARIES & ROLES
- **Presentation-Only:** Maps Graph IR and application metadata to canvas elements (`@grafting/ui`). MUST NOT import third-party renderer libraries directly (DEC-049, DEC-056).
- **Core Calculation Boundary:** Graph IR calculations, algorithms, and layout math belong strictly to `grafting-graph-core` (DEC-051). Presentation properties (labels, colors, viewport) cross explicit Rust contracts.

## 2. SPIKES & LAB TRIALS (`/lab`)
- New disposable experiments/spikes MUST live under `src/app/lab/` (runnable via `/lab/trials`), NOT as root-level `spikes/` directories.
- Previews are stored via `src/lab-preview-storage.ts` for gallery display.

## 3. BENCH & EVALUATORS (`src/bench/`)
- Declarations live in `src/bench/registry.ts` (identity, ports, parameter schema). Adding an element MUST be a registration, never an ad-hoc bench UI change.
- Evaluators (`src/bench/evaluators.ts`) receive Wasm entry points via dependency injection.
- Worker caching: Intermediate node values stay on the worker thread; only flattened previews cross to the main React thread.

## 4. ARCHITECTURE & CODEGEN
- `stories/` is auto-generated (`scripts/generate-stories.mjs`). Authored Storybook stories MUST be placed in `stories-authored/`.
