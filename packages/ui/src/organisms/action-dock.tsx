import type { CSSProperties, ReactElement, ReactNode } from "react";

/** One sub-action or variant inside an active {@link ActionDockItem}. */
export interface ActionDockSubItem {
  /** Stable identity of the sub-item. */
  readonly key: string;
  /** Visible label or accessible title. */
  readonly label: string;
  /** Caller-rendered icon. */
  readonly icon?: ReactNode;
  /** Tooltip description. */
  readonly tooltip?: string;
  /** Keyboard shortcut hint (e.g. "1", "2", "Shift+W"). */
  readonly shortcut?: string;
  /** Whether this sub-item is currently active. */
  readonly active?: boolean;
  /** Whether this sub-item is disabled. */
  readonly disabled?: boolean;
  /** Invoked when this sub-item is clicked. */
  readonly onClick?: () => void;
  /** Optional caller-owned class name. */
  readonly className?: string;
}

/** One primary category or tool action in the {@link ActionDock}. */
export interface ActionDockItem {
  /** Stable identity of the tool or category. */
  readonly key: string;
  /** Visible label or accessible title. */
  readonly label: string;
  /** Caller-rendered icon. */
  readonly icon: ReactNode;
  /** Tooltip description. */
  readonly tooltip?: string;
  /** Keyboard shortcut hint (e.g. "B", "W", "P", "T"). */
  readonly shortcut?: string;
  /** Whether this tool/category is currently active. */
  readonly active?: boolean;
  /** Whether any child sub-item of this item is active. */
  readonly childActive?: boolean;
  /** Whether this item is non-interactive. */
  readonly disabled?: boolean;
  /** Invoked when this item is clicked. */
  readonly onClick?: () => void;
  /** Optional sub-tools revealed above this button when it is active. */
  readonly subItems?: readonly ActionDockSubItem[];
  /** Optional caller-owned class name. */
  readonly className?: string;
}

/** Public inputs for the generic {@link ActionDock} bottom toolbar organism. */
export interface ActionDockProps {
  /** Accessible name for the toolbar region. @default "Barra de ferramentas de construção" */
  readonly ariaLabel?: string;
  /** Primary construction verbs / categories in display order. */
  readonly items: readonly ActionDockItem[];
  /** Optional leading accessories rendered alongside the items. */
  readonly leadingAccessories?: ReactNode;
  /** Optional trailing accessories rendered alongside the items. */
  readonly trailingAccessories?: ReactNode;
  /** Optional caller-owned class name applied to the outer wrapper. */
  readonly className?: string;
  /** Optional inline style override for the outer wrapper. */
  readonly style?: CSSProperties;
}

/**
 * A generic bottom action dock organism.
 *
 * Renders an accessible toolbar of primary actions with optional expandable
 * sub-action rows positioned horizontally above active items.
 *
 * All visual identity (theming, colors, glassmorphism, sketch styles) is owned
 * by the consuming application via CSS classes (`.grafting-action-dock`,
 * `.grafting-action-dock__item`, etc.).
 *
 * @layer organism
 * @status stable
 */
export function ActionDock(props: ActionDockProps): ReactElement {
  const {
    ariaLabel = "Barra de ferramentas de construção",
    items,
    leadingAccessories,
    trailingAccessories,
    className,
    style,
  } = props;

  return (
    <div
      role="toolbar"
      aria-label={ariaLabel}
      className={`grafting-action-dock ${className ?? ""}`.trim()}
      style={style}
    >
      {leadingAccessories && (
        <div className="grafting-action-dock__accessories grafting-action-dock__accessories--leading">
          {leadingAccessories}
        </div>
      )}

      <div className="grafting-action-dock__items">
        {items.map((item) => {
          const hasSubItems = (item.subItems?.length ?? 0) > 0;
          const isActive = item.active === true;
          const isChildActive = item.childActive === true;
          const showSub = hasSubItems && (isActive || isChildActive);

          return (
            <div
              key={item.key}
              className="grafting-action-dock__item-wrapper"
              data-active={isActive ? "true" : undefined}
              data-child-active={isChildActive ? "true" : undefined}
            >
              {showSub && item.subItems && (
                <div
                  role="group"
                  aria-label="Variações de ferramenta"
                  className="grafting-action-dock__sub-items"
                >
                  {item.subItems.map((subItem) => (
                    <button
                      key={subItem.key}
                      type="button"
                      disabled={subItem.disabled}
                      onClick={subItem.onClick}
                      title={subItem.tooltip ?? subItem.label}
                      aria-pressed={subItem.active === true}
                      data-active={subItem.active ? "true" : undefined}
                      className={`grafting-action-dock__sub-item ${subItem.className ?? ""}`.trim()}
                    >
                      {subItem.icon && (
                        <span className="grafting-action-dock__icon">{subItem.icon}</span>
                      )}
                      <span className="grafting-action-dock__label">{subItem.label}</span>
                      {subItem.shortcut && (
                        <span className="grafting-action-dock__shortcut">{subItem.shortcut}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              <button
                type="button"
                disabled={item.disabled}
                onClick={item.onClick}
                title={item.tooltip ?? item.label}
                aria-pressed={isActive || isChildActive}
                data-active={isActive ? "true" : undefined}
                data-child-active={isChildActive ? "true" : undefined}
                className={`grafting-action-dock__item ${item.className ?? ""}`.trim()}
              >
                <span className="grafting-action-dock__icon">{item.icon}</span>
                <span className="grafting-action-dock__label">{item.label}</span>
                {item.shortcut && (
                  <span className="grafting-action-dock__shortcut">{item.shortcut}</span>
                )}
              </button>
            </div>
          );
        })}
      </div>

      {trailingAccessories && (
        <div className="grafting-action-dock__accessories grafting-action-dock__accessories--trailing">
          {trailingAccessories}
        </div>
      )}
    </div>
  );
}
