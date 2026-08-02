import type { ReactElement, ReactNode } from "react";
import ReactGridLayoutLegacy, { WidthProvider } from "react-grid-layout/legacy";
import type { Layout, LayoutItem } from "react-grid-layout/legacy";

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

const ResizableDraggableGrid = WidthProvider(ReactGridLayoutLegacy);

const toLayoutItem = (placement: GridPanelPlacement): LayoutItem => ({
  i: placement.id,
  x: placement.x,
  y: placement.y,
  w: placement.width,
  h: placement.height,
  minW: placement.minWidth,
  minH: placement.minHeight,
  maxW: placement.maxWidth,
  maxH: placement.maxHeight,
  static: placement.locked,
});

const toPlacement = (item: LayoutItem): GridPanelPlacement =>
  Object.freeze({
    id: item.i,
    x: item.x,
    y: item.y,
    width: item.w,
    height: item.h,
    ...(item.minW === undefined ? {} : { minWidth: item.minW }),
    ...(item.minH === undefined ? {} : { minHeight: item.minH }),
    ...(item.maxW === undefined ? {} : { maxWidth: item.maxW }),
    ...(item.maxH === undefined ? {} : { maxHeight: item.maxH }),
    ...(item.static === undefined ? {} : { locked: item.static }),
  });

const toLayout = (layout: Layout): readonly GridPanelPlacement[] => layout.map(toPlacement);

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
export function GridLayout(props: GridLayoutProps): ReactElement {
  const gap = props.gap ?? 12;

  return (
    <div aria-label={props.ariaLabel} className={props.className} role="region">
      <ResizableDraggableGrid
        cols={props.columns ?? 12}
        isDraggable={props.draggable}
        isResizable={props.resizable}
        layout={props.panels.map((panel) => toLayoutItem(panel.placement))}
        margin={[gap, gap]}
        onLayoutChange={(layout: Layout) => props.onPlacementsChange?.(toLayout(layout))}
        rowHeight={props.rowHeight ?? 32}
      >
        {props.panels.map((panel) => (
          <div key={panel.placement.id}>{panel.content}</div>
        ))}
      </ResizableDraggableGrid>
    </div>
  );
}
