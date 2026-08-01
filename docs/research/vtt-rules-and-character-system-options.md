# VTT rules and character system: open-source options

- Research date: 2026-08-01
- Status: non-normative candidate catalog. Where this document says
  "Decided," that reflects a real conversation decision recorded here so
  it isn't lost — not a substitute for updating the ADR/task state that
  actually governs the repository. Everything else is Standby/Open
- Decision authority: this document does not itself close any ADR or gate
- Scope: open-source candidates for the VTT's rules/character system —
  dice rolling, flexible character/entity data modeling, and prior art from
  existing open-source VTTs. Part of the broader
  `docs/research/vtt-product-scope-map.md` coverage map (see its "Game
  system / rules engine" section); map/terrain construction lives in
  `docs/research/vtt-map-and-terrain-construction-options.md`, not repeated
  here

## The system-agnostic vs. single-system fork (not resolved here)

A real, early architectural fork, surfaced but deliberately not decided by
this document:

- **System-agnostic** (Foundry's own core design, and — confirmed below —
  PlanarAlly's design too): the core ships no baked-in ruleset; a separate
  "system" layer defines the actual character-sheet schema, dice
  formulas, and automation. Maximizes reach (any TTRPG can be played) at
  the cost of a more generic, less tailored default experience.
- **Single-system, tuned** (e.g. built specifically around Ordem
  Paranormal's own rules): a narrower, more opinionated design that could
  match this project's stated visual/atmospheric polish goal more tightly
  — a curated experience rather than a generic container — at the cost of
  not serving other TTRPGs out of the box.

Both PlanarAlly and Foundry independently arrived at "system-agnostic" —
real evidence it's a proven, well-trodden path, not evidence it's the
*right* choice for this project's specific goal of matching Ordem
Paranormal/Celbit-level curated polish. This is the owner's decision, not
resolved here.

## Dice rolling / notation parsing (Rust crates)

| Crate | License | Note |
| --- | --- | --- |
| **`ndm`** (Ben Stern) | Dual MIT/Apache-2.0 | **Leading candidate.** Actively maintained (last release 2026-01-23); parses standard notation (`NdS`, modifiers) via `FromStr`; supports keep/drop-style roll sets |
| `dice-parser` (marcell-ziegler) | **GPL-3.0** | Reference only, excluded from code reuse per this repository's standing copyleft policy (same policy as Veloren/Blender Geometry Nodes) — notable for a clean `Keep::Highest()` API design worth studying conceptually, not copying |
| `dice-command-parser` | Not verified in this pass | Simpler feature set (no keep/drop mentioned); license not confirmed — a future look, not `ndm`'s equal today |
| `dices`, `dndice`, `dice_forge`, `rust-dice`, `lib_dice` | Not verified in this pass | Found via search, not evaluated — recorded as names for a future look if `ndm` proves insufficient |

Since `libs/engine/domain-core` already has a `DeterministicRng`
(`ChaCha8Rng`-based, seed + word-position resumable, per DEC-044's replay
determinism requirement — see `rng.rs`), the actual *rolling* mechanism
already exists for the VTT's domain layer. What a crate like `ndm` would
add is **notation parsing** (turning a string like `"4d6kh3"` into a
structured roll request) — worth keeping that boundary clear: parsing is a
candidate for adoption, the roll itself should keep using the existing
deterministic RNG, not a crate's own internal RNG, to preserve replay
determinism across the whole domain.

## Flexible character/entity data modeling: ECS crates

A system-agnostic (or even a single-system-but-flexible) character needs a
data shape that doesn't hardcode one schema. The Entity-Component-System
pattern — an entity is just an ID, arbitrary components attach to it — is
a well-proven fit for this, independent of which fork above gets chosen
(a "system" would just define which components its characters use).

| Crate | License | Note |
| --- | --- | --- |
| **`hecs`** (Ralith) | Dual MIT/Apache-2.0 | Minimalist, explicitly "a library, not a framework" — embeddable without pulling in a full game engine, dense columnar storage for cache efficiency |
| `specs` | Dual Apache-2.0/MIT | Classic, mature ECS design; popularized the pattern in Rust |
| Bevy ECS | Dual Apache-2.0/MIT | Usable standalone per its own README, but its natural home is the Bevy engine — heavier to pull in for just the ECS piece |
| `legion` | Dual MIT/Apache-2.0 | **Not actively maintained** (its own home, Amethyst, is also unmaintained) — avoid for new work |

Not yet decided: whether the character/rules domain should actually be
built as an ECS `World`, or as a more conventional tagged-struct/enum model
like `domain-core`'s current placeholder domain (`Command`/`DomainEvent` as
plain Rust enums). Both can still flow through the same
`Command → DomainEvent → Snapshot` pipeline — this is a data-modeling
choice inside that pipeline, not a competing architecture.

## Open-source VTT prior art

### PlanarAlly — the strongest concrete reference found

[Kruptein/PlanarAlly](https://github.com/Kruptein/PlanarAlly), **MIT
license** (confirmed directly from its `LICENSE` file), Python backend
(Peewee ORM) + Vue.js frontend, Socket.io transport. A real, mature,
actively-developed open-source VTT — not a toy project. Directly relevant
findings:

- **System-agnostic by design**: its own architecture documentation does
  not address rules engines or system-specific character sheets at all —
  confirms the pattern described above is a real, working choice, not
  theoretical.
- **Dynamic lighting / vision**: implemented via a hand-rolled
  "Visibility" module that generates triangulation for vision/lighting
  calculations — its own maintainers describe this code as "inherently
  complex" and "written in a very non-JavaScript fashion," with a stated
  long-term goal to **port it to WebAssembly** for performance. This is
  independent, real-world validation that this project's own
  Isekai/Wasm-for-heavy-computation direction is the right instinct, from
  a team solving the exact same problem (shadowcasting/visibility-polygon
  math is expensive in a scripting-language main thread) — directly
  relevant to this project's own still-open "fog of war / dynamic vision"
  item in `docs/research/vtt-map-and-terrain-construction-options.md`,
  cross-referenced there rather than duplicated.
- **Layered floors**: PlanarAlly supports floors where a token on an upper
  floor can look down on lower floors ("balcony" effect) — directly
  relevant to this project's own multi-floor interior-generation design
  (see the map document's "Interior generation" section).
- **Initiative tracker** and **undo/redo core actions** (a dedicated
  action-history system) are both built in — concrete confirmation these
  are expected baseline VTT features, matching this document's own scope
  map.
- **Mod/plugin API** exists (`planarally-mods`) — a real precedent for the
  "community content" idea in the scope map's Content Creation section.
- Because it's MIT, its actual algorithms (the Visibility/triangulation
  approach specifically) are legitimate candidates for close study or even
  porting into a Rust equivalent — through this repository's third-party
  attribution system (`THIRD_PARTY_NOTICES.md`,
  `.ai/coordination/PROTOCOL.md` rule 8) if code/algorithm structure is
  actually copied, same as any other adapted third-party work.

### Foundry VTT — confirmed proprietary, benchmark only

Verified precisely rather than assumed: Foundry VTT operates under a
**commercial, proprietary EULA**. Its own license terms state the software
and any source code licensed to licensees remain the sole property of
Foundry and its third-party licensors, and reverse engineering is
prohibited except where law requires otherwise. This confirms Foundry was
already correctly treated in this planning process as a **feature/UX
benchmark to beat** ("a VTT better than Foundry"), never a code or
architecture source — there is no licensed access to its source to study
even if desired.

### Foundry system-package licensing is case by case

The owner proposed reusing free Foundry VTT *system* packages (e.g. GURPS)
since Foundry's core is proprietary but community systems are separately
licensed — a sound distinction in principle, checked concretely here.
**Correction to the owner's specific example**: GURPS is one of the riskier
choices, not a safe one. Foundry GURPS implementations
(e.g. [`crnormand/gurps`](https://github.com/crnormand/gurps)) are
distributed under permission from **Steve Jackson Games' Online Policy**,
which permits personal use by people who already own the GURPS books — it
is **not** a conventional open-source license, and does not clearly permit
redistribution inside a commercial, closed-source product. This matters
directly given the owner's stated closed-source-sale goal.

By contrast, licensing genuinely varies system-by-system along **two
separate axes** — the software (code) license and the game-content
(rules text) license — and some combinations are real, verified, safe
options:

| System | Code license | Content license | Verdict |
| --- | --- | --- | --- |
| **dnd5e** (official) | **MIT** | **CC-BY-4.0** (Wizards of the Coast's own SRD 5.1 license) | **Genuinely safe** — both axes are conventional, attribution-only open licenses |
| **pf2e** (official) | **Apache-2.0** | OGL/Community Use Policy content, used under a **specific Foundry Gaming LLC ↔ Paizo partnership agreement** | **Middle case** — the code license is clean, but the partnership-specific content permission may not transfer to a third party reusing that content; verify directly with Paizo's own OGL/CUP terms before relying on its content, not just the code |
| **GURPS** (community) | Varies by project (some MIT, e.g. `Boifuba/gurps-instant-defaults`) | **Steve Jackson Games Online Policy — personal use only** | **Risky for this project's goal** — the specific game content/mechanics are not openly licensed for commercial redistribution |

**The general rule going forward**: never assume "it's on GitHub" means
"safe to reuse" — check the code license and the content license
separately, for the specific system under consideration, before adopting
anything. This is the same discipline already applied to every other
candidate in this document and its siblings.

### Foundry's core architecture patterns (safe to study, never a code source)

Separately from any specific system's licensing, Foundry's own **core**
(proprietary, confirmed above) exposes extensively documented, public API
concepts describing *how* it solves exactly the consolidation problem the
owner asked about — rendering, turns, combat, vision, and limitations, all
system-agnostically. These are safe to study and reimplement fresh in Rust
as **design patterns**, the same treatment already given to Sylves and
Townscaper: documented API concepts and behavior are not the same as
copyrighted source code, and no code from Foundry itself is touched or
accessible to do otherwise.

- **Active Effects (the "limitations"/status-effect mechanism)**: a
  non-destructive modifier system. Each effect targets a dot-notation key
  path into the actor's data (e.g. `system.attributes.hp.max`) with a
  **Change Mode** — `ADD`, `MULTIPLY`, `OVERRIDE`, `DOWNGRADE` (apply only
  if lower than current), `UPGRADE` (apply only if higher), or `CUSTOM`
  (system-specific hook) — applied in a fixed order: Custom → Multiply →
  Add → Upgrade/Downgrade → Override. Completely game-system-agnostic: the
  core only ever manipulates generic key paths and numbers, never knowing
  what "rage" or "encumbrance" means.
- **Combat/Combatant (the "turns" mechanism)**: a generic list of
  Combatants sorted by a numeric initiative value (ties broken by a stable
  rule), with current-turn/next-turn navigation; a system can override the
  sort/comparator entirely for non-standard turn-order rules. No combat
  math lives here — just ordering and navigation.
- **DataModel / `template.json` (the "flexible schema" mechanism)**: the
  core defines two generic document types (Actor, Item); each system
  declares its own field schema per sub-type (e.g. a "character" Actor vs.
  an "npc" Actor). This is the same shape as this document's own
  ECS-crate proposal above (`hecs`/`specs`) — a system just declares which
  components/fields its entities carry, without the core knowing what a
  GURPS "Skill" or a D&D "Spell Slot" is.
- **VisionSource (the "vision" mechanism)**: a point-source abstraction
  computing a constrained line-of-sight polygon from an origin and radius
  against a scene's wall geometry, with pre-computed masking geometry for
  rendering — the same shadowcasting/visibility-polygon family of
  technique already found in PlanarAlly's own hand-rolled module above.
  Two independent production VTTs converging on the same geometric
  approach is a strong signal this is simply the right technique, not a
  Foundry-specific trick.

### Proposed consolidated agnostic architecture

Directly answering the owner's question — a design proposal, not a
decision, layered on top of what already exists:

```text
Rendering (Three.js)              -- pure consumer, same as the map system
        ^ projections
Per-TTRPG system layer             -- schema (which components an entity
  (GURPS / Ordem Paranormal /         carries), dice formulas (via `ndm`),
   any future system)                any CUSTOM Active-Effect-style hooks
        ^ plugs into
Generic agnostic core (Rust, extends libs/engine/domain-core)
  - flexible entity schema           -- `hecs`/`specs`-style ECS: an
                                         Actor/Item is an entity ID plus
                                         whatever components its system
                                         declares
  - modifier/limitations system      -- Active-Effect-style: Commands
                                         add/remove modifiers targeting a
                                         key path with a Change Mode,
                                         applied in a fixed, deterministic
                                         order -- system-agnostic
  - turn/initiative tracker          -- Combatant list sorted by a numeric
                                         value with a pluggable
                                         comparator; current/next-turn
                                         navigation -- system-agnostic
  - vision/LOS computation           -- point-source polygon visibility
                                         against wall geometry, the same
                                         technique Foundry and PlanarAlly
                                         both independently use; a strong
                                         fit for the existing Isekai/Wasm
                                         pathway, since this is exactly
                                         the kind of expensive geometry
                                         math PlanarAlly's own maintainers
                                         want to move off the main thread
        ^ all flow through
Command -> DomainEvent -> Snapshot (already built, libs/engine/domain-core)
```

Every layer above the generic core stays swappable per TTRPG system,
exactly the way Foundry's own DataModel/Active-Effects/Combat pattern
already proves works at scale — the difference is this project reimplements
the *pattern* fresh in Rust rather than depending on Foundry's (proprietary,
inaccessible) code, and ties vision computation specifically into the
already-decided Isekai/Wasm pipeline instead of the browser's JS main
thread.

### Combat/status is system-layer composition, not core vocabulary

**Correction to this section's original framing**: naming core-level
`Command`/`DomainEvent` types after "action resolution" or "combat" — as
the first draft below did — quietly baked the *concept* of combat into
what must stay an agnostic core. The VTT engine itself does not need
"combat," "status effect," "damage," or "action" to exist as concepts
anywhere in its own vocabulary. Those live **one layer above**: they are
what a *system* builds by composing the core's neutral primitives, not
something the core defines or is even aware of. This is the same
discipline this monorepo already applies elsewhere (`DEC-052`,
`docs/adr/ADR-0014-composable-capability-packages.md`: a reusable
capability exposes neutral mechanisms and replaceable defaults; the
*application* — here, a specific game system — composes concrete policy
on top) — not a new rule invented for this document, the same one already
governing every other reusable package in this repository.

The core's actual, minimal generic surface, with no notion of combat or
status baked in anywhere:

- an **entity/key-path store** (the ECS model above) — an entity is an ID
  plus whatever components a system declares; the core does not know a
  "character" or "monster" exists, only entities and paths into their data
- a **generic modifier command** — apply a Change Mode (Add/Multiply/
  Override/Upgrade/Downgrade/Custom) to a key path, in the established
  fixed order, optionally with a duration. The core has no idea whether a
  given modifier represents "rage," "encumbrance," or "8 points of damage"
  — to the core these are all just the same generic operation
- a **generic roll primitive** — parse a formula (`ndm`) and roll it using
  `domain-core`'s own `DeterministicRng`. The core does not know a roll is
  "an attack" or "a save," only that a formula was requested and a number
  came out
- **generic turn ordering** — a list sorted by a value, current/next
  navigation. The core does not know what a "turn" is *for*
- **vision/LOS computation** — already agnostic, unchanged

The illustrative flow below shows *one example* of how a system could
compose these primitives into what it calls "combat" — it is not new core
vocabulary the VTT itself defines, and the VTT's own engine never needs to
know this composition exists.

```text
[system-defined convention, not a core type] "declare an action"
  -- the system checks its own turn tracker state before allowing this;
     the core's generic turn ordering just answers "whose turn is it,"
     it does not gate anything on its own
        |
        v
system layer supplies, for its own action definition:
  - a formula string (e.g. "1d20 + @str_mod", parsed via ndm; @-references
    resolve against the actor's own entity components/key paths)
  - a resolution rule (e.g. "compare against target's system.defense.value")
        |
        v
core's generic Command::Roll { formula }
  -- rolled using domain-core's own DeterministicRng (never ndm's internal
     RNG -- replay determinism, DEC-044, must stay anchored to the one
     seeded stream already built and tested)
  -- active modifiers on the roll itself apply first, via the core's
     generic Command::ApplyModifier, in the same fixed order already
     established (Custom -> Multiply -> Add -> Upgrade/Downgrade ->
     Override) -- e.g. "advantage" as a CUSTOM hook (roll twice, keep
     higher), a "+2" bonus as an ADD modifier. The core executes this
     without knowing it represents "advantage" or a "bonus"
        |
        v
[system-defined convention] generic numeric comparison against the
target's key-path value -- agnostic to what the number represents: the
core does not know "AC" or "Defense" exist, only that one number was
compared against another
        |
        v
on success, the system issues further core Command::ApplyModifier calls
for consequences -- the exact same primitive as persistent status
effects, just one-shot instead of staying active:
  - damage: another ndm-parsed formula, rolled the same way, applied as a
    one-shot ADD (negative) modifier to the target's system.attributes.
    hp.value
  - healing: the same shape, positive
  - a new status effect: the same core primitive, but persistent (stays
    active until a duration or condition ends) instead of one-shot
        |
        v
core's generic DomainEvent::ModifierApplied / DomainEvent::Rolled facts
  -- the system layer interprets these as "an attack resolved"; rendering
     and the system's own turn/action-economy bookkeeping both read the
     same generic facts, each for their own purposes. The core itself
     never emits anything called "ActionResolved" -- that label, if it
     exists at all, belongs to the system layer's own interpretation
```

**The unifying insight**: this document's "limitations" mechanism (Active
Effects) and combat damage/healing are not two separate systems — they are
the **same modifier mechanism at two different persistence lifetimes**. A
"+2 to hit while raging" status effect and "take 8 damage from this hit"
are both just a Change Mode applied to a key path; one persists until a
condition ends, the other applies once and is done. Building one
mechanism, not two, is both simpler and keeps everything — buffs, debuffs,
conditions, direct damage, healing — flowing through the same auditable,
replayable Command stream.

Nothing above hardcodes a specific game system's formulas, stat names, or
rules — the core only ever handles formula strings, key paths, and numeric
comparisons that a system layer supplies, matching this document's
system-agnostic framing throughout.

### Other open-source VTTs found, not yet deep-dived

| Project | License | Note |
| --- | --- | --- |
| Vassal | **LGPLv2+** (confirmed) | Board/card-game engine, not TTRPG-character-sheet-focused — tangential, reference only regardless per this repository's standing copyleft policy |
| MapTool (RPTools) | Believed GPL/LGPL, **not independently re-verified this pass** | Long-running (15+ years), well-known — worth a precise license check before treating as more than a UX reference |
| Rolisteam | Believed **GPL**, **not independently re-verified this pass** | Same caveat as MapTool |
| Ogres (`Molfari/VTT-Ogres`) | **Not verified this pass** | Found via search, described as a lightweight browser-based VTT — a future look |
| Cauldron VTT (`noatgnu/cauldron` or `hsleisink/cauldron` — **name collision noted**, there is also an unrelated `dequelabs/cauldron` UI library) | **Not verified this pass** | JS/PHP/MySQL web VTT — a future look, and the name collision is worth remembering when searching again |
| Open-VTT (`Khazlor/Open-VTT`) | **Not verified this pass** | Godot-based, described as supporting custom rulesets and dynamic lighting — a future look |

## Open items (not resolved by this document)

1. **System-agnostic vs. single-system** — the fork above is surfaced with
   evidence, not decided. This shapes the entire character/rules data
   model and is worth a deliberate owner decision before building either
   way.
2. **`ndm`'s exact feature ceiling** — confirmed dual-licensed and
   maintained; not yet confirmed whether it covers every notation feature
   this project will eventually want (exploding dice, success-counting
   pools common in some systems, etc.).
3. **ECS vs. plain-enum domain modeling for characters** — not decided;
   both are compatible with the existing `Command → DomainEvent →
  Snapshot` pipeline.
4. **PlanarAlly's Visibility/triangulation algorithm** — flagged as worth
   close study for this project's own fog-of-war/dynamic-vision work (see
   the map document's open item), but not yet actually studied in
   algorithmic depth or ported.
5. **MapTool/Rolisteam/Ogres/Cauldron VTT/Open-VTT licenses** — found via
   search, not independently re-verified against their actual repositories
   in this pass.

## Adoption checklist

Unchanged from sibling documents; reproduced so this document is
self-contained:

1. assign a separate task and single owner;
2. state the measured product need and rejected simpler alternative;
3. re-check current license, transitive licenses, provenance, maintenance,
   and security posture (facts in this document are dated 2026-08-01 and
   will drift);
4. identify the smallest owning boundary and Grafting-owned public contract;
5. prove that vendor types do not leak and graph calculations are not
   copied outside Rust;
6. define build, runtime, bundle, memory, and data-retention costs;
7. run a disposable spike with acceptance and rollback criteria;
8. update an ADR only when adoption changes an architectural decision.
