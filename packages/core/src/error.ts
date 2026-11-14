import * as v from "valibot";
import { TableRefSchema } from "./names";
import { readonlyArray, readonlyObject } from "./schema-helpers";

export const DbViewerErrorSchema = v.variant("kind", [
  readonlyObject({ kind: v.literal("unauthorized") }),
  readonlyObject({ kind: v.literal("invalidRequest"), issues: readonlyArray(v.string()) }),
  readonlyObject({ kind: v.literal("connectionNotFound"), connection: v.string() }),
  readonlyObject({ kind: v.literal("tableNotFound"), table: TableRefSchema }),
  readonlyObject({
    kind: v.literal("query"),
    message: v.string(),
    sqlState: v.nullable(v.string()),
    // SQL 内の文字位置（0 始まり）
    position: v.nullable(v.number()),
  }),
  readonlyObject({ kind: v.literal("readOnlyViolation"), message: v.string() }),
  readonlyObject({ kind: v.literal("multipleStatements") }),
  readonlyObject({ kind: v.literal("timeout"), timeoutMs: v.number() }),
  // 同時に実行できるクエリの数の上限を超えた
  readonlyObject({ kind: v.literal("busy"), maxConcurrentQueries: v.number() }),
  readonlyObject({ kind: v.literal("cancelled") }),
  readonlyObject({ kind: v.literal("unsupported"), feature: v.literal("cancel") }),
  // スタックトレースや接続文字列などの秘密情報を入れない
  readonlyObject({ kind: v.literal("internal"), message: v.string() }),
]);

export type DbViewerError = v.InferOutput<typeof DbViewerErrorSchema>;
