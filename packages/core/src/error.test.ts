import * as v from "valibot";
import { describe, expect, expectTypeOf, it } from "vitest";
import { type DbViewerError, DbViewerErrorSchema } from "./error";

const validErrors: ReadonlyArray<readonly [string, unknown]> = [
  ["unauthorized", { kind: "unauthorized" }],
  ["invalidRequest", { kind: "invalidRequest", issues: ["op: Invalid type"] }],
  ["connectionNotFound", { kind: "connectionNotFound", connection: "main" }],
  ["tableNotFound", { kind: "tableNotFound", table: { schema: "public", name: "users" } }],
  ["query", { kind: "query", message: "syntax error", sqlState: "42601", position: 7 }],
  ["query（SQLSTATE と位置なし）", { kind: "query", message: "x", sqlState: null, position: null }],
  ["readOnlyViolation", { kind: "readOnlyViolation", message: "read-only transaction" }],
  ["multipleStatements", { kind: "multipleStatements" }],
  ["timeout", { kind: "timeout", timeoutMs: 30000 }],
  ["busy", { kind: "busy", maxConcurrentQueries: 2 }],
  ["cancelled", { kind: "cancelled" }],
  ["unsupported", { kind: "unsupported", feature: "cancel" }],
  ["internal", { kind: "internal", message: "boom" }],
];

describe("DbViewerErrorSchema", () => {
  it.each(validErrors)("%s を受け付け、内容を変えない", (_label, value) => {
    const result = v.safeParse(DbViewerErrorSchema, value);
    expect(result.success).toBe(true);
    expect(result.output).toEqual(value);
  });

  it("12 種類の kind をすべて持つ", () => {
    const kinds = new Set(validErrors.map(([, e]) => (e as { kind: string }).kind));
    expect(kinds.size).toBe(12);
  });

  it.each([
    ["未知の kind", { kind: "nope" }],
    ["kind なし", {}],
    ["query に message がない", { kind: "query", sqlState: null, position: null }],
    ["query の sqlState が省略されている", { kind: "query", message: "x", position: null }],
    ["timeout の値が文字列", { kind: "timeout", timeoutMs: "30000" }],
    ["unsupported の feature が未知", { kind: "unsupported", feature: "export" }],
    ["tableNotFound の table が文字列", { kind: "tableNotFound", table: "users" }],
    ["オブジェクトではない", "unauthorized"],
  ])("%s は受け付けない", (_label, value) => {
    expect(v.safeParse(DbViewerErrorSchema, value).success).toBe(false);
  });

  it("kind で判別して絞り込める", () => {
    const describeError = (e: DbViewerError): string => {
      switch (e.kind) {
        case "timeout":
          return `timeout ${e.timeoutMs}`;
        case "busy":
          return `busy ${e.maxConcurrentQueries}`;
        default:
          return e.kind;
      }
    };
    expect(describeError({ kind: "timeout", timeoutMs: 5 })).toBe("timeout 5");
    expectTypeOf<Extract<DbViewerError, { kind: "unauthorized" }>>().toEqualTypeOf<{
      readonly kind: "unauthorized";
    }>();
  });
});
