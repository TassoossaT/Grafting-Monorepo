import { useRef, useState } from "react";
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
  /** Whether any child sub-item of this item is active. */
  readonly childActive?: boolean;
  /** Whether this item is non-interactive. */
  readonly disabled?: boolean;
  /** Invoked when this item is clicked. */
  readonly onClick?: () => void;
  /** Optional sub-tools revealed above this button when it is active. */
  readonly subItems?: readonly ActionDockSubItem[];
}

/** Public props for the {@link ActionDock} bottom toolbar organism. */
export interface ActionDockProps {
  /** Accessible name for the toolbar region. */
  readonly ariaLabel?: string;
  /** Primary construction verbs / categories in display order. */
  readonly items: readonly ActionDockItem[];
  /**
   * Optional leading accessories rendered as floating icon buttons
   * (e.g. undo/redo, camera navigation).
   */
  readonly leadingAccessories?: ReactNode;
  /**
   * Optional trailing accessories rendered as floating icon buttons
   * (e.g. grid snap toggle, settings drawer toggle).
   */
  readonly trailingAccessories?: ReactNode;
  /** Optional caller-owned class name applied to the outer wrapper. */
  readonly className?: string;
  /** Optional inline style override for the outer wrapper. */
  readonly style?: CSSProperties;
}

/**
 * A floating bottom action dock inspired by Tiny Glade construction UI.
 *
 * Buttons are compact squares with a sketch/drawn aesthetic and a small
 * border-radius. Sub-tools expand upward directly above the parent button
 * (not centered). The parent button color changes when any child is active.
 * Each button is an independent floating element with no shared container.
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
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "flex-end",
        gap: "0.3rem",
        userSelect: "none",
        ...style,
      }}
    >
      {leadingAccessories && (
        <>
          <div style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
            {leadingAccessories}
          </div>
          <div style={{ width: "0.5rem" }} />
        </>
      )}

      {items.map((item) => (
        <PrimaryButton key={item.key} item={item} />
      ))}

      {trailingAccessories && (
        <>
          <div style={{ width: "0.5rem" }} />
          <div style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
            {trailingAccessories}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Shared constants ─────────────────────────────────────────────────────────

/** Tiny Glade-style: compact square with sketch feel, small radius */
const BTN_SIZE = "2.6rem";
const BTN_RADIUS = "0.45rem";

const BTN_IDLE: CSSProperties = {
  background: "rgba(18, 24, 38, 0.78)",
  border: "1.5px solid rgba(255,255,255,0.13)",
  color: "rgba(200,210,225,0.75)",
  boxShadow: "0 2px 10px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06)",
};

const BTN_HOVER: CSSProperties = {
  background: "rgba(34, 44, 64, 0.88)",
  border: "1.5px solid rgba(255,255,255,0.22)",
  color: "#e8f0fb",
  boxShadow: "0 4px 16px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.10)",
  transform: "translateY(-2px) scale(1.06)",
};

/** Self/direct active: tool is this item */
const BTN_ACTIVE: CSSProperties = {
  background: "rgba(90, 160, 240, 0.22)",
  border: "1.5px solid rgba(120, 180, 255, 0.60)",
  color: "#8ec8ff",
  boxShadow: "0 2px 14px rgba(100,160,255,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",
};

/** Child active: one of this item's sub-tools is the current tool */
const BTN_CHILD_ACTIVE: CSSProperties = {
  background: "rgba(60, 120, 200, 0.18)",
  border: "1.5px solid rgba(100, 160, 240, 0.45)",
  color: "#7ab8f5",
  boxShadow: "0 2px 10px rgba(80,130,220,0.22), inset 0 1px 0 rgba(255,255,255,0.06)",
};

const SUB_BTN_ACTIVE: CSSProperties = {
  background: "rgba(90, 160, 240, 0.28)",
  border: "1.5px solid rgba(120, 180, 255, 0.65)",
  color: "#a8d4ff",
  boxShadow: "0 2px 12px rgba(100,160,255,0.3)",
};

const TRANSITION = "background 0.12s ease, border-color 0.12s ease, color 0.12s ease, box-shadow 0.12s ease, transform 0.12s cubic-bezier(0.16,1,0.3,1)";

// ─── PrimaryButton ────────────────────────────────────────────────────────────

