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
  /** Accessible name for the toolbar region. @default "Barra de ferramentas de construcao" */
  readonly ariaLabel?: string;
  /** Primary construction verbs / categories in display order. */
  readonly items: readonly ActionDockItem[];
  /**
   * Optional leading accessories rendered as individual floating pills
   * (e.g. undo/redo, camera navigation).
   */
  readonly leadingAccessories?: ReactNode;
  /**
   * Optional trailing accessories rendered as individual floating pills
   * (e.g. grid snap toggle, settings drawer toggle).
   */
  readonly trailingAccessories?: ReactNode;
  /** Optional caller-owned class name applied to the outer wrapper. */
  readonly className?: string;
  /** Optional inline style override for the outer wrapper. */
  readonly style?: CSSProperties;
}

const PILL_BASE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "9999px",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  background: "rgba(12, 18, 32, 0.72)",
  border: "1px solid rgba(255, 255, 255, 0.10)",
  boxShadow: "0 4px 20px rgba(0, 0, 0, 0.38)",
  transition: "all 0.15s cubic-bezier(0.16, 1, 0.3, 1)",
  cursor: "pointer",
  userSelect: "none",
};

const PILL_ACTIVE: CSSProperties = {
  background: "rgba(114, 214, 158, 0.16)",
  border: "1px solid rgba(114, 214, 158, 0.55)",
  color: "#72d69e",
};

const PILL_HOVER: CSSProperties = {
  background: "rgba(255, 255, 255, 0.09)",
  border: "1px solid rgba(255, 255, 255, 0.18)",
  color: "#f8fafc",
  transform: "translateY(-2px)",
  boxShadow: "0 8px 28px rgba(0, 0, 0, 0.48)",
};

/**
 * A floating bottom action dock inspired by Tiny Glade construction UI.
 *
 * Each primary verb is an independent, floating pill with no shared background
 * container. Pills hover directly above the canvas with a soft glassmorphic
 * treatment per-pill. When an active category defines subItems, a compact
 * sub-pill row expands smoothly above that item.
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

  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const activeWithSubItems = items.find(
    (item) => item.active && item.subItems && item.subItems.length > 0,
  );

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
      {activeWithSubItems?.subItems && (
        <SubPillRow
          groupLabel={activeWithSubItems.label}
          subItems={activeWithSubItems.subItems}
        />
      )}
      <div
        style={{
          display: "inline-flex",
          alignItems: "flex-end",
          gap: "0.45rem",
        }}
      >
        {leadingAccessories && (
          <>
            <div style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
              {leadingAccessories}
            </div>
            <div style={{ width: "0.35rem" }} />
          </>
        )}
        {items.map((item) => {
          const isActive = item.active === true;
          const isHovered = hoveredKey === item.key;
          return (
            <PrimaryPill
              key={item.key}
              item={item}
              isActive={isActive}
              isHovered={isHovered}
              onMouseEnter={() => setHoveredKey(item.key)}
              onMouseLeave={() => setHoveredKey(null)}
            />
          );
        })}
        {trailingAccessories && (
          <>
            <div style={{ width: "0.35rem" }} />
            <div style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
              {trailingAccessories}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

interface PrimaryPillProps {
  item: ActionDockItem;
  isActive: boolean;
  isHovered: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

function PrimaryPill({
  item,
  isActive,
  isHovered,
  onMouseEnter,
  onMouseLeave,
}: PrimaryPillProps): ReactElement {
  const dynamicStyle: CSSProperties = isActive
    ? PILL_ACTIVE
    : isHovered
      ? PILL_HOVER
      : { color: "#b0bdcc" };

  return (
    <button
      type="button"
      disabled={item.disabled}
      onClick={item.onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      title={item.tooltip ?? item.label}
      aria-pressed={isActive}
      style={{
        ...PILL_BASE,
        ...dynamicStyle,
        position: "relative",
        flexDirection: "column",
        gap: "0.18rem",
        padding: "0.5rem 0.7rem",
        minWidth: "3.2rem",
        opacity: item.disabled ? 0.35 : 1,
        cursor: item.disabled ? "not-allowed" : "pointer",
        boxShadow: isActive
          ? "0 4px 24px rgba(114, 214, 158, 0.22), 0 2px 8px rgba(0,0,0,0.3)"
          : isHovered
            ? "0 8px 28px rgba(0, 0, 0, 0.48)"
            : "0 4px 20px rgba(0, 0, 0, 0.38)",
      }}
    >
      <span style={{ fontSize: "1.15rem", lineHeight: 1 }}>{item.icon}</span>
      <span
        style={{
          fontSize: "0.65rem",
          fontWeight: isActive ? 600 : 500,
          letterSpacing: "0.02em",
          whiteSpace: "nowrap",
        }}
      >
        {item.label}
      </span>
      {item.shortcut && (
        <span
          style={{
            position: "absolute",
            top: "0.18rem",
            right: "0.22rem",
            fontSize: "0.5rem",
            fontWeight: 700,
            color: isActive ? "#72d69e" : "rgba(255,255,255,0.28)",
            letterSpacing: "0.01em",
          }}
        >
          {item.shortcut}
        </span>
      )}
    </button>
  );
}

interface SubPillRowProps {
  groupLabel: string;
  subItems: readonly ActionDockSubItem[];
}

function SubPillRow({ groupLabel, subItems }: SubPillRowProps): ReactElement {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  return (
    <div
      role="group"
      aria-label={`Variações de ${groupLabel}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.3rem",
        animation: "actionDockSlideUp 0.18s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      {subItems.map((subItem) => {
        const isSubActive = subItem.active === true;
        const isSubHovered = hoveredKey === subItem.key;
        const dynamicStyle: CSSProperties = isSubActive
          ? PILL_ACTIVE
          : isSubHovered
            ? PILL_HOVER
            : { color: "#9aacbe" };

        return (
          <button
            key={subItem.key}
            type="button"
            disabled={subItem.disabled}
            onClick={subItem.onClick}
            onMouseEnter={() => setHoveredKey(subItem.key)}
            onMouseLeave={() => setHoveredKey(null)}
            title={subItem.tooltip ?? subItem.label}
            aria-pressed={isSubActive}
            style={{
              ...PILL_BASE,
              ...dynamicStyle,
              flexDirection: "row",
              gap: "0.3rem",
              padding: "0.3rem 0.6rem",
              fontSize: "0.72rem",
              fontWeight: isSubActive ? 600 : 500,
              opacity: subItem.disabled ? 0.35 : 1,
              cursor: subItem.disabled ? "not-allowed" : "pointer",
              boxShadow: isSubActive
                ? "0 4px 20px rgba(114, 214, 158, 0.2), 0 2px 8px rgba(0,0,0,0.3)"
                : "0 4px 16px rgba(0, 0, 0, 0.32)",
            }}
          >
            {subItem.icon && (
              <span style={{ fontSize: "0.85rem", lineHeight: 1 }}>{subItem.icon}</span>
            )}
            <span>{subItem.label}</span>
            {subItem.shortcut && (
              <kbd
                style={{
                  fontSize: "0.6rem",
                  padding: "0.08rem 0.28rem",
                  borderRadius: "0.25rem",
                  background: "rgba(255, 255, 255, 0.08)",
                  color: "rgba(255,255,255,0.35)",
                  fontFamily: "inherit",
                  border: "none",
                }}
              >
                {subItem.shortcut}
              </kbd>
            )}
          </button>
        );
      })}
    </div>
  );
}
