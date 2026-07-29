import type { ReactElement } from "react";
import ReactGridLayoutLegacy, { WidthProvider } from "react-grid-layout/legacy";
import type { Layout, LayoutItem } from "react-grid-layout/legacy";

import type { GridLayoutProps, GridPanelPlacement } from "../index.js";

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

export function GridLayoutView(props: GridLayoutProps): ReactElement {
  const gap = props.gap ?? 12;

  return (
    <div aria-label={props.ariaLabel} className={props.className} role="region">
      <ResizableDraggableGrid
        cols={props.columns ?? 12}
        isDraggable={props.draggable ?? true}
        isResizable={props.resizable ?? true}
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
