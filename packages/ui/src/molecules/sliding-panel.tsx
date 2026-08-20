import { useState } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";

import { EDGE_HANDLE_SIZE, EdgeHandle } from "../atoms/edge-handle.js";

/** Public inputs for a panel anchored to one screen edge that slides fully off-screen when closed. */
export interface SlidingPanelProps {
  /**
   * Whether the panel is currently open.
   * @example true
   */
  readonly open: boolean;
  /**
   * Invoked with the panel's next open state, from a tap or a drag past the midpoint.
   * @example () => {}
   */
  readonly onOpenChange: (open: boolean) => void;
  /**
   * Which screen edge the panel is anchored to.
   * @example "left"
   */
  readonly edge: "left" | "right";
  /**
   * Panel width in pixels.
   * @example 320
   */
  readonly width: number;
  /**
   * The panel's own content.
   * @example <div>Panel content</div>
   */
  readonly children: ReactNode;
  /** Stacking order for the panel's own fixed container. @default 20 */
  readonly zIndex?: number;
  /** Caller-owned class name for the panel's own container (use this for background, shadows, borders). */
  readonly className?: string;
  /** Caller-owned inline style, merged onto the panel's own container. */
  readonly style?: CSSProperties;
  /** Tooltip/Aria label for the handle when the panel is open. @default "Fechar" */
  readonly handleOpenLabel?: string;
  /** Tooltip/Aria label for the handle when the panel is closed. @default "Abrir" */
  readonly handleCloseLabel?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * A generic panel fixed to one edge of the screen that slides fully off-screen when
 * closed and back into view when open, with an {@link EdgeHandle} fused to
 * its edge as the drag/toggle control.
 *
 * @layer molecule
 * @status stable
 */
export function SlidingPanel(props: SlidingPanelProps): ReactElement {
  const anchorSide = props.edge;
  const handleEdge = anchorSide === "right" ? "left" : "right";

  const closedTranslatePx = anchorSide === "right" ? props.width : -props.width;
  const minTranslatePx = Math.min(0, closedTranslatePx);
  const maxTranslatePx = Math.max(0, closedTranslatePx);

  const [dragDeltaPx, setDragDeltaPx] = useState<number | null>(null);

  const baseTranslatePx = props.open ? 0 : closedTranslatePx;
  const translatePx =
    dragDeltaPx === null ? baseTranslatePx : clamp(baseTranslatePx + dragDeltaPx, minTranslatePx, maxTranslatePx);

  const handleDragEnd = (deltaPx: number): void => {
    const finalPx = clamp(baseTranslatePx + deltaPx, minTranslatePx, maxTranslatePx);
    const midpoint = closedTranslatePx / 2;
    const openedByDrag = anchorSide === "right" ? finalPx < midpoint : finalPx > midpoint;
    setDragDeltaPx(null);
    if (openedByDrag !== props.open) props.onOpenChange(openedByDrag);
  };

  return (
    <div
      className={props.className}
      style={{
        position: "fixed",
        top: 0,
        bottom: 0,
        [anchorSide]: 0,
        width: props.width,
        zIndex: props.zIndex ?? 20,
        transform: `translateX(${translatePx}px)`,
        transition: dragDeltaPx === null ? "transform 0.2s ease" : "none",
        display: "flex",
        flexDirection: "column",
        overflow: "visible",
        ...props.style,
      }}
    >
      <EdgeHandle
        open={props.open}
        onClick={() => props.onOpenChange(!props.open)}
        onDrag={(deltaPx) => setDragDeltaPx(deltaPx)}
        onDragEnd={handleDragEnd}
        edge={handleEdge}
        title={props.open ? (props.handleOpenLabel ?? "Fechar") : (props.handleCloseLabel ?? "Abrir")}
        style={{
          position: "absolute",
          [handleEdge]: -EDGE_HANDLE_SIZE,
          top: "50%",
          transform: "translateY(-50%)",
        }}
      />

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        {props.children}
      </div>
    </div>
  );
}