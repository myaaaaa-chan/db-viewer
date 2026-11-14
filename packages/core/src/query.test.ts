import * as v from "valibot";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { ColumnName } from "./names";
import { type Filter, FilterSchema, RowsQuerySchema, SortSchema } from "./query";

describe("FilterSchema", () => {
  it.each(["eq", "neq", "lt", "gt", "like"] as const)("%s は value が要る", (op) => {
    expect(v.safeParse(FilterSchema, { column: "age", op, value: "20" }).success).toBe(true);
    expect(v.safeParse(FilterSchema, { column: "age", op }).success).toBe(false);
  });

  it("isNull は value なしで通り、value があっても取り除く", () => {
    expect(v.parse(FilterSchema, { column: "deleted_at", op: "isNull" })).toEqual({
      column: "deleted_at",
      op: "isNull",
    });
    expect(v.parse(FilterSchema, { column: "deleted_at", op: "isNull", value: "x" })).toEqual({
      column: "deleted_at",
      op: "isNull",
    });
  });

  it("未知の演算子と、value が文字列でないものは受け付けない", () => {
    expect(v.safeParse(FilterSchema, { column: "a", op: "regex", value: "x" }).success).toBe(false);
    expect(v.safeParse(FilterSchema, { column: "a", op: "eq", value: 1 }).success).toBe(false);
    expect(v.safeParse(FilterSchema, { column: "", op: "isNull" }).success).toBe(false);
  });

  it("op で絞り込むと、isNull 以外にだけ value がある", () => {
    const valueIn = (f: Filter): string | null => (f.op === "isNull" ? null : f.value);
    expect(valueIn({ column: "a" as ColumnName, op: "isNull" })).toBeNull();
    expect(valueIn({ column: "a" as ColumnName, op: "eq", value: "1" })).toBe("1");
  });
});

describe("SortSchema", () => {
  it("方向は asc か desc だけ", () => {
    expect(v.safeParse(SortSchema, { column: "id", direction: "asc" }).success).toBe(true);
    expect(v.safeParse(SortSchema, { column: "id", direction: "desc" }).success).toBe(true);
    expect(v.safeParse(SortSchema, { column: "id", direction: "up" }).success).toBe(false);
  });
});

describe("RowsQuerySchema", () => {
  const valid = {
    table: { schema: "public", name: "users" },
    filters: [{ column: "age", op: "gt", value: "20" }],
    rawWhere: "name LIKE 'a%'",
    sort: { column: "id", direction: "desc" },
    limit: 100,
    offset: 200,
  };

  it("完全なクエリを受け付け、内容を変えない", () => {
    expect(v.parse(RowsQuerySchema, valid)).toEqual(valid);
  });

  it("rawWhere と sort は null を許す", () => {
    const parsed = v.parse(RowsQuerySchema, { ...valid, rawWhere: null, sort: null, filters: [] });
    expect(parsed.rawWhere).toBeNull();
    expect(parsed.sort).toBeNull();
  });

  it.each([
    ["limit が 0", { limit: 0 }],
    ["limit が負", { limit: -1 }],
    ["limit が小数", { limit: 1.5 }],
    ["limit が文字列", { limit: "100" }],
    ["offset が負", { offset: -1 }],
    ["offset が NaN", { offset: Number.NaN }],
    ["offset が Infinity", { offset: Number.POSITIVE_INFINITY }],
    ["filters が配列でない", { filters: {} }],
    ["rawWhere が undefined", { rawWhere: undefined }],
  ])("%s は受け付けない", (_label, patch) => {
    expect(v.safeParse(RowsQuerySchema, { ...valid, ...patch }).success).toBe(false);
  });

  it("offset 0 は許す", () => {
    expect(v.safeParse(RowsQuerySchema, { ...valid, offset: 0 }).success).toBe(true);
  });

  it("導出した型は readonly で、配列も ReadonlyArray になる", () => {
    type Parsed = v.InferOutput<typeof RowsQuerySchema>;
    expectTypeOf<Parsed["filters"]>().toEqualTypeOf<ReadonlyArray<Filter>>();
    expectTypeOf<Parsed["limit"]>().toEqualTypeOf<number>();
  });
});
