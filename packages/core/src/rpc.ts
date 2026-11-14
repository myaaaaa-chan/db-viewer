import * as v from "valibot";
import type {
  CellValue,
  ConnectionInfo,
  QueryOutcome,
  ResultSet,
  TableDetail,
  TableSummary,
} from "./domain";
import { type DbViewerError, DbViewerErrorSchema } from "./error";
import {
  ColumnNameSchema,
  ConnectionNameSchema,
  QueryIdSchema,
  type SchemaName,
  SchemaNameSchema,
  TableRefSchema,
} from "./names";
import { FilterSchema, RowsQuerySchema } from "./query";
import { readonlyArray, readonlyObject } from "./schema-helpers";

// v.record は constructor / prototype / __proto__ というキーを黙って捨て、配列も通してしまう。
// 主キー列の名前は利用者のテーブル次第なので、キーを 1 つも欠かさず通す専用の検査にする。
const PrimaryKeySchema = v.custom<Readonly<Record<string, string>>>(
  (input) =>
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    Object.values(input).every((value) => typeof value === "string"),
  "primaryKey must be an object of strings",
);

const connection = ConnectionNameSchema;
const filters = readonlyArray(FilterSchema);
const rawWhere = v.nullable(v.string());

// リクエストの型は、この 1 つのスキーマから導出する。
export const RpcRequestSchema = v.variant("op", [
  readonlyObject({ op: v.literal("listConnections") }),
  readonlyObject({ op: v.literal("listSchemas"), connection }),
  readonlyObject({ op: v.literal("listTables"), connection, schema: SchemaNameSchema }),
  readonlyObject({ op: v.literal("getTableDetail"), connection, table: TableRefSchema }),
  readonlyObject({ op: v.literal("fetchRows"), connection, query: RowsQuerySchema }),
  readonlyObject({
    op: v.literal("countRows"),
    connection,
    table: TableRefSchema,
    filters,
    rawWhere,
  }),
  readonlyObject({
    op: v.literal("fetchCell"),
    connection,
    table: TableRefSchema,
    primaryKey: PrimaryKeySchema,
    column: ColumnNameSchema,
  }),
  readonlyObject({
    op: v.literal("executeQuery"),
    connection,
    sql: v.string(),
    queryId: QueryIdSchema,
  }),
  readonlyObject({ op: v.literal("cancelQuery"), connection, queryId: QueryIdSchema }),
]);

export type RpcRequest = v.InferOutput<typeof RpcRequestSchema>;
export type RpcOp = RpcRequest["op"];
export type RpcRequestOf<TOp extends RpcOp> = Extract<RpcRequest, { readonly op: TOp }>;

export type RpcResultMap = {
  readonly listConnections: ReadonlyArray<ConnectionInfo>;
  readonly listSchemas: ReadonlyArray<SchemaName>;
  readonly listTables: ReadonlyArray<TableSummary>;
  readonly getTableDetail: TableDetail;
  readonly fetchRows: ResultSet;
  // 大きな件数でも精度を落とさないよう文字列にする
  readonly countRows: { readonly count: string };
  readonly fetchCell: { readonly value: CellValue };
  readonly executeQuery: QueryOutcome;
  readonly cancelQuery: { readonly cancelled: boolean };
};
export type RpcResult<TOp extends RpcOp> = RpcResultMap[TOp];

export type RpcResponse<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: DbViewerError };

// クライアントが応答の外側だけを確かめるためのスキーマ。value は検証しない。
// 行数の多い結果を毎回検証するのは重く、両端は同じバージョンのパッケージで型を共有しているため。
export const RpcEnvelopeSchema = v.union([
  v.object({ ok: v.literal(true), value: v.unknown() }),
  v.object({ ok: v.literal(false), error: DbViewerErrorSchema }),
]);
