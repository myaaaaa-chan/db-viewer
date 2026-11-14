import * as v from "valibot";
import { describe, expect, it, vi } from "vitest";
import type { DataSource, DbResult } from "../data-source";
import type { QueryOutcome } from "../domain";
import { createHttpDataSource } from "../http-data-source";
import { columnName, connectionName, type QueryId, queryId, schemaName, tableName } from "../names";
import type { Filter, RowsQuery } from "../query";
import { err, ok } from "../result";
import { type RpcRequest, RpcRequestSchema } from "../rpc";
import { createMemoryDataSource, memoryTable } from "./memory-data-source";

const users = memoryTable({
  name: "users",
  columns: [
    { name: "id", dbType: "integer", primaryKeyPosition: 1 },
    { name: "name", dbType: "text" },
    { name: "age", dbType: "integer" },
    { name: "bio", dbType: "text" },
  ],
  rows: [
    ["1", "alice", "30", null],
    ["2", "bob", "25", "hello"],
    ["3", "carol", null, "abc"],
    ["10", "dave", "30", "a.c"],
  ],
});

const members = memoryTable({
  name: "members",
  columns: [
    { name: "tenant", dbType: "text", primaryKeyPosition: 1 },
    { name: "id", dbType: "integer", primaryKeyPosition: 2 },
    { name: "note", dbType: "text" },
  ],
  rows: [
    ["a", "1", "first"],
    ["a", "2", "second"],
    ["b", "1", "third"],
  ],
});

const activeUsers = memoryTable({
  name: "active_users",
  kind: "view",
  columns: [{ name: "id", dbType: "integer" }],
  rows: [["1"]],
});

const main = connectionName("main");
const publicSchema = schemaName("public");
const usersRef = { schema: publicSchema, name: tableName("users") };
const col = columnName;

const build = (options: Partial<Parameters<typeof createMemoryDataSource>[0]> = {}) =>
  createMemoryDataSource({
    connections: [
      {
        name: "main",
        dialect: "postgres",
        readOnly: true,
        cancel: true,
        enforcesTimeout: true,
        schemas: [
          { name: "public", tables: [users, members, activeUsers] },
          { name: "empty", tables: [] },
        ],
      },
      { name: "lite", dialect: "sqlite", readOnly: false, schemas: [{ name: "main", tables: [] }] },
    ],
    ...options,
  });

const rowsQuery = (patch: Partial<RowsQuery> = {}): RowsQuery => ({
  table: usersRef,
  filters: [],
  rawWhere: null,
  sort: null,
  limit: 100,
  offset: 0,
  ...patch,
});

const unwrap = <T>(result: DbResult<T>): T => {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
};

const idsOf = async (
  ds: DataSource,
  patch: Partial<RowsQuery>,
): Promise<ReadonlyArray<string | null>> => {
  const rows = unwrap(await ds.fetchRows(main, rowsQuery(patch))).rows;
  return rows.map((row) => row[0] ?? null);
};

