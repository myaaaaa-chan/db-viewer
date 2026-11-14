import { err, ok, schemaName, tableName } from "@myaaaaa_chan/db-viewer-core";
import { describe, expect, it, vi } from "vitest";
import type { DbAdapter } from "./adapter";
import { createHandler } from "./handler";
import { DEFAULT_LIMITS } from "./limits";
import { createFakeAdapter } from "./testing/fake-adapter";

const URL = "http://localhost/admin/db";

const post = (body: unknown, headers: Record<string, string> = {}): Request =>
  new Request(URL, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const jsonOf = async (response: Response): Promise<unknown> => response.json();

const allow = () => true;

describe("createHandler: 入口の検査", () => {
  it.each(["GET", "PUT", "DELETE", "PATCH"])(
    "%s は 405。認証より先に判定し、Allow: POST を返す",
    async (method) => {
      const authorize = vi.fn(allow);
      const handler = createHandler({ connections: { main: createFakeAdapter() }, authorize });
      const response = await handler(new Request(URL, { method }));
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
      expect(await jsonOf(response)).toMatchObject({
        ok: false,
        error: { kind: "invalidRequest" },
      });
      expect(authorize).not.toHaveBeenCalled();
    },
  );

  it("authorize が false なら 401 で、本文は読まずアダプターも呼ばない", async () => {
    const adapter = createFakeAdapter({ listSchemas: vi.fn(async () => ok([])) });
    const handler = createHandler({ connections: { main: adapter }, authorize: () => false });
    const response = await handler(post("{ broken json"));
    expect(response.status).toBe(401);
    expect(await jsonOf(response)).toEqual({ ok: false, error: { kind: "unauthorized" } });
    expect(adapter.listSchemas).not.toHaveBeenCalled();
  });

  it("authorize には受け取った Request がそのまま渡り、非同期の結果も待つ", async () => {
    const seen: Array<string | null> = [];
    const handler = createHandler({
      connections: { main: createFakeAdapter() },
      authorize: async (request) => {
        seen.push(request.headers.get("authorization"));
        return request.headers.get("authorization") === "Bearer ok";
      },
    });
    const denied = await handler(post({ op: "listConnections" }, { authorization: "Bearer no" }));
    const granted = await handler(post({ op: "listConnections" }, { authorization: "Bearer ok" }));
    expect(denied.status).toBe(401);
    expect(granted.status).toBe(200);
    expect(seen).toEqual(["Bearer no", "Bearer ok"]);
  });

  it("authorize が例外を投げたら 500 の internal。何も実行せず、例外の中身は漏らさない", async () => {
    const adapter = createFakeAdapter({ listSchemas: vi.fn(async () => ok([])) });
    const handler = createHandler({
      connections: { main: adapter },
      authorize: () => {
        throw new Error("session store down: password=hunter2");
      },
    });
    const response = await handler(post({ op: "listSchemas", connection: "main" }));
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ ok: false, error: { kind: "internal" } });
    expect(text).not.toContain("hunter2");
    expect(adapter.listSchemas).not.toHaveBeenCalled();
  });

  it("Content-Type が application/json でなければ 400（text/plain の form からの CSRF を防ぐ）", async () => {
    const adapter = createFakeAdapter({
      execute: vi.fn(async () => ok({ kind: "command" as const, affectedRows: 1, elapsedMs: 0 })),
    });
    const handler = createHandler({ connections: { main: adapter }, authorize: allow });
    const body = JSON.stringify({
      op: "executeQuery",
      connection: "main",
      sql: "delete from t",
      queryId: "q1",
    });
    for (const contentType of ["text/plain", "application/x-www-form-urlencoded", ""]) {
      const response = await handler(
        new Request(URL, {
          method: "POST",
          headers: contentType ? { "content-type": contentType } : {},
          body,
        }),
      );
      expect(response.status).toBe(400);
      expect(await jsonOf(response)).toMatchObject({
        ok: false,
        error: { kind: "invalidRequest" },
      });
    }
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it("charset 付きの application/json は受け付ける", async () => {
    const handler = createHandler({ connections: { main: createFakeAdapter() }, authorize: allow });
    const response = await handler(
      post({ op: "listConnections" }, { "content-type": "application/json; charset=utf-8" }),
    );
    expect(response.status).toBe(200);
  });

  it("壊れた JSON は 400 invalidRequest", async () => {
    const handler = createHandler({ connections: { main: createFakeAdapter() }, authorize: allow });
    const response = await handler(post("{ not json"));
    expect(response.status).toBe(400);
    expect(await jsonOf(response)).toMatchObject({ ok: false, error: { kind: "invalidRequest" } });
  });

  it("スキーマに合わない入力は 400 で、どこが悪いかを issues に入れる", async () => {
    const handler = createHandler({ connections: { main: createFakeAdapter() }, authorize: allow });
    const response = await handler(post({ op: "listTables", connection: "main" }));
    expect(response.status).toBe(400);
    const body = (await jsonOf(response)) as { error: { kind: string; issues: Array<string> } };
    expect(body.error.kind).toBe("invalidRequest");
    expect(body.error.issues.join("\n")).toContain("schema");
  });

  it("未知の op は 400", async () => {
    const handler = createHandler({ connections: { main: createFakeAdapter() }, authorize: allow });
    const response = await handler(post({ op: "dropEverything", connection: "main" }));
    expect(response.status).toBe(400);
  });

  it("応答は JSON で、キャッシュさせない", async () => {
    const handler = createHandler({ connections: { main: createFakeAdapter() }, authorize: allow });
    const response = await handler(post({ op: "listConnections" }));
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("createHandler: 接続の振り分け", () => {
  it("listConnections は接続名・方言・readOnly と、アダプターの capabilities をそのまま返す", async () => {
    const handler = createHandler({
      connections: {
        a: createFakeAdapter({ dialect: "sqlite", readOnly: true }),
        b: createFakeAdapter({
          dialect: "postgres",
          readOnly: false,
          capabilities: { cancel: true, enforcesTimeout: true },
        }),
      },
      authorize: allow,
    });
    const response = await handler(post({ op: "listConnections" }));
    expect(response.status).toBe(200);
    expect(await jsonOf(response)).toEqual({
      ok: true,
      value: [
        {
          name: "a",
          dialect: "sqlite",
          readOnly: true,
          capabilities: { cancel: false, enforcesTimeout: false },
        },
        {
          name: "b",
          dialect: "postgres",
          readOnly: false,
          capabilities: { cancel: true, enforcesTimeout: true },
        },
      ],
    });
  });

  it("存在しない接続名は 200 の connectionNotFound", async () => {
    const handler = createHandler({ connections: { main: createFakeAdapter() }, authorize: allow });
    const response = await handler(post({ op: "listSchemas", connection: "nope" }));
    expect(response.status).toBe(200);
    expect(await jsonOf(response)).toEqual({
      ok: false,
      error: { kind: "connectionNotFound", connection: "nope" },
    });
  });

  it.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
    "Object.prototype にある名前 %s を接続名として使えない",
    async (name) => {
      const handler = createHandler({
        connections: { main: createFakeAdapter() },
        authorize: allow,
      });
      const response = await handler(post({ op: "listSchemas", connection: name }));
      expect(response.status).toBe(200);
      expect(await jsonOf(response)).toMatchObject({
        ok: false,
        error: { kind: "connectionNotFound", connection: name },
      });
    },
  );

  it("接続名で選んだアダプターだけを呼ぶ", async () => {
    const a = createFakeAdapter({ listSchemas: vi.fn(async () => ok([schemaName("a_schema")])) });
    const b = createFakeAdapter({ listSchemas: vi.fn(async () => ok([schemaName("b_schema")])) });
    const handler = createHandler({ connections: { a, b }, authorize: allow });
    const response = await handler(post({ op: "listSchemas", connection: "b" }));
    expect(await jsonOf(response)).toEqual({ ok: true, value: ["b_schema"] });
    expect(a.listSchemas).not.toHaveBeenCalled();
  });
});

describe("createHandler: op ごとの振り分け", () => {
  const table = { schema: "main", name: "users" };
  const tableRef = { schema: schemaName("main"), name: tableName("users") };

  it("各 op が、対応するアダプターのメソッドに引数と limits を渡し、結果を ok で包んで返す", async () => {
    const adapter = createFakeAdapter({
      listTables: vi.fn(async () => ok([{ ref: tableRef, kind: "table" as const }])),
      getTableDetail: vi.fn(async (ref) =>
        ok({
          summary: { ref, kind: "view" as const },
          columns: [],
          indexes: [],
          foreignKeys: [],
          ddl: { text: "CREATE VIEW", approximate: false },
        }),
      ),
      fetchRows: vi.fn(async () =>
        ok({
          columns: [{ name: "id", dbType: "INTEGER" }],
          rows: [["1"]],
          truncated: false,
          truncatedCells: [],
        }),
      ),
      countRows: vi.fn(async () => ok({ count: "12345678901234567890" })),
      fetchCell: vi.fn(async () => ok({ value: "full text" })),
      execute: vi.fn(async () => ok({ kind: "command" as const, affectedRows: 3, elapsedMs: 5 })),
      cancel: vi.fn(async () => ok({ cancelled: true })),
    });
    const handler = createHandler({
      connections: { main: adapter },
      authorize: allow,
      limits: { maxRows: 7 },
    });
    const limits = { ...DEFAULT_LIMITS, maxRows: 7 };
    const call = async (request: object) =>
      jsonOf(await handler(post({ connection: "main", ...request })));

    expect(await call({ op: "listTables", schema: "main" })).toMatchObject({
      ok: true,
      value: [{ kind: "table" }],
    });
    expect(adapter.listTables).toHaveBeenCalledWith("main");

    expect(await call({ op: "getTableDetail", table })).toMatchObject({
      ok: true,
      value: { summary: { kind: "view" } },
    });
    expect(adapter.getTableDetail).toHaveBeenCalledWith(table);

    const query = { table, filters: [], rawWhere: null, sort: null, limit: 10, offset: 0 };
    expect(await call({ op: "fetchRows", query })).toMatchObject({
      ok: true,
      value: { rows: [["1"]] },
    });
    expect(adapter.fetchRows).toHaveBeenCalledWith(query, limits);

    const filters = [{ column: "id", op: "gt", value: "1" }];
    expect(await call({ op: "countRows", table, filters, rawWhere: "x = 1" })).toEqual({
      ok: true,
      value: { count: "12345678901234567890" },
    });
    expect(adapter.countRows).toHaveBeenCalledWith(table, filters, "x = 1", limits);

    expect(await call({ op: "fetchCell", table, primaryKey: { id: "1" }, column: "body" })).toEqual(
      {
        ok: true,
        value: { value: "full text" },
      },
    );
    expect(adapter.fetchCell).toHaveBeenCalledWith(table, { id: "1" }, "body", limits);

    expect(await call({ op: "executeQuery", sql: "update t set a = 1", queryId: "q-1" })).toEqual({
      ok: true,
      value: { kind: "command", affectedRows: 3, elapsedMs: 5 },
    });
    expect(adapter.execute).toHaveBeenCalledWith("update t set a = 1", "q-1", limits);

    expect(await call({ op: "cancelQuery", queryId: "q-1" })).toEqual({
      ok: true,
      value: { cancelled: true },
    });
    expect(adapter.cancel).toHaveBeenCalledWith("q-1");
  });

  it("アダプターが返した失敗は、そのまま 200 の ok:false で返す（SQL のエラーは HTTP のエラーにしない）", async () => {
    const error = {
      kind: "query" as const,
      message: "no such table: x",
      sqlState: "SQLITE_ERROR",
      position: null,
    };
    const handler = createHandler({
      connections: { main: createFakeAdapter({ execute: async () => err(error) }) },
      authorize: allow,
    });
    const response = await handler(
      post({ op: "executeQuery", connection: "main", sql: "select * from x", queryId: "q" }),
    );
    expect(response.status).toBe(200);
    expect(await jsonOf(response)).toEqual({ ok: false, error });
  });

  it("アダプターが例外を投げたら 500 の internal。例外の message や接続情報は応答に含めない", async () => {
    const handler = createHandler({
      connections: {
        main: createFakeAdapter({
          execute: async () => {
            throw new Error("connect ECONNREFUSED postgres://admin:s3cret@10.0.0.5/app");
          },
        }),
      },
      authorize: allow,
    });
    const response = await handler(
      post({ op: "executeQuery", connection: "main", sql: "select 1", queryId: "q" }),
    );
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ ok: false, error: { kind: "internal" } });
    expect(text).not.toContain("s3cret");
    expect(text).not.toContain("10.0.0.5");
    expect(text).not.toContain("ECONNREFUSED");
  });

  it("結果が JSON にできない（アダプターの不具合）場合も、500 の internal にする", async () => {
    const handler = createHandler({
      connections: {
        main: createFakeAdapter({ countRows: async () => ok({ count: 10n as unknown as string }) }),
      },
      authorize: allow,
    });
    const response = await handler(
      post({ op: "countRows", connection: "main", table, filters: [], rawWhere: null }),
    );
    expect(response.status).toBe(500);
    expect(await jsonOf(response)).toMatchObject({ ok: false, error: { kind: "internal" } });
  });
});

describe("createHandler: 設定", () => {
  it("limits の指定が不正なら、リクエストを待たず作成時に投げる", () => {
    expect(() =>
      createHandler({ connections: {}, authorize: allow, limits: { maxRows: 0 } }),
    ).toThrow(/maxRows/);
  });

  it.each([undefined, null, true, "yes", {}])(
    "authorize が関数でなければ（%s）、リクエストを待たず作成時に TypeError を投げる",
    (authorize) => {
      expect(() =>
        createHandler({ connections: {}, authorize } as unknown as Parameters<
          typeof createHandler
        >[0]),
      ).toThrow(TypeError);
      expect(() =>
        createHandler({ connections: {}, authorize } as unknown as Parameters<
          typeof createHandler
        >[0]),
      ).toThrow(/authorize/);
    },
  );

  it("limits を省略するとき、既定値をアダプターに渡す", async () => {
    const fetchRows = vi.fn<DbAdapter["fetchRows"]>(async () =>
      ok({ columns: [], rows: [], truncated: false, truncatedCells: [] }),
    );
    const handler = createHandler({
      connections: { main: createFakeAdapter({ fetchRows }) },
      authorize: allow,
    });
    await handler(
      post({
        op: "fetchRows",
        connection: "main",
        query: {
          table: { schema: "main", name: "t" },
          filters: [],
          rawWhere: null,
          sort: null,
          limit: 1,
          offset: 0,
        },
      }),
    );
    expect(fetchRows.mock.calls[0]?.[1]).toEqual({
      maxRows: 1000,
      statementTimeoutMs: 30_000,
      maxCellChars: 10_000,
      maxConcurrentQueries: 2,
    });
  });
});
