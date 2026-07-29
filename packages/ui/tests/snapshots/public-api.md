# Generated TypeScript public API baseline

Package: `@grafting/ui`  
TypeScript: `5.9.3`  
Source entry point: `src/index.ts`  
Documentation policy: every exported declaration and public member requires TSDoc  
Forbidden public modules: `antd`, `react-dom`

## Declaration entry point

```ts
import type { ReactElement, ReactNode } from "react";
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
/** Renders Grafting text without exposing the current component-library API. */
export declare function Text(props: TextProps): ReactElement;
/** Renders a compact semantic status without exposing the current component-library API. */
export declare function StatusBadge(props: StatusBadgeProps): ReactElement;
/** Renders a reusable entity identity card suitable for tables, canvases, and inspectors. */
export declare function EntitySummary(props: EntitySummaryProps): ReactElement;
/** Mounts an EntitySummary into an existing DOM host without exposing ReactDOM. */
export declare function mountEntitySummary(host: HTMLElement, props: EntitySummaryProps): UiMountHandle<EntitySummaryProps>;
/** Renders a vendor-neutral data table whose cells may contain bespoke React components. */
export declare function DataTable<Row extends object>(props: DataTableProps<Row>): ReactElement;
```