function PrimaryButton({ item }: { item: ActionDockItem }): ReactElement {
  const [hovered, setHovered] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const hasSubItems = (item.subItems?.length ?? 0) > 0;
  const isActive = item.active === true;
  const isChildActive = item.childActive === true;
  const showSub = hasSubItems && (isActive || isChildActive);

  let btnStyle: CSSProperties;
  if (isActive) btnStyle = BTN_ACTIVE;
  else if (isChildActive) btnStyle = BTN_CHILD_ACTIVE;
  else if (hovered) btnStyle = BTN_HOVER;
  else btnStyle = BTN_IDLE;

  return (
    <div
      style={{
        position: "relative",
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      {/* Sub-items — expand upward directly above this button */}
      {showSub && item.subItems && (
        <SubButtonRow subItems={item.subItems} />
      )}

      <button
        ref={btnRef}
        type="button"
        disabled={item.disabled}
        onClick={item.onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title={item.tooltip ?? item.label}
        aria-pressed={isActive || isChildActive}
        style={{
          ...BTN_IDLE,
          ...btnStyle,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.15rem",
          width: BTN_SIZE,
          height: BTN_SIZE,
          padding: "0.2rem",
          borderRadius: BTN_RADIUS,
          cursor: item.disabled ? "not-allowed" : "pointer",
          opacity: item.disabled ? 0.35 : 1,
          transition: TRANSITION,
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          position: "relative",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: "1.05rem", lineHeight: 1 }}>{item.icon}</span>
        <span
          style={{
            fontSize: "0.6rem",
            fontWeight: 600,
            letterSpacing: "0.03em",
            whiteSpace: "nowrap",
            lineHeight: 1,
          }}
        >
          {item.label}
        </span>
        {item.shortcut && (
          <span
            style={{
              position: "absolute",
              top: "0.15rem",
              right: "0.2rem",
              fontSize: "0.48rem",
              fontWeight: 700,
              color: isActive ? "#8ec8ff" : "rgba(255,255,255,0.25)",
            }}
          >
            {item.shortcut}
          </span>
        )}
      </button>
    </div>
  );
}

// ─── SubButtonRow ─────────────────────────────────────────────────────────────

function SubButtonRow({ subItems }: { subItems: readonly ActionDockSubItem[] }): ReactElement {
  return (
    <div
      role="group"
      aria-label="Variações de ferramenta"
      style={{
        position: "absolute",
        bottom: "calc(100% + 0.4rem)",
        left: "50%",
        transform: "translateX(-50%)",
        display: "inline-flex",
        flexDirection: "row",
        alignItems: "center",
        gap: "0.3rem",
        zIndex: 30,
        whiteSpace: "nowrap",
        animation: "actionDockSlideUp 0.16s cubic-bezier(0.16,1,0.3,1)",
      }}
    >
      {subItems.map((subItem) => (
        <SubButton key={subItem.key} subItem={subItem} />
      ))}
    </div>
  );
}

function SubButton({ subItem }: { subItem: ActionDockSubItem }): ReactElement {
  const [hovered, setHovered] = useState(false);
  const isActive = subItem.active === true;

  let btnStyle: CSSProperties;
  if (isActive) btnStyle = SUB_BTN_ACTIVE;
  else if (hovered) btnStyle = BTN_HOVER;
  else btnStyle = BTN_IDLE;

  return (
    <button
      type="button"
      disabled={subItem.disabled}
      onClick={subItem.onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={subItem.tooltip ?? subItem.label}
      aria-pressed={isActive}
      style={{
        ...BTN_IDLE,
        ...btnStyle,
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.15rem",
        width: BTN_SIZE,
        height: BTN_SIZE,
        padding: "0.2rem",
        borderRadius: BTN_RADIUS,
        cursor: subItem.disabled ? "not-allowed" : "pointer",
        opacity: subItem.disabled ? 0.35 : 1,
        transition: TRANSITION,
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        flexShrink: 0,
      }}
    >
      {subItem.icon && (
        <span style={{ fontSize: "1rem", lineHeight: 1 }}>{subItem.icon}</span>
      )}
      <span
        style={{
          fontSize: "0.58rem",
          fontWeight: 600,
          letterSpacing: "0.02em",
          whiteSpace: "nowrap",
          lineHeight: 1,
        }}
      >
        {subItem.label}
      </span>
      {subItem.shortcut && (
        <span
          style={{
            position: "absolute",
            top: "0.15rem",
            right: "0.2rem",
            fontSize: "0.48rem",
            color: isActive ? "#a8d4ff" : "rgba(255,255,255,0.3)",
            fontWeight: 700,
          }}
        >
          {subItem.shortcut}
        </span>
      )}
    </button>
  );
}
