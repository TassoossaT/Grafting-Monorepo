import type { ReactElement, ReactNode } from "react";

/** Option item for Category Dock pill buttons. */
export interface CategoryDockOption {
  /**
   * Unique category identifier.
   * @example "walls"
   */
  readonly id: string;
  /**
   * Category display name.
   * @example "Paredes"
   */
  readonly label: string;
  /** Optional icon node. */
  readonly icon?: ReactNode;
}

/** Default category options for the studio bottom dock. */
export const DEFAULT_STUDIO_CATEGORIES: readonly CategoryDockOption[] = [
  { id: "walls", label: "PAREDES" },
  { id: "floors", label: "PISOS" },
  { id: "doors", label: "PORTAS" },
  { id: "furniture", label: "MÓVEIS" },
  { id: "lighting", label: "ILUMINAÇÃO" },
];

/** Public inputs for Category Dock organism. */
export interface CategoryDockProps {
  /**
   * Currently active category ID.
   * @example "walls"
   */
  readonly activeCategoryId: string;
  /** Optional array of available categories. */
  readonly categories?: readonly CategoryDockOption[];
  /**
   * Callback when a category pill is selected.
   * @example (id) => console.log(id)
   */
  readonly onSelectCategory: (id: string) => void;
  /** Optional sub-palette content rendered floating above the dock. */
  readonly subPalette?: ReactNode;
  /** Optional custom class name. */
  readonly className?: string;
}

/**
 * Bottom Category Dock organism for Level Design Studio (Concept B).
 *
 * @layer organism
 * @status stable
 */
export function CategoryDock(props: CategoryDockProps): ReactElement {
  const {
    activeCategoryId,
    categories = DEFAULT_STUDIO_CATEGORIES,
    onSelectCategory,
    subPalette,
    className = "",
  } = props;

  return (
    <div className={`gm-category-dock-wrapper ${className}`}>
      {subPalette ? <div className="gm-floating-subpalette">{subPalette}</div> : null}
      <div className="gm-category-dock-bar">
        {categories.map((cat) => {
          const isSelected = cat.id === activeCategoryId;
          return (
            <button
              key={cat.id}
              className={`gm-category-pill ${isSelected ? "gm-category-pill--active" : ""}`}
              onClick={() => onSelectCategory(cat.id)}
              type="button"
            >
              {cat.icon ? <span className="gm-category-pill-icon">{cat.icon}</span> : null}
              <span>{cat.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