describe("メタデータ", () => {
  it("接続の一覧は、方言・読み取り専用・中断とタイムアウトの強制の可否を返す。省略すると false", async () => {
    expect(unwrap(await build().listConnections())).toEqual([
      {
        name: "main",
        dialect: "postgres",
        readOnly: true,
        capabilities: { cancel: true, enforcesTimeout: true },
      },
      {
        name: "lite",
        dialect: "sqlite",
        readOnly: false,
        capabilities: { cancel: false, enforcesTimeout: false },
      },
    ]);
  });

  it("スキーマの一覧と、スキーマ内のテーブルとビューの一覧を返す", async () => {
    const ds = build();
    expect(unwrap(await ds.listSchemas(main))).toEqual(["public", "empty"]);
    expect(
      unwrap(await ds.listTables(main, publicSchema)).map((t) => [t.ref.name, t.kind]),
    ).toEqual([
      ["users", "table"],
      ["members", "table"],
      ["active_users", "view"],
    ]);
    expect(unwrap(await ds.listTables(main, schemaName("empty")))).toEqual([]);
  });

  it("存在しないスキーマのテーブル一覧は空にする", async () => {
    expect(unwrap(await build().listTables(main, schemaName("nope")))).toEqual([]);
  });

  it("テーブル詳細は、カラム・主キーの順番・インデックスを持つ", async () => {
    const detail = unwrap(
      await build().getTableDetail(main, { schema: publicSchema, name: tableName("members") }),
    );
    expect(detail.summary).toEqual({ ref: { schema: "public", name: "members" }, kind: "table" });
    expect(detail.columns.map((c) => [c.name, c.dbType, c.primaryKeyPosition])).toEqual([
      ["tenant", "text", 1],
      ["id", "integer", 2],
      ["note", "text", null],
    ]);
    expect(detail.indexes).toEqual([
      { name: "members_pkey", columns: ["tenant", "id"], unique: true, primary: true },
    ]);
    expect(detail.ddl.text).toContain("members");
  });

  it("存在しない接続は connectionNotFound、存在しないテーブルは tableNotFound を返す", async () => {
    const ds = build();
    const ghost = connectionName("ghost");
    expect(await ds.listSchemas(ghost)).toEqual(
      err({ kind: "connectionNotFound", connection: "ghost" }),
    );
    expect(await ds.listTables(ghost, publicSchema)).toEqual(
      err({ kind: "connectionNotFound", connection: "ghost" }),
    );
    expect(await ds.getTableDetail(ghost, usersRef)).toEqual(
      err({ kind: "connectionNotFound", connection: "ghost" }),
    );
    const missing = { schema: publicSchema, name: tableName("missing") };
    expect(await ds.getTableDetail(main, missing)).toEqual(
      err({ kind: "tableNotFound", table: missing }),
    );
    expect(await ds.fetchRows(main, rowsQuery({ table: missing }))).toEqual(
      err({ kind: "tableNotFound", table: missing }),
    );
    expect(await ds.countRows(main, missing, [], null)).toEqual(
      err({ kind: "tableNotFound", table: missing }),
    );
  });
});

