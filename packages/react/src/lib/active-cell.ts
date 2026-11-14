import {
  type CellValue,
  type ColumnName,
  columnName,
  type ResultSet,
  type TableDetail,
} from "@myaaaaa_chan/db-viewer-core";
import type { CellPos } from "../state/grid-selection";
import { primaryKeyOf } from "./primary-key";

export type ActiveCell = {
  readonly columnName: ColumnName;
  readonly dbType: string | null;
  readonly value: CellValue;
  readonly truncated: boolean;
  // 全体を取り直せるときだけ持つ（主キーのあるテーブルで、主キーの値が切り詰められていない場合）
  readonly primaryKey: Readonly<Record<string, string>> | null;
};

export const describeActiveCell = (
  result: ResultSet,
  pos: CellPos,
  detail: TableDetail | null,
): ActiveCell | null => {
  const column = result.columns[pos.col];
  const row = result.rows[pos.row];
  if (!column || !row) return null;
  return {
    columnName: columnName(column.name),
    dbType: column.dbType,
    value: row[pos.col] ?? null,
    truncated: result.truncatedCells.some(([r, c]) => r === pos.row && c === pos.col),
    primaryKey: detail ? primaryKeyOf(detail, result, pos.row) : null,
  };
};

export const describePrimaryKey = (
  primaryKey: Readonly<Record<string, string>> | null,
): string | null =>
  primaryKey === null
    ? null
    : Object.entries(primaryKey)
        .map(([name, value]) => `${name} = ${value}`)
        .join(", ");
