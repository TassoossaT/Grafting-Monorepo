import { createElement } from "react";
import type { SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement>;

const commonProps = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

export function IconNavigate(props: IconProps) {
  return createElement("svg", { ...commonProps, ...props },
    createElement("path", { d: "m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z" }),
    createElement("path", { d: "m13 13 6 6" })
  );
}

export function IconMoveNode(props: IconProps) {
  return createElement("svg", { ...commonProps, ...props },
    createElement("polyline", { points: "5 9 2 12 5 15" }),
    createElement("polyline", { points: "9 5 12 2 15 5" }),
    createElement("polyline", { points: "15 19 12 22 9 19" }),
    createElement("polyline", { points: "19 9 22 12 19 15" }),
    createElement("line", { x1: 2, y1: 12, x2: 22, y2: 12 }),
    createElement("line", { x1: 12, y1: 2, x2: 12, y2: 22 })
  );
}

export function IconWall(props: IconProps) {
  return createElement("svg", { ...commonProps, ...props },
    createElement("rect", { x: 3, y: 3, width: 18, height: 18, rx: 2 }),
    createElement("line", { x1: 3, y1: 9, x2: 21, y2: 9 }),
    createElement("line", { x1: 3, y1: 15, x2: 21, y2: 15 }),
    createElement("line", { x1: 9, y1: 3, x2: 9, y2: 9 }),
    createElement("line", { x1: 15, y1: 3, x2: 15, y2: 9 }),
    createElement("line", { x1: 12, y1: 9, x2: 12, y2: 15 }),
    createElement("line", { x1: 6, y1: 15, x2: 6, y2: 21 }),
    createElement("line", { x1: 18, y1: 15, x2: 18, y2: 21 })
  );
}

export function IconTerrain(props: IconProps) {
  return createElement("svg", { ...commonProps, ...props },
    createElement("rect", { x: 3, y: 3, width: 18, height: 18, rx: 2 }),
    createElement("path", { d: "M3 12h18" }),
    createElement("path", { d: "M12 3v18" })
  );
}

export function IconCutaway(props: IconProps) {
  return createElement("svg", { ...commonProps, ...props },
    createElement("path", { d: "M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" }),
    createElement("circle", { cx: 12, cy: 12, r: 3 })
  );
}

export function IconUndo(props: IconProps) {
  return createElement("svg", { ...commonProps, ...props },
    createElement("path", { d: "M3 7v6h6" }),
    createElement("path", { d: "M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" })
  );
}

export function IconRedo(props: IconProps) {
  return createElement("svg", { ...commonProps, ...props },
    createElement("path", { d: "M21 7v6h-6" }),
    createElement("path", { d: "M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" })
  );
}

export function IconTrash(props: IconProps) {
  return createElement("svg", { ...commonProps, ...props },
    createElement("path", { d: "M3 6h18" }),
    createElement("path", { d: "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" }),
    createElement("path", { d: "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" })
  );
}

export function IconPalette(props: IconProps) {
  return createElement("svg", { ...commonProps, ...props },
    createElement("circle", { cx: 13.5, cy: 6.5, r: 0.5, fill: "currentColor" }),
    createElement("circle", { cx: 17.5, cy: 10.5, r: 0.5, fill: "currentColor" }),
    createElement("circle", { cx: 8.5, cy: 7.5, r: 0.5, fill: "currentColor" }),
    createElement("circle", { cx: 6.5, cy: 12.5, r: 0.5, fill: "currentColor" }),
    createElement("path", { d: "M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.92 0 1.7-.72 1.7-1.61 0-.43-.17-.83-.44-1.14-.27-.31-.44-.72-.44-1.17 0-.92.78-1.68 1.7-1.68h2.8c2.55 0 4.68-2.13 4.68-4.68 0-5.48-4.38-9.72-9.7-9.72z" })
  );
}

export function IconSparkles(props: IconProps) {
  return createElement("svg", { ...commonProps, ...props },
    createElement("path", { d: "m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z" })
  );
}

export function IconClose(props: IconProps) {
  return createElement("svg", { ...commonProps, ...props },
    createElement("line", { x1: 18, y1: 6, x2: 6, y2: 18 }),
    createElement("line", { x1: 6, y1: 6, x2: 18, y2: 18 })
  );
}
