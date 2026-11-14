import { describe, expect, it } from "vitest";
import { isNumericType } from "./numeric-type";

describe("isNumericType", () => {
  it("整数と小数の型は右寄せにする", () => {
    for (const type of [
      "int8",
      "int4",
      "bigint",
      "numeric(10,2)",
      "INTEGER",
      "REAL",
      "double precision",
    ]) {
      expect(isNumericType(type), type).toBe(true);
    }
  });

  it("文字列・日時・json・型が分からない列は右寄せにしない", () => {
    for (const type of ["text", "varchar(80)", "timestamptz", "jsonb", "interval", "user_role"]) {
      expect(isNumericType(type), type).toBe(false);
    }
    expect(isNumericType(null)).toBe(false);
  });
});
