# Generated TypeScript public API baseline

Package: `@grafting/ui`  
TypeScript: `5.9.3`  
Source entry point: `src/index.ts`  
Documentation policy: every exported declaration and public member requires TSDoc  
Forbidden public modules: `@floating-ui/react`, `antd`, `react-dom`, `react-grid-layout`, `rete`, `rete-area-plugin`, `rete-connection-plugin`, `rete-react-plugin`, `rete-render-utils`, `styled-components`

## Declaration entry point

```ts
/** Semantic statuses supported by Grafting UI components. */
export type UiStatus = "neutral" | "info" | "success" | "warning" | "error";
/** Geometric outline of a card surface. */
export type CardShape = "rectangle" | "pill" | "circle" | "hexagon";
/** Vendor-neutral lifecycle returned by a UI component mounted into an existing DOM host. */
export interface UiMountHandle<Props> {
    /** Re-renders the mounted component with complete next inputs. */
    update(props: Props): void;
    /** Unmounts the component and releases the owned UI root. */
    dispose(): void;
}

import type { ReactElement } from "react";
/** Semantic text tones independent of the current visual implementation. */
export type TextTone = "default" | "muted" | "accent" | "danger";
/** Public inputs for the smallest reusable text presentation primitive. */
export interface TextProps {
    /**
     * Text content rendered by the component.
     * @example "Example label"
     */
    readonly content: string;
    /**
     * Optional semantic color treatment.
     * @default "default"
     */
    readonly tone?: TextTone;
    /**
     * Whether the text uses the emphasized weight.
     * @default false
     */
    readonly strong?: boolean;
    /**
     * Whether overflowing single-line content is truncated with an accessible tooltip.
     * @default false
     */
    readonly truncate?: boolean;
    /** Optional tooltip text used when truncation is enabled. */
    readonly tooltip?: string;
    /**
     * Optional maximum width in CSS pixels.
     * @default "100%"
     */
    readonly maxWidth?: number;
    /** Optional caller-owned class name for layout composition. */
    readonly className?: string;
}
/**
 * Bounded text with semantic tone and optional truncation.
 *
 * @layer atom
 * @status stable
 */
export declare function Text(props: TextProps): ReactElement;

import type { ReactElement } from "react";
import type { UiStatus } from "../shared-types.js";
/** Public inputs for a compact semantic status indicator. */
export interface StatusBadgeProps {
    /**
     * Semantic state to present.
     * @example "success"
     */
    readonly status: UiStatus;
    /**
     * Human-readable status label.
     * @example "Ready"
     */
    readonly label: string;
    /** Optional caller-owned class name for layout composition. */
    readonly className?: string;
}
/**
 * Semantic status marker with Grafting-owned status names.
 *
 * @layer atom
 * @status stable
 */
export declare function StatusBadge(props: StatusBadgeProps): ReactElement;

import type { ReactElement } from "react";
/** Public inputs for a compact, clickable action. */
export interface ButtonProps {
    /**
     * Human-readable button label.
     * @example "Run"
     */
    readonly label: string;
    /** Invoked when the button is activated. */
    readonly onClick?: () => void;
    /**
     * Optional semantic emphasis.
     * @default "default"
     */
    readonly tone?: "default" | "accent";
    /** Optional caller-owned class name for layout composition. */
    readonly className?: string;
}
/**
 * Compact action button for lightweight command triggers.
 *
 * @layer atom
 * @status stable
 */
export declare function Button(props: ButtonProps): ReactElement;

import type { ReactElement, ReactNode } from "react";
import type { CardShape } from "../shared-types.js";
/** Public inputs for the smallest reusable bounded surface: a generic card. */
export interface CardProps {
    /**
     * Geometric outline of the card; defaults to a rounded rectangle.
     * @default "rectangle"
     */
    readonly shape?: CardShape;
    /**
     * Caller-owned content rendered inside the card.
     * @example "Body"
     */
    readonly children: ReactNode;
    /**
     * Optional accessible name for the card.
     * @example "Task status"
     */
    readonly ariaLabel?: string;
    /** Optional accent used for the card boundary. */
    readonly accentColor?: string;
    /**
     * Optional background color for the card surface.
     * @default "#ffffff"
     */
    readonly backgroundColor?: string;
    /**
     * Whether the card occupies the complete width and height of its container.
     * @default false
     */
    readonly fillContainer?: boolean;
    /**
     * Whether the card should communicate pointer interaction.
     * @default false
     */
    readonly interactive?: boolean;
    /**
     * Whether the card displays its selected treatment.
     * @default false
     */
    readonly selected?: boolean;
    /** Optional boundary color used when the card is selected. */
    readonly selectedColor?: string;
    /**
     * Optional boundary width in CSS pixels.
     * @default 1
     */
    readonly borderWidth?: number;
    /**
     * Optional rounded-corner radius in CSS pixels.
     * @default 8
     */
    readonly borderRadius?: number;
    /**
     * Optional padding in CSS pixels.
     * @default 12
     */
    readonly padding?: number;
    /** Optional glow color rendered as an outer shadow, e.g. to signal live status. */
    readonly glowColor?: string;
    /** Optional caller-owned class name for layout composition. */
    readonly className?: string;
}
/**
 * Dependency-free bounded surface with replaceable accent and selection styles.
 *
 * @layer atom
 * @status stable
 */
export declare function Card(props: CardProps): ReactElement;

import type { ReactElement, ReactNode } from "react";
/** Public inputs for a compact, icon-first action or toggle. */
export interface IconButtonProps {
    /**
     * Caller-rendered icon content (glyph, emoji, or inline SVG). Vendor-neutral
     * on purpose -- this atom never ships its own icon set.
     * @example "▢"
     */
    readonly icon: ReactNode;
    /** Optional visible label rendered beside the icon. Icon-only when omitted. */
    readonly label?: string;
    /** Accessible name and hover tooltip. Required when `label` is omitted, since an icon-only button has no other text content. */
    readonly title: string;
    /** Invoked when the button is activated. */
    readonly onClick?: () => void;
    /**
     * Whether the button displays its selected/active treatment.
     * @default false
     */
    readonly selected?: boolean;
    /**
     * Whether the button rejects interaction.
     * @default false
     */
    readonly disabled?: boolean;
    /** Optional caller-owned class name for layout composition. */
    readonly className?: string;
}
/**
 * Compact icon-first action button with an explicit selected state, for
 * toolbars, rails, and hotbars where a text-label {@link Button} would not
 * fit -- backed by the same Ant Design button as {@link Button}, with
 * Grafting owning the selected-state boundary color rather than trusting a
 * vendor theme default.
 *
 * @layer atom
 * @status stable
 */
export declare function IconButton(props: IconButtonProps): ReactElement;

import type { ReactElement } from "react";
/** Public inputs for a small, toggleable choice within a set of options. */
export interface SelectableChipProps {
    /**
     * Human-readable choice label.
     * @example "Bloco Branco"
     */
    readonly label: string;
    /** Optional color swatch rendered before the label, e.g. a material preview. */
    readonly swatchColor?: string;
    /**
     * Whether this chip is the active choice.
     * @default false
     */
    readonly selected?: boolean;
    /** Invoked when the chip is activated. Receives the chip's own next selected state, matching Ant Design's `CheckableTag` convention. */
    readonly onSelect?: (selected: boolean) => void;
    /** Optional caller-owned class name for layout composition. */
    readonly className?: string;
}
/**
 * One toggleable choice in a small set -- e.g. a material or preset picker --
 * built on Ant Design's `Tag.CheckableTag` rather than a bare `Tag`, since the
 * selectable behavior (not just the visual chip shape) is exactly what that
 * vendor primitive already models.
 *
 * @layer atom
 * @status stable
 */
export declare function SelectableChip(props: SelectableChipProps): ReactElement;

import type { ReactElement, ReactNode } from "react";
/** Public inputs for a small floating panel anchored to a trigger element. */
export interface PopoverProps {
    /** The element the popover positions itself against. */
    readonly anchor: ReactNode;
    /** Whether the popover is currently shown. */
    readonly open: boolean;
    /** Invoked when the popover requests to close, e.g. an outside click or Escape. */
    readonly onClose: () => void;
    /** Optional header text shown above the content. */
    readonly title?: string;
    /** Content rendered inside the popover body. */
    readonly children: ReactNode;
    /**
     * Which side of `anchor` the popover opens toward.
     * @default "top"
     */
    readonly placement?: "top" | "bottom" | "left" | "right";
    /** Optional caller-owned class name for layout composition. */
    readonly className?: string;
}
/**
 * Dismissible floating content anchored to a trigger element -- e.g. a
 * shape/material picker opened from a toolbar button -- built on Ant
 * Design's own `Popover` rather than a hand-positioned overlay, since
 * anchor-relative placement (including flipping when it would overflow the
 * viewport) is exactly what that vendor primitive already solves.
 *
 * @layer atom
 * @status stable
 */
export declare function Popover(props: PopoverProps): ReactElement;

import type { ReactElement, ReactNode } from "react";
/** Public inputs for a panel that slides in from a screen edge. */
export interface DrawerProps {
    /** Whether the drawer is currently shown. */
    readonly open: boolean;
    /** Invoked when the drawer requests to close, e.g. its own close button or Escape. */
    readonly onClose: () => void;
    /** Optional header text shown above the content. */
    readonly title?: string;
    /** Content rendered inside the drawer body. */
    readonly children: ReactNode;
    /**
     * Which screen edge the drawer slides in from.
     * @default "right"
     */
    readonly placement?: "left" | "right" | "top" | "bottom";
    /**
     * Drawer width (for `left`/`right` placement) or height (for `top`/`bottom`), in CSS pixels.
     * @default 320
     */
    readonly size?: number;
    /** Optional caller-owned class name for layout composition. */
    readonly className?: string;
}
/**
 * An edge-sliding settings/inspector panel, built on Ant Design's own
 * `Drawer`. Non-modal by default (no backdrop, no interaction lock on the
 * rest of the page) -- the common case for a persistent settings panel
 * beside a live 3D viewport, where blocking the scene behind it would be
 * unwanted.
 *
 * @layer atom
 * @status stable
 */
export declare function Drawer(props: DrawerProps): ReactElement;

import type { ReactElement, ReactNode } from "react";
/** One label-value row. */
export interface DescriptionItem {
    /** Stable identity within the list. */
    readonly key: string;
    /**
     * Row label.
     * @example "Node ID"
     */
    readonly label: string;
    /** Row value, plain text or caller-rendered content. */
    readonly value: ReactNode;
}
/** Public inputs for a compact label-value grid. */
export interface DescriptionsProps {
    /** The rows to display, in order. */
    readonly items: readonly DescriptionItem[];
    /**
     * How many label-value pairs sit per row.
     * @default 1
     */
    readonly column?: number;
    /** Optional caller-owned class name for layout composition. */
    readonly className?: string;
}
/**
 * A read-only label-value grid -- the right shape for an inspector or a
 * metrics panel, where {@link Card} (a bounded, bordered surface meant to
 * stand alone, e.g. in a gallery grid) adds a frame this content does not
 * need, especially when several of these already sit inside another bounded
 * surface like {@link Drawer} or a {@link Collapse} panel.
 *
 * @layer atom
 * @status stable
 */
export declare function Descriptions(props: DescriptionsProps): ReactElement;

import type { ReactElement, ReactNode } from "react";
/** One collapsible section. */
export interface CollapsePanel {
    /** Stable identity within the list, and what `defaultActiveKeys` names. */
    readonly key: string;
    /**
     * Section header, always visible.
     * @example "Inspector de Seleção"
     */
    readonly header: string;
    /** Section content, shown when expanded. */
    readonly content: ReactNode;
}
/** Public inputs for a set of stacked, individually collapsible sections. */
export interface CollapseProps {
    /** The sections, in display order. */
    readonly panels: readonly CollapsePanel[];
    /** Which panel keys start expanded. Defaults to every panel's own key, i.e. all expanded. */
    readonly defaultActiveKeys?: readonly string[];
    /**
     * Whether the whole set draws its own outer border and panel background.
     * Set to `false` when this sits inside a surface that already provides
     * its own boundary (e.g. a {@link Drawer}) -- left `true`, both frame the
     * same content and it reads as boxed twice.
     * @default true
     */
    readonly bordered?: boolean;
    /** Optional caller-owned class name for layout composition. */
    readonly className?: string;
}
/**
 * Several named sections stacked in one surface, each independently
 * expandable -- the right shape for a settings/inspector panel with more
 * than one topic, where stacking a separate {@link Card} per topic would
 * double the framing (the panel this sits inside, e.g. a {@link Drawer},
 * already provides the outer boundary).
 *
 * @layer atom
 * @status stable
 */
export declare function Collapse(props: CollapseProps): ReactElement;

import type { CSSProperties, ReactElement, ReactNode } from "react";
/** Public inputs for a single floating action, independent of any group. */
export interface FloatButtonProps {
    /** Caller-rendered icon content. Vendor-neutral -- this atom never ships its own icon set. */
    readonly icon: ReactNode;
    /** Tooltip and accessible name -- a float button shows no visible text label of its own. */
    readonly tooltip: string;
    /** Invoked when this button is activated. */
    readonly onClick?: () => void;
    /** Renders this button non-interactive. */
    readonly disabled?: boolean;
    /**
     * Emphasis. `"primary"` is the right choice for a button that opens a
     * panel rather than firing a direct action, so it reads as distinct from
     * a same-row action cluster.
     * @default "default"
     */
    readonly tone?: "default" | "primary";
    /**
     * Outline. `"square"` reads as part of a joined block -- pair it with a
     * `FloatButtonGroup` molecule using the same shape so the two visually
     * belong together.
     * @default "circle"
     */
    readonly shape?: "circle" | "square";
    /** Optional caller-owned class name for layout composition. */
    readonly className?: string;
    /** Optional caller-owned inline style, e.g. to place this button at a specific fixed position. */
    readonly style?: CSSProperties;
}
/**
 * One floating action, standalone -- the right shape for a corner-fixed
 * trigger like a settings-panel toggle, or a `Popover`/`Drawer` anchor whose
 * behavior (opens a panel) does not belong inside a `FloatButtonGroup`
 * molecule's list of direct actions.
 *
 * @layer atom
 * @status stable
 */
export declare function FloatButton(props: FloatButtonProps): ReactElement;

import type { CSSProperties, ReactElement } from "react";
/** Public inputs for a small handle fused to one edge of a panel, toggling it open/closed. */
export interface EdgeHandleProps {
    /** Whether the panel this handle belongs to is currently open. */
    readonly open: boolean;
    /** Invoked on a plain tap/click (movement below the drag threshold) or a keyboard activation. Never called for a real drag -- use `onDragEnd` for that. */
    readonly onClick: () => void;
    /**
     * Which edge of the panel the handle protrudes from -- `"right"` bulges
     * rightward (for a panel anchored to the screen's left edge), `"left"`
     * bulges leftward (for a panel anchored to the right edge).
     */
    readonly edge: "left" | "right";
    /** Tooltip and accessible name. */
    readonly title: string;
    /** Optional caller-owned class name for layout composition. */
    readonly className?: string;
    /** Optional caller-owned inline style, e.g. to place this handle at a specific position. */
    readonly style?: CSSProperties;
    /**
     * Optional drag reporting. Once a press moves past a small threshold,
     * `onDrag` fires on every subsequent move with the horizontal offset (in
     * pixels, signed) from where the press started, and `onDragEnd` fires
     * once on release with the final offset -- a caller (e.g. `SlidingPanel`)
     * uses these to let the panel itself track the pointer 1:1 while
     * dragging. A press that never crosses the threshold is a plain tap and
     * only calls `onClick`; provide both callbacks together or neither.
     */
    readonly onDrag?: (deltaX: number) => void;
    /** Fires once on release, only after a real drag (see `onDrag`). */
    readonly onDragEnd?: (deltaX: number) => void;
}
/** The handle's own footprint (`width`, half of `height`) -- exported so a caller composing a panel around this handle (e.g. `SlidingPanel`) can position it flush against the panel's edge without duplicating the magic number. */
export declare const EDGE_HANDLE_SIZE = 28;
/**
 * A half-round tab fused to one edge of a panel -- rounded on the side
 * facing away from the panel, flat on the side touching it, so it reads as
 * grown out of the panel rather than a separate floating control. Toggles
 * the panel open/closed on tap; optionally reports raw drag deltas so a
 * caller can let the panel itself be pulled open/closed, not just clicked.
 * No library ships this shape (confirmed by research before building it --
 * shadcn/ui's `SidebarRail` is the closest published pattern, but it is a
 * full-height drag rail on a Tailwind/Radix stack this project does not
 * use, not this shape). Hand-built CSS is the right size of solution here:
 * one small shape, no dependency.
 *
 * @layer atom
 * @status stable
 */
export declare function EdgeHandle(props: EdgeHandleProps): ReactElement;

import type { ReactElement, ReactNode } from "react";
import type { CardShape, UiMountHandle, UiStatus } from "../shared-types.js";
/** Public inputs for a reusable entity summary shown in canvases, tables, or inspectors. */
export interface EntitySummaryProps {
    /**
     * Primary human-readable entity name.
     * @example "architecture-studio"
     */
    readonly title: string;
    /**
     * Optional secondary description.
     * @example "project"
     */
    readonly description?: string;
    /** Optional semantic status. */
    readonly status?: UiStatus;
    /** Human-readable label paired with status. */
    readonly statusLabel?: string;
    /** Optional visual placed before the textual identity. */
    readonly leading?: ReactNode;
    /** Optional actions placed after the textual identity. */
    readonly actions?: ReactNode;
    /** Optional accessible name for the summary container. */
    readonly ariaLabel?: string;
    /** Optional caller-owned class name for layout composition. */
    readonly className?: string;
    /** Optional accent used for the complete card boundary. */
    readonly accentColor?: string;
    /** Optional background color for the complete card surface. */
    readonly backgroundColor?: string;
    /**
     * Whether the card occupies the complete width and height of its container.
     * @default false
     */
    readonly fillContainer?: boolean;
    /**
     * Whether the card should communicate pointer interaction.
     * @default false
     */
    readonly interactive?: boolean;
    /**
     * Whether the card displays its selected treatment.
     * @default false
     */
    readonly selected?: boolean;
    /** Optional boundary color used when the component is selected. */
    readonly selectedColor?: string;
    /**
     * Optional boundary width in CSS pixels.
     * @default 1
     */
    readonly borderWidth?: number;
    /**
     * Optional rounded-corner radius in CSS pixels.
     * @default 8
     */
    readonly borderRadius?: number;
    /**
     * Optional body padding in CSS pixels.
     * @default 12
     */
    readonly bodyPadding?: number;
    /**
     * Optional gap between the component's content regions.
     * @default 10
     */
    readonly contentGap?: number;
    /**
     * Optional short caller-owned labels rendered as compact badges below the identity.
     * @default []
     */
    readonly tags?: readonly string[];
    /** Optional glow color rendered as an outer shadow, e.g. to signal live status. */
    readonly glowColor?: string;
    /**
     * Geometric outline of the card; defaults to a rounded rectangle.
     * @default "rectangle"
     */
    readonly shape?: CardShape;
    /** Optional label for a compact action button rendered in the card. */
    readonly actionLabel?: string;
    /** Invoked when the action button is activated. */
    readonly onAction?: () => void;
}
/**
 * Composable identity card built from Card, Text, and StatusBadge.
 *
 * @layer molecule
 * @status stable
 */
export declare function EntitySummary(props: EntitySummaryProps): ReactElement;
/** Mounts an EntitySummary into an existing DOM host without exposing ReactDOM. */
export declare function mountEntitySummary(host: HTMLElement, props: EntitySummaryProps): UiMountHandle<EntitySummaryProps>;

import type { ReactElement, ReactNode } from "react";
import type { UiStatus } from "../shared-types.js";
/** Public inputs for a gallery-style tile: cover image, title/description, status, tags, and actions. */
export interface PreviewCardProps {
    /**
     * Primary human-readable title.
     * @example "Heightmap generation"
     */
    readonly title: string;
    /**
     * Optional secondary description.
     * @example "Perlin-noise procedural terrain heightmap, computed in Rust via Wasm."
     */
    readonly description?: string;
    /**
     * Optional cover image shown above the title, clipped to the card's own
     * corners. `alt` is bundled with `src` so accessible text can never be
     * forgotten when a cover is present.
     * @example
     * ```tsx
     * { src: "/preview.png", alt: "Rendered heightmap preview" }
     * ```
     */
    readonly cover?: {
        readonly src: string;
        readonly alt: string;
    };
    /**
     * Optional semantic status.
     * @example "success"
     */
    readonly status?: UiStatus;
    /**
     * Human-readable label paired with status.
     * @example "Adopted"
     */
    readonly statusLabel?: string;
    /**
     * Optional short caller-owned labels rendered as compact badges.
     * @default []
     * @example ["MIT", "top pick"]
     */
    readonly tags?: readonly string[];
    /** Optional actions rendered at the bottom of the card. */
    readonly actions?: ReactNode;
    /** Optional accessible name for the card container. */
    readonly ariaLabel?: string;
    /** Optional caller-owned class name for layout composition. */
    readonly className?: string;
    /** Optional glow color rendered as an outer shadow, e.g. to signal live status. */
    readonly glowColor?: string;
    /**
     * Whether the card should communicate pointer interaction.
     * @default false
     */
    readonly interactive?: boolean;
    /**
     * Whether the card displays its selected treatment.
     * @default false
     */
    readonly selected?: boolean;
    /** Optional boundary color used when the card is selected. */
    readonly selectedColor?: string;
    /** Optional accent used for the card boundary. */
    readonly accentColor?: string;
    /**
     * Optional background color for the card surface.
     * @default "#ffffff"
     */
    readonly backgroundColor?: string;
    /**
     * Whether the card occupies the complete width and height of its container.
     * @default false
     */
    readonly fillContainer?: boolean;
}
/**
 * Gallery-style tile built from Card, Text, and StatusBadge: a cover image,
 * title/description, status, tags, and caller-owned actions.
 *
 * @layer molecule
 * @status stable
 */
export declare function PreviewCard(props: PreviewCardProps): ReactElement;

import type { CSSProperties, ReactElement, ReactNode } from "react";
/** One action inside a {@link FloatButtonGroup}. */
export interface FloatButtonItem {
    /** Stable identity within the list. */
    readonly key: string;
    /** Caller-rendered icon content. Vendor-neutral -- this molecule never ships its own icon set. */
    readonly icon: ReactNode;
    /** Tooltip and accessible name -- a float button shows no visible text label of its own. */
    readonly tooltip: string;
    /** Invoked when this item is activated. */
    readonly onClick?: () => void;
    /** Renders this item non-interactive. */
    readonly disabled?: boolean;
    /**
     * Emphasis, e.g. to mark the currently-active item in a tool selector.
     * @default "default"
     */
    readonly tone?: "default" | "primary";
}
/** Public inputs for a cluster of floating actions, either collapsed behind one trigger or always visible as a plain row/column. */
export interface FloatButtonGroupProps {
    /** The trigger's own icon, shown when the group is collapsed. Unused when `alwaysExpanded` is set -- there is no trigger to show it on. */
    readonly icon?: ReactNode;
    /** The actions revealed when the group is open, in display order. */
    readonly items: readonly FloatButtonItem[];
    /**
     * Which side the group expands toward from the trigger -- `"top"`/`"bottom"`
     * stack items in a vertical column, `"left"`/`"right"` lay them out in a
     * horizontal row. When `alwaysExpanded` is set, this only picks the row's
     * axis (vertical for `"top"`/`"bottom"`, horizontal for `"left"`/`"right"`),
     * since there is no trigger to expand away from.
     * @default "top"
     */
    readonly placement?: "top" | "left" | "right" | "bottom";
    /**
     * Whether the group opens on click or hover. Ignored when `alwaysExpanded`
     * is set.
     * @default "click"
     */
    readonly trigger?: "click" | "hover";
    /**
     * Controlled open state, together with `trigger` -- required to close the
     * group programmatically, e.g. after an item's own `onClick` fires, since
     * Ant Design does not do that on its own. Uncontrolled (starts collapsed,
     * closes only on its own trigger/outside click) when omitted. Ignored
     * when `alwaysExpanded` is set.
     */
    readonly open?: boolean;
    /** Invoked with the group's next open state, e.g. on an outside click or its own trigger. */
    readonly onOpenChange?: (open: boolean) => void;
    /**
     * Outline. `"square"` renders the items as one joined, gapless block
     * (Ant Design's own compact-group styling) instead of separate floating
     * circles -- the trigger itself, which becomes the close control once
     * open, always renders as its own separate element outside that block.
     * Ignored (no joined styling) when `alwaysExpanded` is set.
     * @default "circle"
     */
    readonly shape?: "circle" | "square";
    /**
     * Skips the collapsible trigger entirely -- every item renders directly,
     * always visible, with no separate open/close button. Use this for a
     * plain always-on toolbar rather than a Foundry-style "tap to reveal"
     * menu.
     * @default false
     */
    readonly alwaysExpanded?: boolean;
    /** Optional caller-owned class name for layout composition. */
    readonly className?: string;
    /** Optional caller-owned inline style, e.g. to place this group's trigger at a specific fixed position. */
    readonly style?: CSSProperties;
}
/**
 * A cluster of floating actions -- either collapsed behind one trigger
 * (Ant Design's own `FloatButton.Group`, for a Foundry-style tool menu: a
 * category button that reveals its own sub-items) or, with `alwaysExpanded`,
 * a plain always-visible row/column of the same items with no trigger at
 * all. The atom `FloatButton` remains the right choice for a single
 * standalone action; this molecule is for a *cluster*.
 *
 * The collapsed path renders its items as Ant Design's own `FloatButton`
 * directly, not this package's `FloatButton` atom -- `FloatButton.Group`
 * recognizes its children by that exact component reference to apply
 * group-item styling and layout, and a wrapping component in between breaks
 * that recognition silently (the group renders, but its items lose the
 * group's own positioning and behavior). The `alwaysExpanded` path has no
 * such constraint (no `FloatButton.Group` involved), but uses the same
 * direct `AntFloatButton` reference for consistency.
 *
 * @layer molecule
 * @status stable
 */
export declare function FloatButtonGroup(props: FloatButtonGroupProps): ReactElement;

import type { CSSProperties, ReactElement, ReactNode } from "react";
/** Public inputs for a panel anchored to one screen edge that slides fully off-screen when closed, dragged open/closed by a handle fused to its own edge. */
export interface SlidingPanelProps {
    /** Whether the panel is currently open. */
    readonly open: boolean;
    /** Invoked with the panel's next open state, from a tap or a drag past the midpoint. */
    readonly onOpenChange: (open: boolean) => void;
    /** Which screen edge the panel is anchored to. */
    readonly edge: "left" | "right";
    /** Panel width in pixels. */
    readonly width: number;
    /** Header text shown at the top of the panel's content area. */
    readonly title: string;
    /** The panel's own content, below the title. */
    readonly children: ReactNode;
    /** Stacking order for the panel's own fixed container. @default 20 */
    readonly zIndex?: number;
    /** Optional caller-owned class name for the panel's own container. */
    readonly className?: string;
    /** Optional caller-owned inline style, merged onto the panel's own container. */
    readonly style?: CSSProperties;
}
/**
 * A panel fixed to one edge of the screen that slides fully off-screen when
 * closed and back into view when open, with an {@link EdgeHandle} fused to
 * its edge as the drag/toggle control -- the handle is a child of the
 * panel's own transformed element, so it visually travels with the slide
 * animation instead of sitting at a fixed screen position while the panel
 * moves independently underneath it. The handle can also be dragged: while
 * pressed, the panel tracks the pointer 1:1 (no transition), and on release
 * it snaps to whichever side (open/closed) it crossed the midpoint toward.
 *
 * Not built on `Drawer` (this package's own, wrapping Ant Design's): that
 * component's portal/motion internals give no seam to attach external
 * content that moves with its animated edge, which is the entire point of
 * this molecule.
 *
 * @layer molecule
 * @status stable
 */
export declare function SlidingPanel(props: SlidingPanelProps): ReactElement;

import type { ReactElement, ReactNode } from "react";
/** Stable key used to identify a table row independently of its position. */
export type DataTableRowKey = string | number;
/** Immutable context supplied to a custom table-cell renderer. */
export interface DataTableCellContext<Row extends object> {
    /** Complete caller-owned row. */
    readonly row: Row;
    /** Value projected by the column. */
    readonly value: unknown;
    /** Current presentation index of the row. */
    readonly rowIndex: number;
}
/** Vendor-neutral description of one data-table column. */
export interface DataTableColumn<Row extends object> {
    /** Stable column identifier. */
    readonly id: string;
    /** Human-readable column heading. */
    readonly header: string;
    /** Projects the value represented by this column. */
    readonly value: (row: Row) => unknown;
    /** Optional custom React presentation for the projected cell value. */
    readonly renderCell?: (context: DataTableCellContext<Row>) => ReactNode;
    /** Optional width in CSS pixels. */
    readonly width?: number;
    /** Optional horizontal alignment. */
    readonly align?: "start" | "center" | "end";
}
/** Controlled row-selection contract for a data table. */
export interface DataTableSelection {
    /** Currently selected stable row keys. */
    readonly selectedKeys: readonly DataTableRowKey[];
    /** Receives the complete next selection. */
    readonly onChange: (keys: readonly DataTableRowKey[]) => void;
}
/** Minimal pagination contract independent of the current table engine. */
export interface DataTablePagination {
    /** Number of rows rendered on each page. */
    readonly pageSize: number;
    /** Whether controls disappear when every row fits on one page. */
    readonly hideWhenSinglePage?: boolean;
}
/** Public inputs for the reusable Grafting data table. */
export interface DataTableProps<Row extends object> {
    /**
     * Immutable caller-owned rows.
     * @example
     * ```tsx
     * [{ id: "a", name: "architecture-studio" }, { id: "b", name: "ui" }]
     * ```
     */
    readonly rows: readonly Row[];
    /**
     * Immutable vendor-neutral column definitions.
     * @example
     * ```tsx
     * [{ id: "name", header: "Name", value: (row) => row.name }]
     * ```
     */
    readonly columns: readonly DataTableColumn<Row>[];
    /**
     * Returns the stable key for a row.
     * @example (row) => row.id
     */
    readonly rowKey: (row: Row) => DataTableRowKey;
    /**
     * Accessible table name.
     * @example "Repository nodes"
     */
    readonly ariaLabel: string;
    /** Optional controlled selection. */
    readonly selection?: DataTableSelection;
    /**
     * Optional pagination, or false to render all rows.
     * @default
     * ```tsx
     * { pageSize: 20, hideWhenSinglePage: true }
     * ```
     */
    readonly pagination?: DataTablePagination | false;
    /**
     * Optional table density.
     * @default "compact"
     */
    readonly density?: "compact" | "regular";
    /**
     * Optional text shown when there are no rows.
     * @default "No data"
     */
    readonly emptyMessage?: string;
    /** Whether a loading treatment is displayed. */
    readonly loading?: boolean;
    /** Optional caller-owned class name for layout composition. */
    readonly className?: string;
}
/**
 * Immutable rows table with controlled selection and custom renderers.
 *
 * @layer organism
 * @status stable
 */
export declare function DataTable<Row extends object>(props: DataTableProps<Row>): ReactElement;

import type { CSSProperties, ReactElement, ReactNode } from "react";
/** How a branch's own submenu opens. */
export type FloatButtonTreeTrigger = "click" | "hover";
/** How siblings under the same branch coordinate their open state. `"accordion"` closes any other open sibling when one opens; `"multiple"` lets them stay open together. */
export type FloatButtonTreeSiblingMode = "accordion" | "multiple";
/** Which side a branch's own submenu expands toward from its trigger. */
export type FloatButtonTreePlacement = "top" | "right" | "bottom" | "left";
/** A direct action -- the tree's equivalent of a leaf node. */
export interface FloatButtonTreeLeaf {
    /** Stable identity among its siblings. */
    readonly key: string;
    /** Caller-rendered icon content. Vendor-neutral -- this organism never ships its own icon set. */
    readonly icon: ReactNode;
    /** Tooltip and accessible name -- a float button shows no visible text label of its own. */
    readonly tooltip: string;
    /** Emphasis, e.g. to mark the currently-active leaf in a selector. */
    readonly tone?: "default" | "primary";
    /** Renders this leaf non-interactive. */
    readonly disabled?: boolean;
    /** Invoked when this leaf is activated. Closes the whole tree afterward, like choosing a menu action. */
    readonly onClick: () => void;
    /** Absent on a leaf -- its presence (not its value) is what distinguishes a {@link FloatButtonTreeBranch} from a leaf. */
    readonly children?: undefined;
}
/** A branch: its own floating trigger, revealing a nested list of further {@link FloatButtonTreeNode}s -- leaves, or further branches. */
export interface FloatButtonTreeBranch {
    /** Stable identity among its siblings. */
    readonly key: string;
    /** Caller-rendered icon content. Vendor-neutral -- this organism never ships its own icon set. */
    readonly icon: ReactNode;
    /** Tooltip and accessible name -- a float button shows no visible text label of its own. */
    readonly tooltip: string;
    /** Emphasis, e.g. to mark the currently-active branch in a selector. */
    readonly tone?: "default" | "primary";
    /** Renders this branch's own trigger non-interactive. */
    readonly disabled?: boolean;
    /** Absent on a branch -- a branch opens its `children`, it does not fire a direct action. */
    readonly onClick?: undefined;
    /** The nodes revealed when this branch opens, in display order. */
    readonly children: readonly FloatButtonTreeNode[];
    /** Overrides the tree-level default trigger for this branch's own submenu. */
    readonly trigger?: FloatButtonTreeTrigger;
    /** Overrides the tree-level default sibling behavior among this branch's own children. */
    readonly siblingMode?: FloatButtonTreeSiblingMode;
    /** Overrides the tree-level default expand direction for this branch's own submenu. */
    readonly placement?: FloatButtonTreePlacement;
}
/** One node of a {@link FloatButtonTree}: either a leaf action or a branch with its own nested children. */
export type FloatButtonTreeNode = FloatButtonTreeLeaf | FloatButtonTreeBranch;
/** Public inputs for a tree of floating-button groups -- a group whose items can themselves be groups. */
export interface FloatButtonTreeProps {
    /** The tree's single entry point. Always a branch: a tree with nothing to expand is just a `FloatButton`. */
    readonly root: FloatButtonTreeBranch;
    /** Default submenu trigger for every branch that does not set its own. @default "click" */
    readonly trigger?: FloatButtonTreeTrigger;
    /** Default sibling behavior for every branch that does not set its own. @default "accordion" */
    readonly siblingMode?: FloatButtonTreeSiblingMode;
    /** Default submenu expand direction for every branch that does not set its own. @default "right" */
    readonly placement?: FloatButtonTreePlacement;
    /** Outline for every button in the tree. @default "circle" */
    readonly shape?: "circle" | "square";
    /** Optional caller-owned class name for the tree's own root position wrapper. */
    readonly className?: string;
    /** Optional caller-owned inline style, e.g. to fix the tree's root to a corner of the screen. */
    readonly style?: CSSProperties;
}
/**
 * A tree of floating-button groups: a root trigger reveals a floating list
 * of items, any of which can itself be a branch with its own nested list
 * -- "a group of groups". Generic and product-agnostic: every node is
 * plain data (an action, or an icon/tooltip plus more nodes), nothing here
 * names a product concept.
 *
 * Built on `@floating-ui/react` (MIT, the maintained successor to Popper.js)
 * rather than hand-rolled, specifically for its `FloatingTree` primitive:
 * coordinating open/close state, dismissal, and positioning across an
 * arbitrarily nested set of floating elements is exactly the hard part a
 * library should own. The event-coordination pattern here (a branch
 * announces opening via `tree.events` so accordion siblings close, a leaf
 * click announces closing the whole tree) mirrors Floating UI's own
 * reference nested-menu implementation
 * (`packages/react/test/visual/components/Menu.tsx` in their monorepo),
 * simplified: no roving-tabindex list navigation or typeahead, since this
 * is a cluster of buttons, not a full ARIA menu widget.
 *
 * Every branch's trigger mode (`"click"` | `"hover"`) and sibling behavior
 * (`"accordion"` | `"multiple"`) default from this component's own props
 * but can be overridden per branch node, so one tree can mix e.g.
 * click-to-open categories with hover-to-open sub-items.
 *
 * @layer organism
 * @status stable
 */
export declare function FloatButtonTree(props: FloatButtonTreeProps): ReactElement;

import type { ReactElement, ReactNode } from "react";
/** Stable caller-owned identity for one panel in a Grafting grid layout. */
export type GridPanelId = string;
/** Vendor-neutral position and size of one panel, in grid units, not pixels. */
export interface GridPanelPlacement {
    /** Stable identity matching the panel this placement belongs to. */
    readonly id: GridPanelId;
    /** Horizontal position in grid columns, zero-indexed from the left. */
    readonly x: number;
    /** Vertical position in grid rows, zero-indexed from the top. */
    readonly y: number;
    /** Width in grid columns. */
    readonly width: number;
    /** Height in grid rows. */
    readonly height: number;
    /** Optional minimum width in grid columns. */
    readonly minWidth?: number;
    /** Optional minimum height in grid rows. */
    readonly minHeight?: number;
    /** Optional maximum width in grid columns. */
    readonly maxWidth?: number;
    /** Optional maximum height in grid rows. */
    readonly maxHeight?: number;
    /** Whether the panel is fixed in place and excluded from drag or resize. */
    readonly locked?: boolean;
}
/** One panel rendered by the Grafting grid layout. */
export interface GridPanel {
    /** Current placement of this panel. */
    readonly placement: GridPanelPlacement;
    /** Caller-owned content rendered inside the panel. */
    readonly content: ReactNode;
}
/** Public inputs for the reusable Grafting dashboard grid layout. */
export interface GridLayoutProps {
    /**
     * Immutable caller-owned panels and their current placements.
     * @example
     * ```tsx
     * [{ placement: { id: "p1", x: 0, y: 0, width: 12, height: 4 }, content: <div>Panel</div> }]
     * ```
     */
    readonly panels: readonly GridPanel[];
    /**
     * Accessible name for the grid region.
     * @example "Studio dashboard"
     */
    readonly ariaLabel: string;
    /**
     * Number of columns the grid is divided into.
     * @default 12
     */
    readonly columns?: number;
    /**
     * Height of one grid row in CSS pixels.
     * @default 32
     */
    readonly rowHeight?: number;
    /**
     * Gap between panels in CSS pixels, applied both horizontally and vertically.
     * @default 12
     */
    readonly gap?: number;
    /** Whether panels can be dragged to a new position. */
    readonly draggable?: boolean;
    /** Whether panels can be resized. */
    readonly resizable?: boolean;
    /** Receives the complete next placement for every panel after a drag, resize, or compaction. */
    readonly onPlacementsChange?: (placements: readonly GridPanelPlacement[]) => void;
    /** Optional caller-owned class name for layout composition. */
    readonly className?: string;
}
/**
 * Draggable/resizable dashboard layout using Grafting-owned panel contracts.
 *
 * Consumers whose bundler does not already provide it must import
 * `react-grid-layout/css/styles.css` once at the application level; this
 * package does not import it as a side effect (it declares `sideEffects:
 * false`), so the choice of when and whether to load that stylesheet stays
 * with the consuming application.
 *
 * @layer atom
 * @status stable
 */
export declare function GridLayout(props: GridLayoutProps): ReactElement;

import type { GeometryCanvas, GeometryCanvasOptions } from "./geometry/contracts.js";
import type { CanvasEdge, CanvasHandle, CanvasNode, CanvasOptions } from "./graph/contracts.js";
import type { HeightfieldCanvas, HeightfieldCanvasOptions } from "./heightfield/contracts.js";
export type { CanvasConnectionDecision, CanvasConnectionEndpoint, CanvasConnectionRequest, CanvasEdge, CanvasEdgeConnector, CanvasEdgeLabelPresentation, CanvasEdgeLinePresentation, CanvasEdgeMarkerPresentation, CanvasEdgePresentation, CanvasEdgeRenderContext, CanvasEdgeTerminal, CanvasEdgeViewDefinition, CanvasEditingOptions, CanvasEntityReference, CanvasGridPresentation, CanvasHandle, CanvasInteractionModifier, CanvasInteractionOptions, CanvasNode, CanvasNodeRenderContext, CanvasNodeRenderHandle, CanvasNodeViewDefinition, CanvasOptions, CanvasPortDefinition, CanvasPortDirection, CanvasPortPosition, CanvasPortPresentation, CanvasSurfacePresentation, CanvasViewportOptions, CanvasZoomOptions, } from "./graph/contracts.js";
export type { HeightfieldCanvas, HeightfieldCanvasOptions, } from "./heightfield/contracts.js";
/**
 * Creates a graph canvas from caller-owned presentation data.
 *
 * The UI boundary preserves identifiers and coordinates, mounts
 * consumer-supplied views, and keeps its rendering engine private. Graph
 * layout remains an explicit upstream computation.
 *
 * @param container - Browser element that owns the canvas surface.
 * @param nodes - Immutable node presentation data.
 * @param edges - Immutable connection presentation data.
 * @param options - Consumer-supplied views and replaceable presentation policy.
 * @returns A frozen Grafting-owned lifecycle handle.
 */
export declare function createCanvas(container: HTMLElement, nodes: readonly CanvasNode[], edges: readonly CanvasEdge[], options: CanvasOptions): CanvasHandle;
/**
 * Mounts a real-time heightfield preview while keeping the renderer private.
 *
 * @param container - Browser element that owns the rendered preview.
 * @param options - Grid data and replaceable presentation options.
 * @returns A Grafting-owned update, capture, and disposal handle.
 */
export declare function createHeightfieldCanvas(container: HTMLElement, options: HeightfieldCanvasOptions): HeightfieldCanvas;
export type { GeometryCanvas, GeometryCanvasOptions } from "./geometry/contracts.js";
/**
 * Mounts a real-time preview of arbitrary triangle geometry, keeping the
 * renderer private.
 *
 * Separate from {@link createHeightfieldCanvas} rather than a mode of it: a
 * raster holds one height per point, and geometry off the lattice or with a
 * vertical step has more than one.
 *
 * @param container - Browser element that owns the rendered preview.
 * @param options - Geometry and replaceable presentation options.
 * @returns A Grafting-owned update, capture, and disposal handle.
 */
export declare function createGeometryCanvas(container: HTMLElement, options: GeometryCanvasOptions): GeometryCanvas;
```
