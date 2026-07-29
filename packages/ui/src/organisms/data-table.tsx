import { Table } from "antd";
import type { TableColumnsType, TableProps } from "antd";
import type { ReactNode } from "react";

import type {
  DataTableColumn,
  DataTableProps,
  DataTableRowKey,
} from "../index.js";

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

export function DataTableView<Row extends object>(props: DataTableProps<Row>) {
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
