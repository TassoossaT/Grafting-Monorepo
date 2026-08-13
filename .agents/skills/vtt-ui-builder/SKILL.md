---
name: vtt-ui-builder
description: Canonic guidelines for building UI components in @grafting/ui based on Emil Kowalski's Design Engineering philosophy.
---

# VTT UI Builder & Design Engineering Skill

This skill enforces Emil Kowalski's design engineering standards when creating or editing UI components in `@grafting/ui` (`packages/ui/src/`) and `@grafting/vtt` (`apps/vtt/src/`).

## Core Rules

1. **Active Feedback on Pressable Elements**:
   - All buttons, chips, and dock items MUST have `transform: scale(0.97)` on `:active` with `transition: transform 160ms ease-out`.

2. **Never Scale from Zero**:
   - Popovers, submenus, and tooltips MUST animate from `scale(0.95)` with `opacity: 0`, NEVER from `scale(0)`.

3. **Easing & Duration Rules**:
   - Always use `ease-out` or custom curve `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`. NEVER use `ease-in` for UI entrances.
   - UI animation durations MUST stay under `200ms`.

4. **Origin-Aware Popovers**:
   - Set `transform-origin` to match trigger position rather than static center.

5. **Keyboard Shortcuts Have ZERO Animation**:
   - Actions triggered by hotkeys (`M`, `W`, `T`, `Ctrl+K`) must execute instantly without entrance animations.

6. **Subtle Inset Borders & Glassmorphism**:
   - Avoid solid 1px borders. Use inset light borders: `box-shadow: inset 0 1px 0 0 rgba(255,255,255,0.08), 0 8px 32px rgba(0,0,0,0.4)`.
