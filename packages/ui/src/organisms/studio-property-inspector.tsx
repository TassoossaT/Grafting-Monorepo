import type { ReactElement, ReactNode } from "react";

/** Public inputs for Studio Property Inspector organism. */
export interface StudioPropertyInspectorProps {
  /**
   * Header title for the property inspector panel.
   * @example "Nó n_01 [X: 2.0, Y: 3.5]"
   */
  readonly title: string;
  /** Optional subtitle or status badge text. */
  readonly subtitle?: string;
  /** Optional floor level slicer element. */
  readonly floorSlicer?: ReactNode;
  /** Optional material swatch grid element. */
  readonly materialPalette?: ReactNode;
  /** Additional inspection cards or children. */
  readonly children?: ReactNode;
  /** Optional custom class name. */
  readonly className?: string;
}

/**
 * Studio Property Inspector organism combining node properties, floor height slicer, and materials.
 *
 * @layer organism
 * @status stable
 */
export function StudioPropertyInspector(props: StudioPropertyInspectorProps): ReactElement {
  const {
    title,
    subtitle,
    floorSlicer,
    materialPalette,
    children,
    className = "",
  } = props;

  return (
    <aside className={`gm-property-inspector ${className}`}>
      <div className="gm-inspector-header">
        <h3 className="gm-inspector-title">{title}</h3>
        {subtitle ? <span className="gm-inspector-subtitle">{subtitle}</span> : null}
      </div>
      <div className="gm-inspector-body">
        {floorSlicer ? <div className="gm-inspector-section">{floorSlicer}</div> : null}
        {materialPalette ? <div className="gm-inspector-section">{materialPalette}</div> : null}
        {children}
      </div>
    </aside>
  );
}
