import { FloatButton as AntFloatButton } from "antd";
import type { CSSProperties, ReactElement, ReactNode } from "react";

/** One action inside a {@link FloatButtonGroup}. */
export interface FloatButtonItem {
  /**
   * Stable identity within the list.
   * @example "action-1"
   */
  readonly key: string;
  /**
   * Caller-rendered icon content. Vendor-neutral -- this molecule never ships its own icon set.
   * @example "⚙"
   */
  readonly icon: ReactNode;
  /**
   * Tooltip and accessible name -- a float button shows no visible text label of its own.
   * @example "Configurações"
   */
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
  /**
   * The actions revealed when the group is open, in display order.
   * @example
   * ```tsx
   * [{ key: "action-1", icon: "⚙", tooltip: "Settings" }]
   * ```
   */
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
export function FloatButtonGroup(props: FloatButtonGroupProps): ReactElement {
  if (props.alwaysExpanded === true) {
    const vertical = props.placement === "top" || props.placement === "bottom" || props.placement === undefined;
    return (
      <div
        className={props.className}
        style={{ display: "flex", flexDirection: vertical ? "column" : "row", gap: "0.5rem", ...props.style }}
      >
        {props.items.map((item) => (
          <AntFloatButton
            key={item.key}
            icon={item.icon}
            tooltip={item.tooltip}
            onClick={item.onClick}
            disabled={item.disabled}
            type={item.tone ?? "default"}
            shape={props.shape ?? "circle"}
            style={{ position: "static" }}
          />
        ))}
      </div>
    );
  }

  return (
    <AntFloatButton.Group
      className={props.className}
      style={props.style}
      icon={props.icon}
      placement={props.placement ?? "top"}
      trigger={props.trigger ?? "click"}
      open={props.open}
      onOpenChange={props.onOpenChange}
      shape={props.shape ?? "circle"}
    >
      {props.items.map((item) => (
        <AntFloatButton
          key={item.key}
          icon={item.icon}
          tooltip={item.tooltip}
          onClick={item.onClick}
          disabled={item.disabled}
          type={item.tone ?? "default"}
        />
      ))}
    </AntFloatButton.Group>
  );
}
