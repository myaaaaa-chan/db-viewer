import { describe, expect, it } from "vitest";
import { DriverNotInstalledError } from "./driver";
import {
  connectionSurvives,
  type ErrorContext,
  toDbError,
  toUtf16Index,
  UnsupportedStatementError,
} from "./errors";

const databaseError = (message: string, props: Record<string, unknown>) =>
  Object.assign(new Error(message), { name: "error", severity: "ERROR", ...props });

const context = (overrides: Partial<ErrorContext> = {}): ErrorContext => ({
  timeoutMs: 30_000,
  cancelRequested: false,
  sent: null,
  ...overrides,
});

describe("toDbError: DB が返したエラー", () => {
  it("SQLSTATE とメッセージをそのまま query に入れる。位置は SQL を送っていなければ null", () => {
    const cause = databaseError('relation "x" does not exist', { code: "42P01", position: "15" });
    expect(toDbError(cause, context())).toEqual({
      kind: "query",
      message: 'relation "x" does not exist',
      sqlState: "42P01",
      position: null,
    });
  });

  it("position は 1 始まりから 0 始まりに直す", () => {
    const cause = databaseError("syntax error", { code: "42601", position: "1" });
    expect(toDbError(cause, context({ sent: { text: "SELEC 1", offset: 0 } }))).toMatchObject({
      position: 0,
    });
    const later = databaseError("syntax error", { code: "42601", position: "8" });
    expect(
      toDbError(later, context({ sent: { text: "SELECT 1 FORM x", offset: 0 } })),
    ).toMatchObject({ position: 7 });
  });

  it("送った文が、利用者の SQL の途中から始まるときは、その分だけ位置をずらす", () => {
    // 利用者の SQL は "  SELEC 1;"。送ったのは先頭の空白と末尾の ; を除いた "SELEC 1"（2 文字目から）
    const cause = databaseError("syntax error", { code: "42601", position: "1" });
    expect(toDbError(cause, context({ sent: { text: "SELEC 1", offset: 2 } }))).toMatchObject({
      position: 2,
    });
  });

  it("position は文字（コードポイント）の数。サロゲートペアの前にある文字は UTF-16 では 2 つに数える", () => {
    // PostgreSQL は FORM を 12 文字目（1 始まり）と数える。JS の文字列では絵文字が 2 つ分なので、0 始まりで 12 番目
    const sql = "SELECT '😀' FORM x";
    const cause = databaseError("syntax error", { code: "42601", position: "12" });
    const position = (
      toDbError(cause, context({ sent: { text: sql, offset: 0 } })) as { position: number }
    ).position;
    expect(sql.slice(position, position + 4)).toBe("FORM");
  });

  it("位置が文を超えていても、文の末尾までに収める", () => {
    const cause = databaseError("unexpected end", { code: "42601", position: "99" });
    expect(toDbError(cause, context({ sent: { text: "SELECT", offset: 3 } }))).toMatchObject({
      position: 9,
    });
  });

  it("position のないエラーは null", () => {
    const cause = databaseError("division by zero", { code: "22012" });
    expect(toDbError(cause, context({ sent: { text: "SELECT 1/0", offset: 0 } }))).toMatchObject({
      position: null,
    });
  });

  it("25006（read only transaction）は readOnlyViolation", () => {
    const cause = databaseError("cannot execute DELETE in a read-only transaction", {
      code: "25006",
    });
    expect(toDbError(cause, context())).toEqual({
      kind: "readOnlyViolation",
      message: "cannot execute DELETE in a read-only transaction",
    });
  });
});

describe("toDbError: 57014（statement_timeout と中断は同じ SQLSTATE）", () => {
  const canceled = databaseError("canceling statement due to statement timeout", { code: "57014" });

  it("こちらが中断を依頼していなければ timeout。上限の時間を伝える", () => {
    expect(toDbError(canceled, context({ timeoutMs: 200 }))).toEqual({
      kind: "timeout",
      timeoutMs: 200,
    });
  });

  it("中断を依頼していたら cancelled", () => {
    expect(toDbError(canceled, context({ cancelRequested: true }))).toEqual({ kind: "cancelled" });
  });

  it("中断を依頼していても、別の SQLSTATE のエラーは cancelled にしない", () => {
    const other = databaseError("syntax error", { code: "42601" });
    expect(toDbError(other, context({ cancelRequested: true })).kind).toBe("query");
  });
});

describe("toDbError: DB のエラーではないもの（接続の失敗など）", () => {
  it("接続先などを含みうるメッセージは載せず、システムエラーのコードだけを伝える", () => {
    const cause = Object.assign(new Error("connect ECONNREFUSED 10.1.2.3:5432"), {
      code: "ECONNREFUSED",
    });
    const error = toDbError(cause, context());
    expect(error).toEqual({
      kind: "internal",
      message: "Database connection error (ECONNREFUSED).",
    });
  });

  it("EPIPE のように SQLSTATE と同じ 5 文字のコードでも、DB のエラーとは見なさない", () => {
    const cause = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
    expect(toDbError(cause, context()).kind).toBe("internal");
  });

  it("コードのない例外と、Error ではない値は、汎用のメッセージにする", () => {
    expect(toDbError(new Error("Connection terminated unexpectedly"), context())).toEqual({
      kind: "internal",
      message: "An unexpected database error occurred.",
    });
    expect(toDbError("boom", context())).toEqual({
      kind: "internal",
      message: "An unexpected database error occurred.",
    });
  });
});

describe("toDbError: こちらで作ったエラー", () => {
  it("使えない文は、feature_not_supported（0A000）の query にする", () => {
    expect(
      toDbError(new UnsupportedStatementError("COPY FROM STDIN is not supported."), context()),
    ).toEqual({
      kind: "query",
      message: "COPY FROM STDIN is not supported.",
      sqlState: "0A000",
      position: null,
    });
  });

  it("入っていないドライバは、入れ方を internal のメッセージで伝える", () => {
    expect(toDbError(new DriverNotInstalledError("pg-cursor"), context())).toEqual({
      kind: "internal",
      message: "pg-cursor is not installed. Run: npm install pg-cursor",
    });
  });
});

describe("toUtf16Index", () => {
  it("コードポイントの位置を、UTF-16 の位置に直す", () => {
    expect(toUtf16Index("abc", 2)).toBe(2);
    expect(toUtf16Index("a😀b", 2)).toBe(3);
    expect(toUtf16Index("あいう", 2)).toBe(2);
  });

  it("範囲外は文字列の長さに収める", () => {
    expect(toUtf16Index("a😀", 10)).toBe(3);
    expect(toUtf16Index("abc", -1)).toBe(0);
  });
});

describe("connectionSurvives", () => {
  it("文が失敗しただけ（ERROR）なら、接続は使える。接続が閉じられる FATAL と、DB のエラーでないものは使えない", () => {
    expect(connectionSurvives(databaseError("x", { code: "42601" }))).toBe(true);
    expect(connectionSurvives(databaseError("x", { code: "57P01", severity: "FATAL" }))).toBe(
      false,
    );
    expect(connectionSurvives(databaseError("x", { code: "XX000", severity: "PANIC" }))).toBe(
      false,
    );
    expect(connectionSurvives(new Error("Connection terminated unexpectedly"))).toBe(false);
  });
});
