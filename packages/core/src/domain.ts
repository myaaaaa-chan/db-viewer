import type { ColumnName, ConnectionName, TableRef } from "./names";

export type Dialect = "postgres" | "sqlite";

export type ConnectionInfo = {
  readonly name: ConnectionName;
  readonly dialect: Dialect;
  readonly readOnly: boolean;
  readonly capabilities: { readonly cancel: boolean };
};

export type TableKind = "table" | "view";
export type TableSummary = { readonly ref: TableRef; readonly kind: TableKind };

export type ColumnInfo = {
  readonly name: ColumnName;
  // DB 上での型名（"int4"、"varchar(255)"、"TEXT" など）
  readonly dbType: string;
  readonly nullable: boolean;
  // 既定値の式を文字列のまま持つ
  readonly defaultValue: string | null;
  // 複合主キーでの順番（1 始まり）
  readonly primaryKeyPosition: number | null;
};

export type IndexInfo = {
  readonly name: string;
  // 式インデックスの場合は式の文字列
  readonly columns: ReadonlyArray<string>;
  readonly unique: boolean;
  readonly primary: boolean;
};

export type ForeignKeyInfo = {
  readonly name: string;
  readonly columns: ReadonlyArray<ColumnName>;
  readonly references: {
    readonly table: TableRef;
    readonly columns: ReadonlyArray<ColumnName>;
  };
};

export type TableDetail = {
  readonly summary: TableSummary;
  readonly columns: ReadonlyArray<ColumnInfo>;
  readonly indexes: ReadonlyArray<IndexInfo>;
  readonly foreignKeys: ReadonlyArray<ForeignKeyInfo>;
  // PostgreSQL では approximate が true
  readonly ddl: { readonly text: string; readonly approximate: boolean };
};

// null は SQL の NULL を表す。それ以外はすべて DB の文字列表現。
export type CellValue = string | null;

export type ResultColumn = { readonly name: string; readonly dbType: string | null };

export type ResultSet = {
  readonly columns: ReadonlyArray<ResultColumn>;
  // 行ごとの配列（同名の列があっても壊れない）
  readonly rows: ReadonlyArray<ReadonlyArray<CellValue>>;
  // 上限の行数で打ち切った場合は true
  readonly truncated: boolean;
  // maxCellChars を超えて切り詰めたセルの位置
  readonly truncatedCells: ReadonlyArray<readonly [row: number, column: number]>;
};

export type QueryOutcome =
  | ({ readonly kind: "rows" } & ResultSet & { readonly elapsedMs: number })
  | {
      readonly kind: "command";
      readonly affectedRows: number | null;
      readonly elapsedMs: number;
    };
