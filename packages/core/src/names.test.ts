import * as v from "valibot";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type ColumnName,
  ColumnNameSchema,
  type ConnectionName,
  ConnectionNameSchema,
  columnName,
  connectionName,
  generateQueryId,
  type QueryId,
  QueryIdSchema,
  type SchemaName,
  SchemaNameSchema,
  schemaName,
  type TableName,
  TableNameSchema,
  TableRefSchema,
  tableName,
} from "./names";

describe("ブランド型", () => {
  it("同じ string でも、別の名前の型には代入できない", () => {
    expectTypeOf<ConnectionName>().not.toEqualTypeOf<SchemaName>();
    expectTypeOf<SchemaName>().not.toEqualTypeOf<TableName>();
    expectTypeOf<TableName>().not.toEqualTypeOf<ColumnName>();
    expectTypeOf<ColumnName>().not.toEqualTypeOf<QueryId>();
    expectTypeOf<string>().not.toExtend<ConnectionName>();
    expectTypeOf<SchemaName>().not.toExtend<TableName>();
  });

  it("ブランド型は string として読める", () => {
    expectTypeOf<ConnectionName>().toExtend<string>();
  });

  it("生成関数は値をそのまま返す（検証は境界のスキーマの役目）", () => {
    expect(connectionName("main")).toBe("main");
    expect(schemaName("public")).toBe("public");
    expect(tableName("users")).toBe("users");
    expect(columnName("id")).toBe("id");
  });
});

describe("名前のスキーマ", () => {
  it.each([
    ["ConnectionName", ConnectionNameSchema],
    ["SchemaName", SchemaNameSchema],
    ["TableName", TableNameSchema],
    ["ColumnName", ColumnNameSchema],
    ["QueryId", QueryIdSchema],
  ] as const)("%s は空文字と文字列以外を受け付けない", (_label, schema) => {
    expect(v.safeParse(schema, "x").success).toBe(true);
    expect(v.safeParse(schema, "").success).toBe(false);
    expect(v.safeParse(schema, 1).success).toBe(false);
    expect(v.safeParse(schema, null).success).toBe(false);
    expect(v.safeParse(schema, undefined).success).toBe(false);
  });

  it("識別子には Unicode や記号を含む名前も通す", () => {
    expect(v.safeParse(TableNameSchema, "ユーザー表").success).toBe(true);
    expect(v.safeParse(ColumnNameSchema, 'weird"name with space').success).toBe(true);
  });

  it("QueryId は 128 文字までに制限する", () => {
    expect(v.safeParse(QueryIdSchema, "a".repeat(128)).success).toBe(true);
    expect(v.safeParse(QueryIdSchema, "a".repeat(129)).success).toBe(false);
  });
});

describe("TableRef", () => {
  it("schema と name の両方が要る", () => {
    expect(v.safeParse(TableRefSchema, { schema: "public", name: "users" }).success).toBe(true);
    expect(v.safeParse(TableRefSchema, { schema: "public" }).success).toBe(false);
    expect(v.safeParse(TableRefSchema, { name: "users" }).success).toBe(false);
    expect(v.safeParse(TableRefSchema, "public.users").success).toBe(false);
  });

  it("余分なキーは取り除いて返す", () => {
    const parsed = v.parse(TableRefSchema, { schema: "public", name: "users", extra: 1 });
    expect(parsed).toEqual({ schema: "public", name: "users" });
  });
});

describe("generateQueryId", () => {
  it("渡された UUID 生成関数の結果を QueryId にする", () => {
    expect(generateQueryId(() => "fixed-uuid")).toBe("fixed-uuid");
  });

  it("既定では呼ぶたびに別の ID を返し、スキーマを満たす", () => {
    const a = generateQueryId();
    const b = generateQueryId();
    expect(a).not.toBe(b);
    expect(v.safeParse(QueryIdSchema, a).success).toBe(true);
  });
});
