import type { ReactElement } from "react";

import type { CardProps } from "../index.js";

const HEXAGON_CLIP_PATH = "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)";

export function CardView(props: CardProps): ReactElement {
  const usesAccentBoundary = props.accentColor !== undefined;
  const boundaryColor =
    props.selected === true && props.selectedColor !== undefined
      ? props.selectedColor
      : props.accentColor;
  const shape = props.shape ?? "rectangle";
  const borderRadius =
    shape === "circle" ? "50%" : shape === "pill" ? 999 : (props.borderRadius ?? 8);
  const clipPath = shape === "hexagon" ? HEXAGON_CLIP_PATH : undefined;

  return (
    <div
      aria-label={props.ariaLabel}
      className={props.className}
      data-selected={props.selected === undefined ? undefined : String(props.selected)}
      data-shape={shape}
      style={{
        background: props.backgroundColor ?? "#ffffff",
        border: `${props.borderWidth ?? 1}px solid ${
          usesAccentBoundary ? boundaryColor : "rgba(0, 0, 0, 0.08)"
        }`,
        borderRadius,
        boxShadow:
          props.glowColor === undefined
            ? undefined
            : `0 0 16px 4px ${props.glowColor}`,
        boxSizing: "border-box",
        clipPath,
        cursor: props.interactive ? "pointer" : undefined,
        height: props.fillContainer ? "100%" : undefined,
        minWidth: 0,
        overflow: "hidden",
        padding: props.padding ?? 12,
        width: "100%",
      }}
    >
      {props.children}
    </div>
  );
}