describe("fetchRows", () => {
  it("カラムの名前と型、全行を、テーブルの定義順で返す", async () => {
    const result = unwrap(await build().fetchRows(main, rowsQuery()));
    expect(result.columns).toEqual([
      { name: "id", dbType: "integer" },
      { name: "name", dbType: "text" },
      { name: "age", dbType: "integer" },
      { name: "bio", dbType: "text" },
    ]);
    expect(result.rows).toEqual([
      ["1", "alice", "30", null],
      ["2", "bob", "25", "hello"],
      ["3", "carol", null, "abc"],
      ["10", "dave", "30", "a.c"],
    ]);
    expect(result.truncated).toBe(false);
    expect(result.truncatedCells).toEqual([]);
  });

  it("NULL と空文字を区別したまま返す", async () => {
    const withEmpty = memoryTable({
      name: "t",
      columns: [{ name: "v", dbType: "text" }],
      rows: [[null], [""]],
    });
    const ds = createMemoryDataSource({
      connections: [
        { name: "main", dialect: "sqlite", schemas: [{ name: "public", tables: [withEmpty] }] },
      ],
    });
    const result = unwrap(
      await ds.fetchRows(
        main,
        rowsQuery({ table: { schema: publicSchema, name: tableName("t") } }),
      ),
    );
    expect(result.rows).toEqual([[null], [""]]);
  });

  describe("並べ替えとページング", () => {
    it('数値として読める文字列は数値の順に並べる（"10" は "2" より後）', async () => {
      const ds = build();
      expect(await idsOf(ds, { sort: { column: col("id"), direction: "asc" } })).toEqual([
        "1",
        "2",
        "3",
        "10",
      ]);
      expect(await idsOf(ds, { sort: { column: col("id"), direction: "desc" } })).toEqual([
        "10",
        "3",
        "2",
        "1",
      ]);
    });

    it("文字列は辞書順に並べる", async () => {
      expect(await idsOf(build(), { sort: { column: col("name"), direction: "desc" } })).toEqual([
        "10",
        "3",
        "2",
        "1",
      ]);
    });

    it("NULL は昇順では最後、降順では最初に置き、同じ値の行は元の順を保つ", async () => {
      const ds = build();
      expect(await idsOf(ds, { sort: { column: col("age"), direction: "asc" } })).toEqual([
        "2",
        "1",
        "10",
        "3",
      ]);
      expect(await idsOf(ds, { sort: { column: col("age"), direction: "desc" } })).toEqual([
        "3",
        "1",
        "10",
        "2",
      ]);
    });

    it("offset と limit でページを切り出す", async () => {
      const ds = build();
      const sort = { column: col("id"), direction: "asc" } as const;
      expect(await idsOf(ds, { sort, limit: 2, offset: 1 })).toEqual(["2", "3"]);
      expect(await idsOf(ds, { sort, limit: 2, offset: 3 })).toEqual(["10"]);
      expect(await idsOf(ds, { sort, limit: 2, offset: 9 })).toEqual([]);
    });
  });

  describe("構造化フィルタ（すべて AND）", () => {
    const f = (column: string, op: Filter["op"], value?: string): Filter =>
      (op === "isNull"
        ? { column: col(column), op }
        : { column: col(column), op, value: value ?? "" }) as Filter;

    it.each([
      ["eq", [f("name", "eq", "bob")], ["2"]],
      ["neq（NULL は一致しない）", [f("age", "neq", "30")], ["2"]],
      ["lt（数値として比べる）", [f("age", "lt", "30")], ["2"]],
      ["gt（数値として比べる）", [f("id", "gt", "2")], ["3", "10"]],
      ["isNull", [f("bio", "isNull")], ["1"]],
      ["like の %", [f("name", "like", "%a%")], ["1", "3", "10"]],
      ["like の _", [f("name", "like", "_ob")], ["2"]],
      ["like は . を普通の文字として扱う", [f("bio", "like", "a.c")], ["10"]],
      ["like は大文字小文字を区別する", [f("name", "like", "ALICE")], []],
      ["複数条件は AND", [f("age", "eq", "30"), f("bio", "isNull")], ["1"]],
      ["条件なし", [], ["1", "2", "3", "10"]],
    ])("%s", async (_label, filters, expected) => {
      expect(await idsOf(build(), { filters })).toEqual(expected);
    });

    it("rawWhere は解釈できないので、query エラーにする（空なら無視）", async () => {
      const ds = build();
      const result = await ds.fetchRows(main, rowsQuery({ rawWhere: "age > 20" }));
      expect(!result.ok && result.error.kind).toBe("query");
      expect(unwrap(await ds.fetchRows(main, rowsQuery({ rawWhere: "  " }))).rows).toHaveLength(4);
    });

    it("存在しないカラムを使うと query エラーにする", async () => {
      const ds = build();
      const byFilter = await ds.fetchRows(main, rowsQuery({ filters: [f("nope", "eq", "x")] }));
      const bySort = await ds.fetchRows(
        main,
        rowsQuery({ sort: { column: col("nope"), direction: "asc" } }),
      );
      expect(!byFilter.ok && byFilter.error.kind).toBe("query");
      expect(!bySort.ok && bySort.error.kind).toBe("query");
    });
  });

  describe("上限と切り詰め", () => {
    it("要求したページが maxRows を超えたときだけ、打ち切って truncated にする", async () => {
      const ds = build({ maxRows: 2 });
      const over = unwrap(await ds.fetchRows(main, rowsQuery({ limit: 100 })));
      expect(over.rows).toHaveLength(2);
      expect(over.truncated).toBe(true);

      expect(unwrap(await ds.fetchRows(main, rowsQuery({ limit: 2 }))).truncated).toBe(false);
      expect(unwrap(await ds.fetchRows(main, rowsQuery({ limit: 3, offset: 3 }))).truncated).toBe(
        false,
      );
    });

    it("maxCellChars を超えたセルを切り詰め、その位置（返した行の中の位置）を返す", async () => {
      const docs = memoryTable({
        name: "docs",
        columns: [
          { name: "id", dbType: "integer", primaryKeyPosition: 1 },
          { name: "body", dbType: "text" },
        ],
        rows: [
          ["1", "short"],
          ["2", "abcdefghij"],
          ["3", "0123456789"],
        ],
      });
      const ds = createMemoryDataSource({
        maxCellChars: 5,
        connections: [
          { name: "main", dialect: "postgres", schemas: [{ name: "public", tables: [docs] }] },
        ],
      });
      const result = unwrap(
        await ds.fetchRows(
          main,
          rowsQuery({ table: { schema: publicSchema, name: tableName("docs") } }),
        ),
      );
      expect(result.rows).toEqual([
        ["1", "short"],
        ["2", "abcde"],
        ["3", "01234"],
      ]);
      expect(result.truncatedCells).toEqual([
        [1, 1],
        [2, 1],
      ]);

      const full = unwrap(
        await ds.fetchCell(
          main,
          { schema: publicSchema, name: tableName("docs") },
          { id: "2" },
          col("body"),
        ),
      );
      expect(full).toEqual({ value: "abcdefghij" });
    });
  });
});

