import { schemaName, tableName } from "@myaaaaa_chan/db-viewer-core";
import { describe, expect, it } from "vitest";
import { errorText } from "./error-text";

describe("errorText", () => {
  it("DB が返したメッセージは翻訳せず、そのまま返す", () => {
    expect(
      errorText({
        kind: "query",
        message: 'column "x" does not exist',
        sqlState: "42703",
        position: 7,
      }),
    ).toEqual({ type: "raw", text: 'column "x" does not exist' });
    expect(errorText({ kind: "readOnlyViolation", message: "cannot execute INSERT" })).toEqual({
      type: "raw",
      text: "cannot execute INSERT",
    });
    expect(errorText({ kind: "internal", message: "boom" })).toEqual({ type: "raw", text: "boom" });
  });

  it("DB のメッセージ以外は、辞書のキーと値を返す", () => {
    expect(errorText({ kind: "unauthorized" })).toEqual({
      type: "message",
      key: "error.unauthorized",
    });
    expect(errorText({ kind: "multipleStatements" })).toEqual({
      type: "message",
      key: "error.multipleStatements",
    });
    expect(errorText({ kind: "cancelled" })).toEqual({ type: "message", key: "error.cancelled" });
    expect(errorText({ kind: "unsupported", feature: "cancel" })).toEqual({
      type: "message",
      key: "error.unsupportedCancel",
    });
    expect(errorText({ kind: "connectionNotFound", connection: "main" })).toEqual({
      type: "message",
      key: "error.connectionNotFound",
      values: { connection: "main" },
    });
    expect(
      errorText({
        kind: "tableNotFound",
        table: { schema: schemaName("public"), name: tableName("users") },
      }),
    ).toEqual({ type: "message", key: "error.tableNotFound", values: { table: "public.users" } });
    expect(errorText({ kind: "busy", maxConcurrentQueries: 4 })).toEqual({
      type: "message",
      key: "error.busy",
      values: { max: 4 },
    });
    expect(errorText({ kind: "invalidRequest", issues: ["a", "b"] })).toEqual({
      type: "message",
      key: "error.invalidRequest",
      values: { issues: "a; b" },
    });
  });

  it("タイムアウトは秒に直して返す", () => {
    expect(errorText({ kind: "timeout", timeoutMs: 30_000 })).toEqual({
      type: "message",
      key: "error.timeout",
      values: { seconds: 30 },
    });
  });
});
