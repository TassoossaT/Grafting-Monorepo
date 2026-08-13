import type { ReactElement, ReactNode } from "react";

/** Menu item entry for a circular radial context menu. */
export interface RadialMenuItem {
  /**
   * Unique menu item identifier.
   * @example "move"
   */
  readonly id: string;
  /**
   * Display label for the menu item.
   * @example "Mover Nó"
   */
  readonly label: string;
  /** Optional icon element. */
  readonly icon?: ReactNode;
  /** Invoked when this item is selected. */
  readonly action: () => void;
  /** Optional visual accent color for the border. */
  readonly accentColor?: string;
}

/** Public inputs for the floating 3D Radial Context Menu. */
export interface RadialContextMenuProps {
  /**
   * Target screen position (x, y) where the radial menu opens. Pass null when hidden.
   * @example { x: 300, y: 400 }
   */
  readonly position: { readonly x: number; readonly y: number } | null;
  /**
   * Items rendered around the ring.
   * @example [{ id: "move", label: "Mover Nó", action: () => {} }]
   */
  readonly items: readonly RadialMenuItem[];
  /**
   * Invoked when clicking outside or canceling the menu.
   * @example () => {}
   */
  readonly onClose: () => void;
  /** Optional title shown at the center pivot. */
  readonly title?: string;
}

/**
  * Floating circular 2D/3D Radial Context Menu for rapid map actions.
  *
  * @layer molecule
  * @status stable
  */
export function RadialContextMenu(props: RadialContextMenuProps): ReactElement | null {
  const { position, items, onClose, title } = props;
  if (!position || items.length === 0) return null;

  const radius = 68;

  return (
    <div
      aria-label={title ?? "Menu Contextual Radial"}
      className="gm-radial-overlay"
      onClick={onClose}
      role="dialog"
    >
      <div
        className="gm-radial-container"
        onClick={(e) => e.stopPropagation()}
        style={{ left: `${position.x}px`, top: `${position.y}px` }}
      >
        {title ? <div className="gm-radial-center-title">{title}</div> : null}
        {items.map((item, index) => {
          const angle = (index / items.length) * 2 * Math.PI - Math.PI / 2;
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius;

          return (
            <button
              key={item.id}
              className="gm-radial-item"
              onClick={() => {
                item.action();
                onClose();
              }}
              style={{
                transform: `translate(${x}px, ${y}px)`,
                borderColor: item.accentColor,
              }}
              title={item.label}
              type="button"
            >
              {item.icon ?? <span className="gm-radial-item-label">{item.label}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
