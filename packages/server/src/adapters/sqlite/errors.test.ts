import { describe, expect, it } from "vitest";
import { DuplicateColumnNamesError } from "./driver";
import { toDbError } from "./errors";

const driverError = (message: string, props: Record<string, unknown>) =>
  Object.assign(new Error(message), props);

describe("toDbError", () => {
  it("SQLite のエラーは query にして、DB のメッセージとコードをそのまま持つ", () => {
    expect(toDbError(driverError('near "selec": syntax error', { code: "SQLITE_ERROR" }))).toEqual({
      kind: "query",
      message: 'near "selec": syntax error',
      sqlState: "SQLITE_ERROR",
      position: null,
    });
  });

  it("コードを持たないエラーでも、メッセージを query として返す", () => {
    expect(toDbError(new RangeError("identifier must not contain a NUL character"))).toEqual({
      kind: "query",
      message: "identifier must not contain a NUL character",
      sqlState: null,
      position: null,
    });
  });

  it.each([
    ["better-sqlite3 / bun:sqlite", { code: "SQLITE_READONLY" }],
    ["拡張コード", { code: "SQLITE_READONLY_DBMOVED" }],
    ["node:sqlite", { code: "ERR_SQLITE_ERROR", errcode: 8 }],
    ["node:sqlite の拡張コード", { code: "ERR_SQLITE_ERROR", errcode: 8 | (4 << 8) }],
  ])("書き込みの拒否（%s）は readOnlyViolation", (_driver, props) => {
    expect(toDbError(driverError("attempt to write a readonly database", props))).toEqual({
      kind: "readOnlyViolation",
      message: "attempt to write a readonly database",
    });
  });

  it("node:sqlite の SQLITE_ERROR（errcode 1）は readOnlyViolation にならない", () => {
    expect(toDbError(driverError("x", { code: "ERR_SQLITE_ERROR", errcode: 1 })).kind).toBe(
      "query",
    );
  });

  it("同名の列を返せないドライバでの失敗は、別名を付けるよう伝える query", () => {
    const error = toDbError(new DuplicateColumnNamesError());
    expect(error.kind).toBe("query");
    if (error.kind === "query") expect(error.message).toMatch(/alias/);
  });

  it("Error でない値が投げられたときは internal。中身は載せない", () => {
    expect(toDbError("secret=abc")).toEqual({
      kind: "internal",
      message: "An unexpected error occurred.",
    });
  });
});
