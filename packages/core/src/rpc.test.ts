import * as v from "valibot";
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  CellValue,
  ConnectionInfo,
  QueryOutcome,
  ResultSet,
  TableDetail,
  TableSummary,
} from "./domain";
import type { DbViewerError } from "./error";
import type { SchemaName } from "./names";
import {
  RpcEnvelopeSchema,
  type RpcOp,
  type RpcRequest,
  type RpcRequestOf,
  RpcRequestSchema,
  type RpcResponse,
  type RpcResult,
  type RpcResultMap,
} from "./rpc";

const table = { schema: "public", name: "users" };

const validRequests: Readonly<Record<RpcOp, unknown>> = {
  listConnections: { op: "listConnections" },
  listSchemas: { op: "listSchemas", connection: "main" },
  listTables: { op: "listTables", connection: "main", schema: "public" },
  getTableDetail: { op: "getTableDetail", connection: "main", table },
  fetchRows: {
    op: "fetchRows",
    connection: "main",
    query: { table, filters: [], rawWhere: null, sort: null, limit: 100, offset: 0 },
  },
  countRows: {
    op: "countRows",
    connection: "main",
    table,
    filters: [{ column: "age", op: "gt", value: "20" }],
    rawWhere: null,
  },
  fetchCell: {
    op: "fetchCell",
    connection: "main",
    table,
    primaryKey: { id: "1" },
    column: "bio",
  },
  executeQuery: { op: "executeQuery", connection: "main", sql: "select 1", queryId: "q-1" },
  cancelQuery: { op: "cancelQuery", connection: "main", queryId: "q-1" },
};

describe("RpcRequestSchema", () => {
  it.each(Object.entries(validRequests))("%s を受け付け、内容を変えない", (_op, request) => {
    const result = v.safeParse(RpcRequestSchema, request);
    expect(result.success).toBe(true);
    expect(result.output).toEqual(request);
  });

  it("9 つの op をすべて持つ", () => {
    expect(Object.keys(validRequests)).toHaveLength(9);
  });

  it.each([
    ["op がない", {}],
    ["未知の op", { op: "dropTable", connection: "main" }],
    ["listSchemas に connection がない", { op: "listSchemas" }],
    ["connection が空文字", { op: "listSchemas", connection: "" }],
    ["listTables に schema がない", { op: "listTables", connection: "main" }],
    ["getTableDetail の table が不完全", { op: "getTableDetail", connection: "main", table: {} }],
    [
      "fetchRows の limit が 0",
      {
        op: "fetchRows",
        connection: "main",
        query: { table, filters: [], rawWhere: null, sort: null, limit: 0, offset: 0 },
      },
    ],
    ["countRows の filters がない", { op: "countRows", connection: "main", table, rawWhere: null }],
    [
      "fetchCell の primaryKey の値が数値",
      {
        op: "fetchCell",
        connection: "main",
        table,
        primaryKey: { id: 1 },
        column: "bio",
      },
    ],
    ["fetchCell に column がない", { op: "fetchCell", connection: "main", table, primaryKey: {} }],
    [
      "executeQuery の sql が文字列でない",
      { op: "executeQuery", connection: "main", sql: 1, queryId: "q" },
    ],
    ["executeQuery に queryId がない", { op: "executeQuery", connection: "main", sql: "select 1" }],
    ["cancelQuery の queryId が空", { op: "cancelQuery", connection: "main", queryId: "" }],
    ["配列", []],
    ["null", null],
  ])("%s は受け付けない", (_label, request) => {
    expect(v.safeParse(RpcRequestSchema, request).success).toBe(false);
  });

  it("検証の失敗は issues として読める", () => {
    const result = v.safeParse(RpcRequestSchema, { op: "listSchemas" });
    expect(result.success).toBe(false);
    expect(result.issues?.length).toBeGreaterThan(0);
  });

  describe("fetchCell の primaryKey", () => {
    const fetchCell = (primaryKey: unknown) => ({
      op: "fetchCell",
      connection: "main",
      table,
      primaryKey,
      column: "bio",
    });

    it("複合主キーのすべての列を保つ", () => {
      const parsed = v.parse(RpcRequestSchema, fetchCell({ tenant: "a", id: "1" }));
      expect(parsed).toEqual(fetchCell({ tenant: "a", id: "1" }));
    });

    it("constructor や prototype という名前の列も黙って捨てない", () => {
      const key = JSON.parse('{"constructor":"1","prototype":"2","__proto__":"3"}');
      const parsed = v.parse(RpcRequestSchema, fetchCell(key));
      if (parsed.op !== "fetchCell") throw new Error("unreachable");
      expect(Object.keys(parsed.primaryKey).sort()).toEqual([
        "__proto__",
        "constructor",
        "prototype",
      ]);
    });

    it.each([
      ["配列", ["1"]],
      ["null", null],
      ["値が数値", { id: 1 }],
      ["値が null", { id: null }],
      ["値がオブジェクト", { id: { nested: "1" } }],
    ])("%s は受け付けない", (_label, primaryKey) => {
      expect(v.safeParse(RpcRequestSchema, fetchCell(primaryKey)).success).toBe(false);
    });
  });

  it("導出した RpcRequest は op で絞り込める", () => {
    expectTypeOf<RpcRequest["op"]>().toEqualTypeOf<RpcOp>();
    expectTypeOf<RpcRequestOf<"listConnections">>().toEqualTypeOf<{
      readonly op: "listConnections";
    }>();
    expectTypeOf<RpcRequestOf<"cancelQuery">["queryId"]>().not.toEqualTypeOf<string>();
  });
});

