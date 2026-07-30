import type { ReactElement, ReactNode } from "react";

import { ButtonView } from "./atoms/button.js";
import { CardView } from "./atoms/card.js";
import { GridLayoutView } from "./atoms/grid-layout.js";
import { StatusBadgeView } from "./atoms/status-badge.js";
import { TextView } from "./atoms/text.js";
import { EntitySummaryView } from "./molecules/entity-summary.js";
import { DataTableView } from "./atoms/data-table.js";
import { mountReactView } from "./hosts/mount-react-view.js";

/** Semantic statuses supported by Grafting UI components. */
export type UiStatus = "neutral" | "info" | "success" | "warning" | "error";

/** Semantic text tones independent of the current visual implementation. */
export type TextTone = "default" | "muted" | "accent" | "danger";

/** Public inputs for the smallest reusable text presentation primitive. */
export interface TextProps {
  /** Text content rendered by the component. */
  readonly content: string;
  /** Optional semantic color treatment. */
  readonly tone?: TextTone;
  /** Whether the text uses the emphasized weight. */
  readonly strong?: boolean;
  /** Whether overflowing single-line content is truncated with an accessible tooltip. */
  readonly truncate?: boolean;
  /** Optional tooltip text used when truncation is enabled. */
  readonly tooltip?: string;
  /** Optional maximum width in CSS pixels. */
  readonly maxWidth?: number;
  /** Optional caller-owned class name for layout composition. */
  readonly className?: string;
}

/** Public inputs for a compact semantic status indicator. */
export interface StatusBadgeProps {
  /** Semantic state to present. */
  readonly status: UiStatus;
  /** Human-readable status label. */
  readonly label: string;
  /** Optional caller-owned class name for layout composition. */
  readonly className?: string;
}

/** Geometric outline of a card surface. */
export type CardShape = "rectangle" | "pill" | "circle" | "hexagon";

/** Public inputs for a compact, clickable action. */
export interface ButtonProps {
  /** Human-readable button label. */
  readonly label: string;
  /** Invoked when the button is activated. */
  readonly onClick?: () => void;
  /** Optional semantic emphasis. */
  readonly tone?: "default" | "accent";
  /** Optional caller-owned class name for layout composition. */
  readonly className?: string;
}

/** Public inputs for the smallest reusable bounded surface: a generic card. */
export interface CardProps {
  /** Geometric outline of the card; defaults to a rounded rectangle. */
  readonly shape?: CardShape;
  /** Caller-owned content rendered inside the card. */
  readonly children: ReactNode;
  /** Optional accessible name for the card. */
  readonly ariaLabel?: string;
  /** Optional accent used for the card boundary. */
  readonly accentColor?: string;
  /** Optional background color for the card surface. */
  readonly backgroundColor?: string;
  /** Whether the card occupies the complete width and height of its container. */
  readonly fillContainer?: boolean;
  /** Whether the card should communicate pointer interaction. */
  readonly interactive?: boolean;
  /** Whether the card displays its selected treatment. */
  readonly selected?: boolean;
  /** Optional boundary color used when the card is selected. */
  readonly selectedColor?: string;
  /** Optional boundary width in CSS pixels. */
  readonly borderWidth?: number;
  /** Optional rounded-corner radius in CSS pixels. */
  readonly borderRadius?: number;
  /** Optional padding in CSS pixels. */
  readonly padding?: number;
  /** Optional glow color rendered as an outer shadow, e.g. to signal live status. */
  readonly glowColor?: string;
  /** Optional caller-owned class name for layout composition. */
  readonly className?: string;
}

/** Public inputs for a reusable entity summary shown in canvases, tables, or inspectors. */
export interface EntitySummaryProps {
  /** Primary human-readable entity name. */
  readonly title: string;
  /** Optional secondary description. */
  readonly description?: string;
  /** Optional semantic status. */
  readonly status?: UiStatus;
  /** Human-readable label paired with status. */
  readonly statusLabel?: string;
  /** Optional visual placed before the textual identity. */
  readonly leading?: ReactNode;
  /** Optional actions placed after the textual identity. */
  readonly actions?: ReactNode;
  /** Optional accessible name for the summary container. */
  readonly ariaLabel?: string;
  /** Optional caller-owned class name for layout composition. */
  readonly className?: string;
  /** Optional accent used for the complete card boundary. */
  readonly accentColor?: string;
  /** Optional background color for the complete card surface. */
  readonly backgroundColor?: string;
  /** Whether the card occupies the complete width and height of its container. */
  readonly fillContainer?: boolean;
  /** Whether the card should communicate pointer interaction. */
  readonly interactive?: boolean;
  /** Whether the card displays its selected treatment. */
  readonly selected?: boolean;
  /** Optional boundary color used when the component is selected. */
  readonly selectedColor?: string;
  /** Optional boundary width in CSS pixels. */
  readonly borderWidth?: number;
  /** Optional rounded-corner radius in CSS pixels. */
  readonly borderRadius?: number;
  /** Optional body padding in CSS pixels. */
  readonly bodyPadding?: number;
  /** Optional gap between the component's content regions. */
  readonly contentGap?: number;
  /** Optional short caller-owned labels rendered as compact badges below the identity. */
  readonly tags?: readonly string[];
  /** Optional glow color rendered as an outer shadow, e.g. to signal live status. */
  readonly glowColor?: string;
  /** Geometric outline of the card; defaults to a rounded rectangle. */
  readonly shape?: CardShape;
  /** Optional label for a compact action button rendered in the card. */
  readonly actionLabel?: string;
  /** Invoked when the action button is activated. */
  readonly onAction?: () => void;
}

