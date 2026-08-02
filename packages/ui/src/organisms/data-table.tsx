import { Table } from "antd";
import type { TableColumnsType, TableProps } from "antd";
import type { ReactElement, ReactNode } from "react";

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

const alignments = {
  start: "left",
  center: "center",
  end: "right",
} as const;

const presentValue = (value: unknown): ReactNode => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "bigint" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
};

const toColumn = <Row extends object>(column: DataTableColumn<Row>) => ({
  key: column.id,
  title: column.header,
  width: column.width,
  align: column.align === undefined ? undefined : alignments[column.align],
  render: (_value: unknown, row: Row, rowIndex: number) => {
    const value = column.value(row);
    return column.renderCell?.({ row, value, rowIndex }) ?? presentValue(value);
  },
});

const normalizeKeys = (keys: readonly React.Key[]): readonly DataTableRowKey[] =>
  keys.filter((key): key is DataTableRowKey => typeof key === "string" || typeof key === "number");

/**
 * Immutable rows table with controlled selection and custom renderers.
 *
 * @layer organism
 * @status stable
 * @example Repository nodes table
 * ```tsx
 * <DataTable
 *   ariaLabel="Repository nodes"
 *   rows={[{ id: "a", name: "architecture-studio" }, { id: "b", name: "ui" }]}
 *   rowKey={(row) => row.id}
 *   columns={[{ id: "name", header: "Name", value: (row) => row.name }]}
 * />
 * ```
 */
export function DataTable<Row extends object>(props: DataTableProps<Row>): ReactElement {
  const columns: TableColumnsType<Row> = props.columns.map(toColumn);
  const pagination: TableProps<Row>["pagination"] =
    props.pagination === false
      ? false
      : {
          pageSize: props.pagination?.pageSize ?? 20,
          hideOnSinglePage: props.pagination?.hideWhenSinglePage ?? true,
          showSizeChanger: false,
        };
  const rowSelection: TableProps<Row>["rowSelection"] =
    props.selection === undefined
      ? undefined
      : {
          selectedRowKeys: [...props.selection.selectedKeys],
          onChange: (keys) => props.selection?.onChange(normalizeKeys(keys)),
        };

  return (
    <div aria-label={props.ariaLabel} className={props.className} role="region">
      <Table<Row>
        columns={columns}
        dataSource={[...props.rows]}
        locale={{ emptyText: props.emptyMessage ?? "No data" }}
        loading={props.loading}
        pagination={pagination}
        rowKey={props.rowKey}
        rowSelection={rowSelection}
        size={props.density === "regular" ? "middle" : "small"}
        tableLayout="fixed"
      />
    </div>
  );
}
