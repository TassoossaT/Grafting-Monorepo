import { useState } from "react";
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
  /** Whether this item is non-interactive. */
  readonly disabled?: boolean;
  /** Invoked when this item is clicked. */
  readonly onClick?: () => void;
  /** Optional sub-tools or variations revealed when this category is active. */
  readonly subItems?: readonly ActionDockSubItem[];
}

/** Public props for the {@link ActionDock} bottom toolbar organism. */
export interface ActionDockProps {
  /** Accessible name for the toolbar region. @default "Barra de ferramentas de construção" */
  readonly ariaLabel?: string;
  /** Primary construction verbs / categories in display order. */
  readonly items: readonly ActionDockItem[];
  /** Optional leading actions (e.g. undo, redo, camera navigation). */
  readonly leadingAccessories?: ReactNode;
  /** Optional trailing actions (e.g. grid snap toggle, settings drawer toggle). */
  readonly trailingAccessories?: ReactNode;
  /** Outline style for the dock buttons. @default "rounded" */
  readonly shape?: "rounded" | "square";
  /** Optional caller-owned class name. */
  readonly className?: string;
  /** Optional inline style override. */
  readonly style?: CSSProperties;
}

/**
 * A minimalist, glassmorphic bottom action dock inspired by Tiny Glade and
 * modern creative sandboxes.
 *
 * It houses the primary verbs of construction in a centered horizontal strip.
 * When an active category defines `subItems` (e.g. Rectangular vs. Cylindrical
 * building volume, Straight vs. Curved walls), a floating sub-dock expands
 * smoothly above the primary dock.
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
    shape = "rounded",
    className,
    style,
  } = props;

  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  // Find the active item that has sub-items to expand
  const activeWithSubItems = items.find((item) => item.active && item.subItems && item.subItems.length > 0);

  const borderRadius = shape === "rounded" ? "9999px" : "0.5rem";
  const itemRadius = shape === "rounded" ? "9999px" : "0.375rem";

  return (
    <div
      role="toolbar"
      aria-label={ariaLabel}
      className={className}
      style={{
        position: "relative",
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "0.5rem",
        zIndex: 20,
        userSelect: "none",
        ...style,
      }}
    >
      {/* Expandable Sub-Item Pill Bar (appears smoothly above the primary dock) */}
      {activeWithSubItems && activeWithSubItems.subItems && (
        <div
          role="group"
          aria-label={`Variações de ${activeWithSubItems.label}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.25rem",
            padding: "0.25rem 0.4rem",
            borderRadius,
            background: "rgba(15, 23, 42, 0.9)",
            border: "1px solid rgba(255, 255, 255, 0.12)",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
            backdropFilter: "blur(14px)",
            animation: "actionDockSlideUp 0.18s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          {activeWithSubItems.subItems.map((subItem) => {
            const isSubActive = subItem.active === true;
            return (
              <button
                key={subItem.key}
                type="button"
                disabled={subItem.disabled}
                onClick={subItem.onClick}
                title={subItem.tooltip ?? subItem.label}
                aria-pressed={isSubActive}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.35rem",
                  padding: "0.3rem 0.6rem",
                  border: isSubActive ? "1px solid #72d69e" : "1px solid transparent",
                  borderRadius: itemRadius,
                  background: isSubActive ? "rgba(114, 214, 158, 0.16)" : "transparent",
                  color: isSubActive ? "#72d69e" : "#cbd5e1",
                  fontSize: "0.75rem",
                  fontWeight: isSubActive ? 600 : 500,
                  cursor: subItem.disabled ? "not-allowed" : "pointer",
                  opacity: subItem.disabled ? 0.4 : 1,
                  transition: "all 0.15s ease",
                }}
              >
                {subItem.icon && <span style={{ fontSize: "0.9rem", lineHeight: 1 }}>{subItem.icon}</span>}
                <span>{subItem.label}</span>
                {subItem.shortcut && (
                  <kbd
                    style={{
                      fontSize: "0.65rem",
                      padding: "0.1rem 0.3rem",
                      borderRadius: "0.25rem",
                      background: "rgba(255, 255, 255, 0.08)",
                      color: "#94a3b8",
                      fontFamily: "inherit",
                    }}
                  >
                    {subItem.shortcut}
                  </kbd>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Main Primary Dock */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.35rem",
          padding: "0.35rem 0.5rem",
          borderRadius,
          background: "rgba(15, 23, 42, 0.82)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          boxShadow: "0 12px 32px rgba(0, 0, 0, 0.45)",
          backdropFilter: "blur(14px)",
        }}
      >
        {/* Leading accessories (e.g. Undo/Redo or Navigation) */}
        {leadingAccessories && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
              {leadingAccessories}
            </div>
            <div
              style={{
                width: "1px",
                height: "1.5rem",
                background: "rgba(255, 255, 255, 0.1)",
                margin: "0 0.2rem",
              }}
            />
          </>
        )}

        {/* Primary Verbs */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
          {items.map((item) => {
            const isActive = item.active === true;
            const isHovered = hoveredKey === item.key;

            return (
              <button
                key={item.key}
                type="button"
                disabled={item.disabled}
                onClick={item.onClick}
                onMouseEnter={() => setHoveredKey(item.key)}
                onMouseLeave={() => setHoveredKey(null)}
                title={item.tooltip ?? item.label}
                aria-pressed={isActive}
                style={{
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.2rem",
                  minWidth: "3.4rem",
                  padding: "0.45rem 0.5rem",
                  border: isActive ? "1px solid #72d69e" : isHovered ? "1px solid rgba(255, 255, 255, 0.2)" : "1px solid transparent",
                  borderRadius: itemRadius,
                  background: isActive
                    ? "rgba(114, 214, 158, 0.14)"
                    : isHovered
                    ? "rgba(255, 255, 255, 0.06)"
                    : "transparent",
                  color: isActive ? "#72d69e" : isHovered ? "#f8fafc" : "#cbd5e1",
                  cursor: item.disabled ? "not-allowed" : "pointer",
                  opacity: item.disabled ? 0.35 : 1,
                  transition: "all 0.15s cubic-bezier(0.16, 1, 0.3, 1)",
                  transform: isActive || isHovered ? "translateY(-1px)" : "none",
                }}
              >
                <div style={{ fontSize: "1.2rem", lineHeight: 1 }}>{item.icon}</div>
                <span
                  style={{
                    fontSize: "0.68rem",
                    fontWeight: isActive ? 600 : 500,
                    letterSpacing: "0.01em",
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.label}
                </span>

                {item.shortcut && (
                  <span
                    style={{
                      position: "absolute",
                      top: "0.2rem",
                      right: "0.25rem",
                      fontSize: "0.55rem",
                      color: isActive ? "#72d69e" : "#64748b",
                      fontWeight: 600,
                    }}
                  >
                    {item.shortcut}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Trailing accessories (e.g. Grid Snap, Palette, Settings) */}
        {trailingAccessories && (
          <>
            <div
              style={{
                width: "1px",
                height: "1.5rem",
                background: "rgba(255, 255, 255, 0.1)",
                margin: "0 0.2rem",
              }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
              {trailingAccessories}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
