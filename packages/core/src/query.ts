import * as v from "valibot";
import { ColumnNameSchema, TableRefSchema } from "./names";
import { readonlyArray, readonlyObject } from "./schema-helpers";

// すべて AND で結合する。値は常にパラメータとして DB に渡す（サーバー側の責務）。
export const FilterSchema = v.variant("op", [
  readonlyObject({ column: ColumnNameSchema, op: v.literal("isNull") }),
  readonlyObject({
    column: ColumnNameSchema,
    op: v.picklist(["eq", "neq", "lt", "gt", "like"]),
    value: v.string(),
  }),
]);
export type Filter = v.InferOutput<typeof FilterSchema>;
export type FilterOperator = Filter["op"];

export const SortSchema = readonlyObject({
  column: ColumnNameSchema,
  direction: v.picklist(["asc", "desc"]),
});
export type Sort = v.InferOutput<typeof SortSchema>;

export const RowsQuerySchema = readonlyObject({
  table: TableRefSchema,
  filters: readonlyArray(FilterSchema),
  // 直接入力した WHERE 句（"WHERE" は付けない）
  rawWhere: v.nullable(v.string()),
  // MVP では並べ替えは 1 列だけ
  sort: v.nullable(SortSchema),
  limit: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  offset: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
});
export type RowsQuery = v.InferOutput<typeof RowsQuerySchema>;