/** Vendor-neutral lifecycle returned by a UI component mounted into an existing DOM host. */
export interface UiMountHandle<Props> {
  /** Re-renders the mounted component with complete next inputs. */
  update(props: Props): void;
  /** Unmounts the component and releases the owned UI root. */
  dispose(): void;
}

/** Stable key used to identify a table row independently of its position. */
export type DataTableRowKey = string | number;

/** Immutable context supplied to a custom table-cell renderer. */
export interface DataTableCellContext<Row extends object> {
  /** Complete caller-owned row. */
  readonly row: Row;
  /** Value projected by the column. */
  readonly value: unknown;
  /** Current presentation index of the row. */
  readonly rowIndex: number;
}

/** Vendor-neutral description of one data-table column. */
export interface DataTableColumn<Row extends object> {
  /** Stable column identifier. */
  readonly id: string;
  /** Human-readable column heading. */
  readonly header: string;
  /** Projects the value represented by this column. */
  readonly value: (row: Row) => unknown;
  /** Optional custom React presentation for the projected cell value. */
  readonly renderCell?: (context: DataTableCellContext<Row>) => ReactNode;
  /** Optional width in CSS pixels. */
  readonly width?: number;
  /** Optional horizontal alignment. */
  readonly align?: "start" | "center" | "end";
}

/** Controlled row-selection contract for a data table. */
export interface DataTableSelection {
  /** Currently selected stable row keys. */
  readonly selectedKeys: readonly DataTableRowKey[];
  /** Receives the complete next selection. */
  readonly onChange: (keys: readonly DataTableRowKey[]) => void;
}

/** Minimal pagination contract independent of the current table engine. */
export interface DataTablePagination {
  /** Number of rows rendered on each page. */
  readonly pageSize: number;
  /** Whether controls disappear when every row fits on one page. */
  readonly hideWhenSinglePage?: boolean;
}

/** Public inputs for the reusable Grafting data table. */
export interface DataTableProps<Row extends object> {
  /** Immutable caller-owned rows. */
  readonly rows: readonly Row[];
  /** Immutable vendor-neutral column definitions. */
  readonly columns: readonly DataTableColumn<Row>[];
  /** Returns the stable key for a row. */
  readonly rowKey: (row: Row) => DataTableRowKey;
  /** Accessible table name. */
  readonly ariaLabel: string;
  /** Optional controlled selection. */
  readonly selection?: DataTableSelection;
  /** Optional pagination, or false to render all rows. */
  readonly pagination?: DataTablePagination | false;
  /** Optional table density. */
  readonly density?: "compact" | "regular";
  /** Optional text shown when there are no rows. */
  readonly emptyMessage?: string;
  /** Whether a loading treatment is displayed. */
  readonly loading?: boolean;
  /** Optional caller-owned class name for layout composition. */
  readonly className?: string;
}

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
  /** Immutable caller-owned panels and their current placements. */
  readonly panels: readonly GridPanel[];
  /** Accessible name for the grid region. */
  readonly ariaLabel: string;
  /** Number of columns the grid is divided into. */
  readonly columns?: number;
  /** Height of one grid row in CSS pixels. */
  readonly rowHeight?: number;
  /** Gap between panels in CSS pixels, applied both horizontally and vertically. */
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

/** Renders Grafting text without exposing the current component-library API. */
export function Text(props: TextProps): ReactElement {
  return TextView(props);
}

/** Renders a compact semantic status without exposing the current component-library API. */
export function StatusBadge(props: StatusBadgeProps): ReactElement {
  return StatusBadgeView(props);
}

/** Renders a compact clickable action without exposing the current component-library API. */
export function Button(props: ButtonProps): ReactElement {
  return ButtonView(props);
}

/** Renders a generic bounded card surface without exposing the current component-library API. */
export function Card(props: CardProps): ReactElement {
  return CardView(props);
}

/** Renders a reusable entity identity card suitable for tables, canvases, and inspectors. */
export function EntitySummary(props: EntitySummaryProps): ReactElement {
  return EntitySummaryView(props);
}

/** Mounts an EntitySummary into an existing DOM host without exposing ReactDOM. */
export function mountEntitySummary(
  host: HTMLElement,
  props: EntitySummaryProps,
): UiMountHandle<EntitySummaryProps> {
  return mountReactView(host, props, (next) => EntitySummaryView(next));
}

/** Renders a vendor-neutral data table whose cells may contain bespoke React components. */
export function DataTable<Row extends object>(props: DataTableProps<Row>): ReactElement {
  return DataTableView(props);
}

/**
 * Renders a reusable dashboard grid layout with draggable, resizable panels.
 *
 * Consumers whose bundler does not already provide it must import
 * `react-grid-layout/css/styles.css` once at the application level; this
 * package does not import it as a side effect (it declares `sideEffects:
 * false`), so the choice of when and whether to load that stylesheet stays
 * with the consuming application.
 */
export function GridLayout(props: GridLayoutProps): ReactElement {
  return GridLayoutView(props);
}