describe("countRows", () => {
  it("フィルタを適用した件数を、精度を落とさない文字列で返す", async () => {
    const ds = build();
    expect(unwrap(await ds.countRows(main, usersRef, [], null))).toEqual({ count: "4" });
    expect(
      unwrap(
        await ds.countRows(main, usersRef, [{ column: col("age"), op: "eq", value: "30" }], null),
      ),
    ).toEqual({ count: "2" });
  });

  it("解釈できない rawWhere は query エラーにする", async () => {
    const result = await build().countRows(main, usersRef, [], "age > 1");
    expect(!result.ok && result.error.kind).toBe("query");
  });
});

describe("fetchCell", () => {
  const cell = (ds: DataSource, key: Record<string, string>, column: string, table = usersRef) =>
    ds.fetchCell(main, table, key, col(column));

  it("主キーで決まる 1 行のセルを返す。NULL も返せる", async () => {
    const ds = build();
    expect(unwrap(await cell(ds, { id: "2" }, "bio"))).toEqual({ value: "hello" });
    expect(unwrap(await cell(ds, { id: "1" }, "bio"))).toEqual({ value: null });
  });

  it("複合主キーは、すべての列がそろったときだけ引ける", async () => {
    const ds = build();
    const ref = { schema: publicSchema, name: tableName("members") };
    expect(unwrap(await cell(ds, { tenant: "b", id: "1" }, "note", ref))).toEqual({
      value: "third",
    });
    const partial = await cell(ds, { id: "1" }, "note", ref);
    expect(!partial.ok && partial.error.kind).toBe("query");
  });

  it.each([
    ["該当する行がない", { id: "999" }, "bio"],
    ["主キーではない列を指定した", { name: "bob" }, "bio"],
    ["主キーが空", {}, "bio"],
    ["存在しないカラム", { id: "1" }, "nope"],
  ])("%s ときは query エラーにする", async (_label, key, column) => {
    const result = await cell(build(), key, column);
    expect(!result.ok && result.error.kind).toBe("query");
  });
});

describe("fetchCell: 主キーが重複した不正なデータ", () => {
  it("主キーで 1 行に決まらないときは、先頭の行を返さず query エラーにする", async () => {
    const duplicated = memoryTable({
      name: "dup",
      columns: [
        { name: "id", dbType: "integer", primaryKeyPosition: 1 },
        { name: "note", dbType: "text" },
      ],
      rows: [
        ["1", "first"],
        ["1", "second"],
      ],
    });
    const ds = createMemoryDataSource({
      connections: [
        { name: "main", dialect: "postgres", schemas: [{ name: "public", tables: [duplicated] }] },
      ],
    });
    const result = await ds.fetchCell(
      main,
      { schema: publicSchema, name: tableName("dup") },
      { id: "1" },
      col("note"),
    );
    expect(!result.ok && result.error.kind).toBe("query");
  });
});

