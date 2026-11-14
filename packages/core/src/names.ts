import * as v from "valibot";
import { readonlyObject } from "./schema-helpers";

const nameSchema = <const TBrand extends string>(brand: TBrand) =>
  v.pipe(v.string(), v.minLength(1), v.brand(brand));

export const ConnectionNameSchema = nameSchema("ConnectionName");
export const SchemaNameSchema = nameSchema("SchemaName");
export const TableNameSchema = nameSchema("TableName");
export const ColumnNameSchema = nameSchema("ColumnName");
// クライアントが生成して送ってくる値なので、サーバーのメモリを使いすぎないよう長さを抑える。
export const QueryIdSchema = v.pipe(
  v.string(),
  v.minLength(1),
  v.maxLength(128),
  v.brand("QueryId"),
);

export type ConnectionName = v.InferOutput<typeof ConnectionNameSchema>;
export type SchemaName = v.InferOutput<typeof SchemaNameSchema>;
export type TableName = v.InferOutput<typeof TableNameSchema>;
export type ColumnName = v.InferOutput<typeof ColumnNameSchema>;
export type QueryId = v.InferOutput<typeof QueryIdSchema>;

export const TableRefSchema = readonlyObject({
  schema: SchemaNameSchema,
  name: TableNameSchema,
});
export type TableRef = v.InferOutput<typeof TableRefSchema>;

// 生成関数は型を付けるだけで検証しない。値を作ってよいのは、スキーマで検証した後と、
// アダプターが DB から名前を読み取った直後の境界に限る。
export const connectionName = (raw: string): ConnectionName => raw as ConnectionName;
export const schemaName = (raw: string): SchemaName => raw as SchemaName;
export const tableName = (raw: string): TableName => raw as TableName;
export const columnName = (raw: string): ColumnName => raw as ColumnName;
export const queryId = (raw: string): QueryId => raw as QueryId;

// UUID の生成は副作用なので、呼び出し側から差し替えられるようにする。
export const generateQueryId = (
  randomUUID: () => string = () => globalThis.crypto.randomUUID(),
): QueryId => queryId(randomUUID());
