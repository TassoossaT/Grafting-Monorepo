import { createElement, type ReactNode } from "react";

export interface RadialMenuItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly action: () => void;
  readonly color?: string;
}

export interface RadialMenuProps {
  readonly position: { x: number; y: number } | null;
  readonly items: readonly RadialMenuItem[];
  readonly onClose: () => void;
  readonly title?: string;
}

export function RadialMenu({ position, items, onClose, title }: RadialMenuProps) {
  if (position === null || items.length === 0) return null;

  const radius = 64;

  return createElement("div", { className: "gm-radial-overlay", onClick: onClose },
    createElement("div", {
      className: "gm-radial-container",
      style: { left: `${position.x}px`, top: `${position.y}px` },
      onClick: (e) => e.stopPropagation(),
    },
      title ? createElement("div", { className: "gm-radial-center-title" }, title) : null,
      ...items.map((item, index) => {
        const angle = (index / items.length) * 2 * Math.PI - Math.PI / 2;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;

        return createElement("button", {
          key: item.id,
          type: "button",
          className: "gm-radial-item",
          style: {
            transform: `translate(${x}px, ${y}px)`,
            borderColor: item.color,
          },
          onClick: () => {
            item.action();
            onClose();
          },
          title: item.label,
        }, item.icon ?? createElement("span", { className: "gm-radial-item-label" }, item.label));
      })
    )
  );
}