describe("executeQuery", () => {
  const outcome: QueryOutcome = { kind: "command", affectedRows: 1, elapsedMs: 2 };
  const id: QueryId = queryId("q-1");

  it("渡された execute に、接続と SQL をそのまま渡して結果を返す", async () => {
    const execute = vi.fn(async () => ok(outcome));
    const result = await build({ execute }).executeQuery(main, "update t set a = 1", id);
    expect(result).toEqual(ok(outcome));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ name: "main", dialect: "postgres" }),
      "update t set a = 1",
    );
  });

  it("execute が同期的に値を返してもよい", async () => {
    expect(await build({ execute: () => ok(outcome) }).executeQuery(main, "select 1", id)).toEqual(
      ok(outcome),
    );
  });

  it("execute が失敗を返したら、そのまま返す", async () => {
    const failure = err({ kind: "timeout", timeoutMs: 30000 } as const);
    expect(await build({ execute: () => failure }).executeQuery(main, "select 1", id)).toEqual(
      failure,
    );
  });

  it("2 文目があれば multipleStatements を返し、execute は呼ばない", async () => {
    const execute = vi.fn(() => ok(outcome));
    const ds = build({ execute });
    expect(await ds.executeQuery(main, "select 1; select 2", id)).toEqual(
      err({ kind: "multipleStatements" }),
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("複数文かどうかは、接続の方言で判定する", async () => {
    const execute = vi.fn(() => ok(outcome));
    const ds = build({ execute });
    const dollar = "do $$ begin perform 1; perform 2; end $$";
    expect(await ds.executeQuery(main, dollar, id)).toEqual(ok(outcome));
    expect(await ds.executeQuery(connectionName("lite"), dollar, id)).toEqual(
      err({ kind: "multipleStatements" }),
    );
  });

  it("execute を渡していなければ、query エラーにする", async () => {
    const result = await build().executeQuery(main, "select 1", id);
    expect(!result.ok && result.error.kind).toBe("query");
  });

  it("存在しない接続は connectionNotFound を返す", async () => {
    expect(await build().executeQuery(connectionName("ghost"), "select 1", id)).toEqual(
      err({ kind: "connectionNotFound", connection: "ghost" }),
    );
  });
});

describe("cancelQuery", () => {
  it("中断できる接続では、実行中のクエリがないので cancelled: false を返す", async () => {
    expect(await build().cancelQuery(main, queryId("q"))).toEqual(ok({ cancelled: false }));
  });

  it("中断できない接続では unsupported を返す", async () => {
    expect(await build().cancelQuery(connectionName("lite"), queryId("q"))).toEqual(
      err({ kind: "unsupported", feature: "cancel" }),
    );
  });
});

describe("HTTP を経由しても同じ結果になる（スキーマとクライアントとの整合）", () => {
  // サーバーの役目を、メモリ版の DataSource で代わりに果たす偽の fetch。
  const serve = (ds: DataSource): typeof fetch =>
    (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const request: RpcRequest = v.parse(RpcRequestSchema, JSON.parse(String(init?.body)));
      const result = await dispatch(ds, request);
      return new Response(
        JSON.stringify(
          result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error },
        ),
      );
    }) as typeof fetch;

  const dispatch = (ds: DataSource, request: RpcRequest): Promise<DbResult<unknown>> => {
    switch (request.op) {
      case "listConnections":
        return ds.listConnections();
      case "listSchemas":
        return ds.listSchemas(request.connection);
      case "listTables":
        return ds.listTables(request.connection, request.schema);
      case "getTableDetail":
        return ds.getTableDetail(request.connection, request.table);
      case "fetchRows":
        return ds.fetchRows(request.connection, request.query);
      case "countRows":
        return ds.countRows(request.connection, request.table, request.filters, request.rawWhere);
      case "fetchCell":
        return ds.fetchCell(request.connection, request.table, request.primaryKey, request.column);
      case "executeQuery":
        return ds.executeQuery(request.connection, request.sql, request.queryId);
      case "cancelQuery":
        return ds.cancelQuery(request.connection, request.queryId);
    }
  };

  it("メタデータ・行・件数・セル・エラーが、直接呼んだときと一致する", async () => {
    const direct = build({ execute: () => ok({ kind: "command", affectedRows: 0, elapsedMs: 1 }) });
    const viaHttp = createHttpDataSource({ endpoint: "/rpc", fetch: serve(direct) });
    const query = rowsQuery({
      filters: [{ column: col("age"), op: "eq", value: "30" }],
      sort: { column: col("id"), direction: "desc" },
    });
    const missing = { schema: publicSchema, name: tableName("missing") };

    expect(await viaHttp.listConnections()).toEqual(await direct.listConnections());
    expect(await viaHttp.listTables(main, publicSchema)).toEqual(
      await direct.listTables(main, publicSchema),
    );
    expect(await viaHttp.getTableDetail(main, usersRef)).toEqual(
      await direct.getTableDetail(main, usersRef),
    );
    expect(await viaHttp.fetchRows(main, query)).toEqual(await direct.fetchRows(main, query));
    expect(await viaHttp.countRows(main, usersRef, [], null)).toEqual(
      await direct.countRows(main, usersRef, [], null),
    );
    expect(await viaHttp.fetchCell(main, usersRef, { id: "2" }, col("bio"))).toEqual(
      ok({ value: "hello" }),
    );
    expect(await viaHttp.executeQuery(main, "delete from t", queryId("q"))).toEqual(
      ok({ kind: "command", affectedRows: 0, elapsedMs: 1 }),
    );
    expect(await viaHttp.executeQuery(main, "select 1; select 2", queryId("q"))).toEqual(
      err({ kind: "multipleStatements" }),
    );
    expect(await viaHttp.getTableDetail(main, missing)).toEqual(
      err({ kind: "tableNotFound", table: missing }),
    );
  });
});