describe("op ごとの戻り値の対応表（型レベル）", () => {
  it("対応表のキーは RpcRequest の op とちょうど一致する", () => {
    expectTypeOf<keyof RpcResultMap>().toEqualTypeOf<RpcOp>();
  });

  it("op から設計どおりの戻り値の型が引ける", () => {
    expectTypeOf<RpcResult<"listConnections">>().toEqualTypeOf<ReadonlyArray<ConnectionInfo>>();
    expectTypeOf<RpcResult<"listSchemas">>().toEqualTypeOf<ReadonlyArray<SchemaName>>();
    expectTypeOf<RpcResult<"listTables">>().toEqualTypeOf<ReadonlyArray<TableSummary>>();
    expectTypeOf<RpcResult<"getTableDetail">>().toEqualTypeOf<TableDetail>();
    expectTypeOf<RpcResult<"fetchRows">>().toEqualTypeOf<ResultSet>();
    expectTypeOf<RpcResult<"countRows">>().toEqualTypeOf<{ readonly count: string }>();
    expectTypeOf<RpcResult<"fetchCell">>().toEqualTypeOf<{ readonly value: CellValue }>();
    expectTypeOf<RpcResult<"executeQuery">>().toEqualTypeOf<QueryOutcome>();
    expectTypeOf<RpcResult<"cancelQuery">>().toEqualTypeOf<{ readonly cancelled: boolean }>();
  });

  it("RpcResponse は ok で成功と失敗を判別できる", () => {
    expectTypeOf<RpcResponse<number>>().toEqualTypeOf<
      | { readonly ok: true; readonly value: number }
      | { readonly ok: false; readonly error: DbViewerError }
    >();
  });
});

describe("RpcEnvelopeSchema（クライアントが応答の外側だけを確かめる）", () => {
  it("ok: true は中身を検証せずそのまま通す", () => {
    const body = { ok: true, value: [1, 2, 3] };
    expect(v.parse(RpcEnvelopeSchema, body)).toEqual(body);
  });

  it("ok: false は error が DbViewerError のときだけ通す", () => {
    expect(
      v.safeParse(RpcEnvelopeSchema, { ok: false, error: { kind: "cancelled" } }).success,
    ).toBe(true);
    expect(v.safeParse(RpcEnvelopeSchema, { ok: false, error: { kind: "weird" } }).success).toBe(
      false,
    );
    expect(v.safeParse(RpcEnvelopeSchema, { ok: false }).success).toBe(false);
  });

  it("ok がない、または真偽値でないものは通さない", () => {
    expect(v.safeParse(RpcEnvelopeSchema, { value: 1 }).success).toBe(false);
    expect(v.safeParse(RpcEnvelopeSchema, { ok: "true", value: 1 }).success).toBe(false);
    expect(v.safeParse(RpcEnvelopeSchema, "ok").success).toBe(false);
    expect(v.safeParse(RpcEnvelopeSchema, null).success).toBe(false);
  });

  it("ok: true で value がないものは通さない", () => {
    expect(v.safeParse(RpcEnvelopeSchema, { ok: true }).success).toBe(false);
  });
});
