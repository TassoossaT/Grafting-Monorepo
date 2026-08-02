/** Semantic statuses supported by Grafting UI components. */
export type UiStatus = "neutral" | "info" | "success" | "warning" | "error";

/** Geometric outline of a card surface. */
export type CardShape = "rectangle" | "pill" | "circle" | "hexagon";

/** Vendor-neutral lifecycle returned by a UI component mounted into an existing DOM host. */
export interface UiMountHandle<Props> {
  /** Re-renders the mounted component with complete next inputs. */
  update(props: Props): void;
  /** Unmounts the component and releases the owned UI root. */
  dispose(): void;
}
