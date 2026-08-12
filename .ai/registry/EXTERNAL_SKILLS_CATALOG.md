# External Skills Catalog & Directory

Location of cloned skill repositories:
- `mattpocock/skills`: [`.ai/external/mattpocock-skills`](file:///C:/Users/PICHAU/Desktop/Grafting%20Monorepo/.ai/external/mattpocock-skills)
- `google-labs-code/stitch-skills`: [`.ai/external/stitch-skills`](file:///C:/Users/PICHAU/Desktop/Grafting%20Monorepo/.ai/external/stitch-skills)

---

## 1. `mattpocock/skills` Catalog

Curated engineering and product management skills by Matt Pocock for AI agents.

### A. Engineering (`.ai/external/mattpocock-skills/skills/engineering/`)
* **`grill-with-docs`**: Socratic questioning specifically focused on existing documentation and specs.
* **`codebase-design`**: High-level structural and module boundaries design.
* **`to-spec` / `to-tickets`**: Converts ideas and PRDs into technical specifications and concrete GitHub/Linear issues.
* **`tdd`**: Enforces strict test-driven development cycles (Red-Green-Refactor).
* **`improve-codebase-architecture`**: Deep review of existing codebase structure, highlighting refactoring targets.
* **`diagnosing-bugs`**: Systematic bug reproduction, root-cause triage, and minimal regression fix design.
* **`domain-modeling`**: Domain-driven design (DDD) entity, value object, and state transition modeling.
* **`prototype`**: Rapid disposable spiking for technical feasibility.
* **`code-review`**: Comprehensive PR and diff audit against project rules.
* **`resolving-merge-conflicts`**: Conflict resolution guidelines preserving semantic invariants.

### B. Productivity & Strategy (`.ai/external/mattpocock-skills/skills/productivity/`)
* **`grill-me`**: Interactive Socratic interview that challenges assumptions, defines MVP boundaries, and uncovers hidden dependencies before coding.
* **`grilling`**: Deep interrogation of architectural choices.
* **`handoff`**: Context compaction for seamless handoff between AI agent sessions or context resets.
* **`to-questionnaire`**: Formulates structured diagnostic question sets.
* **`writing-for-agents`**: Guidelines for writing prompts and documentation optimized for LLM execution.

---

## 2. `google-labs-code/stitch-skills` Catalog

UI/UX design, prototyping, and component skills for Stitch MCP & web applications.

### A. Utilities & Design System (`.ai/external/stitch-skills/plugins/stitch-utilities/`)
* **`enhance-prompt`**: Transforms UI ideas into structured, design-system-contextualized prompts.
* **`stitch-loop`**: Autonomous iterative loop for UI building and refinement via baton passing.
* **`taste-design`**: Evaluates and polishes aesthetic design systems, typography, and color tokens.

### B. Design & Extraction (`.ai/external/stitch-skills/plugins/stitch-design/`)
* **`generate-design`**: Generates full visual mockups and layout systems.
* **`manage-design-system`**: Creates and maintains design tokens (colors, typography, spacing).
* **`code-to-design`**: Converts existing React/HTML code back into visual design specifications.
* **`extract-design-md`**: Extracts design tokens and CSS variables into structured markdown.

### C. Build & Components (`.ai/external/stitch-skills/plugins/stitch-build/`)
* **`react-components`**: Component generation and modular UI assembly.
* **`shadcn-ui`**: Tailored component patterns using accessible UI primitives.
* **`remotion`**: Motion graphics and animated walkthrough generation.

---

## 3. How Agents Consume These Skills

When an AI agent (Gemini, Claude, Codex) needs to execute a workflow from these catalogs:
1. Locate the target skill's `SKILL.md` under `.ai/external/mattpocock-skills/skills/...` or `.ai/external/stitch-skills/plugins/...`.
2. View its instructions using `view_file`.
3. Execute the workflow in accordance with the project's `AGENTS.md` and `.ai/coordination/PROTOCOL.md`.
