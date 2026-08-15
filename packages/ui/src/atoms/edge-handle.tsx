import { useRef } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactElement } from "react";

/** Public inputs for a small handle fused to one edge of a panel, toggling it open/closed. */
export interface EdgeHandleProps {
  /** Whether the panel this handle belongs to is currently open. */
  readonly open: boolean;
  /** Invoked on a plain tap/click (movement below the drag threshold) or a keyboard activation. Never called for a real drag -- use `onDragEnd` for that. */
  readonly onClick: () => void;
  /**
   * Which edge of the panel the handle protrudes from -- `"right"` bulges
   * rightward (for a panel anchored to the screen's left edge), `"left"`
   * bulges leftward (for a panel anchored to the right edge).
   */
  readonly edge: "left" | "right";
  /** Tooltip and accessible name. */
  readonly title: string;
  /** Optional caller-owned class name for layout composition. */
  readonly className?: string;
  /** Optional caller-owned inline style, e.g. to place this handle at a specific position. */
  readonly style?: CSSProperties;
  /**
   * Optional drag reporting. Once a press moves past a small threshold,
   * `onDrag` fires on every subsequent move with the horizontal offset (in
   * pixels, signed) from where the press started, and `onDragEnd` fires
   * once on release with the final offset -- a caller (e.g. `SlidingPanel`)
   * uses these to let the panel itself track the pointer 1:1 while
   * dragging. A press that never crosses the threshold is a plain tap and
   * only calls `onClick`; provide both callbacks together or neither.
   */
  readonly onDrag?: (deltaX: number) => void;
  /** Fires once on release, only after a real drag (see `onDrag`). */
  readonly onDragEnd?: (deltaX: number) => void;
}

/** The handle's own footprint (`width`, half of `height`) -- exported so a caller composing a panel around this handle (e.g. `SlidingPanel`) can position it flush against the panel's edge without duplicating the magic number. */
export const EDGE_HANDLE_SIZE = 28;

const SIZE = EDGE_HANDLE_SIZE;

/** Movement (px) a press must cross before it counts as a drag instead of a tap. */
const DRAG_THRESHOLD = 6;

/**
 * A half-round tab fused to one edge of a panel -- rounded on the side
 * facing away from the panel, flat on the side touching it, so it reads as
 * grown out of the panel rather than a separate floating control. Toggles
 * the panel open/closed on tap; optionally reports raw drag deltas so a
 * caller can let the panel itself be pulled open/closed, not just clicked.
 * No library ships this shape (confirmed by research before building it --
 * shadcn/ui's `SidebarRail` is the closest published pattern, but it is a
 * full-height drag rail on a Tailwind/Radix stack this project does not
 * use, not this shape). Hand-built CSS is the right size of solution here:
 * one small shape, no dependency.
 *
 * @layer atom
 * @status stable
 */
export function EdgeHandle(props: EdgeHandleProps): ReactElement {
  // Rounded on the side facing away from the panel (where the handle bulges
  // out into open space), flat on the side touching the panel (where the
  // two should read as one continuous surface).
  const roundedRight = props.edge === "right";

  // A ref, not state: this only needs to survive across the pointer events
  // of a single press/drag, and must never trigger a re-render on its own.
  const dragRef = useRef<{ readonly startX: number; dragging: boolean; suppressClick: boolean }>({
    startX: 0,
    dragging: false,
    suppressClick: false,
  });

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (props.onDrag === undefined || props.onDragEnd === undefined) return;
    dragRef.current = { startX: event.clientX, dragging: false, suppressClick: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (props.onDrag === undefined || props.onDragEnd === undefined) return;
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const deltaX = event.clientX - dragRef.current.startX;
    if (!dragRef.current.dragging && Math.abs(deltaX) < DRAG_THRESHOLD) return;
    dragRef.current.dragging = true;
    props.onDrag(deltaX);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (props.onDrag === undefined || props.onDragEnd === undefined) return;
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (dragRef.current.dragging) {
      const deltaX = event.clientX - dragRef.current.startX;
      dragRef.current.suppressClick = true;
      props.onDragEnd(deltaX);
    }
    dragRef.current.dragging = false;
  };

  const handleClick = (): void => {
    // A real drag still ends with a native `click` event on mouse (unlike
    // touch, which suppresses it) -- this flag swallows exactly that one
    // synthetic click so a drag never also toggles via `onClick`.
    if (dragRef.current.suppressClick) {
      dragRef.current.suppressClick = false;
      return;
    }
    props.onClick();
  };

  return (
    <button
      type="button"
      className={props.className}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      title={props.title}
      aria-expanded={props.open}
      style={{
        appearance: "none",
        border: "none",
        cursor: "pointer",
        touchAction: "none",
        width: SIZE,
        height: SIZE * 2,
        borderTopLeftRadius: roundedRight ? 0 : SIZE,
        borderBottomLeftRadius: roundedRight ? 0 : SIZE,
        borderTopRightRadius: roundedRight ? SIZE : 0,
        borderBottomRightRadius: roundedRight ? SIZE : 0,
        background: "#1e293b",
        color: "#94a3b8",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "0.7rem",
        ...props.style,
      }}
    >
      {props.open ? (roundedRight ? "‹" : "›") : roundedRight ? "›" : "‹"}
    </button>
  );
}
