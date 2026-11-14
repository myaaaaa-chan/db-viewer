import * as v from "valibot";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataSource } from "./data-source";
import type { ConnectionInfo, QueryOutcome, ResultSet } from "./domain";
import { createHttpDataSource } from "./http-data-source";
import {
  type ColumnName,
  columnName,
  connectionName,
  queryId,
  schemaName,
  tableName,
} from "./names";
import { err, ok } from "./result";
import { RpcRequestSchema } from "./rpc";

type SentRequest = {
  readonly url: string;
  readonly init: RequestInit;
  readonly headers: Headers;
  readonly body: unknown;
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// 送られたリクエストを記録し、応答は handler が決める偽の fetch。
const fakeFetch = (handler: (sent: SentRequest) => Response | Promise<Response>) => {
  const sent: Array<SentRequest> = [];
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request: SentRequest = {
      url: String(input),
      init: init ?? {},
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    sent.push(request);
    return handler(request);
  };
  return { fetch: fetchFn as typeof fetch, sent };
};

const main = connectionName("main");
const table = { schema: schemaName("public"), name: tableName("users") };
const idColumn: ColumnName = columnName("id");

const emptyResultSet: ResultSet = { columns: [], rows: [], truncated: false, truncatedCells: [] };

describe("createHttpDataSource: リクエスト", () => {
  const calls: ReadonlyArray<readonly [string, (ds: DataSource) => Promise<unknown>, unknown]> = [
    ["listConnections", (ds) => ds.listConnections(), { op: "listConnections" }],
    ["listSchemas", (ds) => ds.listSchemas(main), { op: "listSchemas", connection: "main" }],
    [
      "listTables",
      (ds) => ds.listTables(main, schemaName("public")),
      { op: "listTables", connection: "main", schema: "public" },
    ],
    [
      "getTableDetail",
      (ds) => ds.getTableDetail(main, table),
      { op: "getTableDetail", connection: "main", table },
    ],
    [
      "fetchRows",
      (ds) =>
        ds.fetchRows(main, {
          table,
          filters: [{ column: idColumn, op: "gt", value: "10" }],
          rawWhere: "name <> ''",
          sort: { column: idColumn, direction: "desc" },
          limit: 100,
          offset: 200,
        }),
      {
        op: "fetchRows",
        connection: "main",
        query: {
          table,
          filters: [{ column: "id", op: "gt", value: "10" }],
          rawWhere: "name <> ''",
          sort: { column: "id", direction: "desc" },
          limit: 100,
          offset: 200,
        },
      },
    ],
    [
      "countRows",
      (ds) => ds.countRows(main, table, [{ column: idColumn, op: "isNull" }], null),
      {
        op: "countRows",
        connection: "main",
        table,
        filters: [{ column: "id", op: "isNull" }],
        rawWhere: null,
      },
    ],
    [
      "fetchCell",
      (ds) => ds.fetchCell(main, table, { id: "7" }, columnName("bio")),
      { op: "fetchCell", connection: "main", table, primaryKey: { id: "7" }, column: "bio" },
    ],
    [
      "executeQuery",
      (ds) => ds.executeQuery(main, "select 1", queryId("q-1")),
      { op: "executeQuery", connection: "main", sql: "select 1", queryId: "q-1" },
    ],
    [
      "cancelQuery",
      (ds) => ds.cancelQuery(main, queryId("q-1")),
      { op: "cancelQuery", connection: "main", queryId: "q-1" },
    ],
  ];

  it.each(calls)(
    "%s は endpoint に op を指定した JSON を POST する",
    async (_name, call, expected) => {
      const { fetch, sent } = fakeFetch(() => json({ ok: true, value: null }));
      await call(createHttpDataSource({ endpoint: "/admin/db", fetch }));

      expect(sent).toHaveLength(1);
      expect(sent[0]?.url).toBe("/admin/db");
      expect(sent[0]?.init.method).toBe("POST");
      expect(sent[0]?.headers.get("Content-Type")).toBe("application/json");
      expect(sent[0]?.body).toEqual(expected);
    },
  );

  it.each(calls)(
    "%s が送る本文は、サーバーが使う RpcRequestSchema を満たす",
    async (_name, call) => {
      const { fetch, sent } = fakeFetch(() => json({ ok: true, value: null }));
      await call(createHttpDataSource({ endpoint: "/api", fetch }));
      expect(v.safeParse(RpcRequestSchema, sent[0]?.body).success).toBe(true);
    },
  );

  it("headers の戻り値（同期でも非同期でも）を送り、リクエストのたびに呼び直す", async () => {
    const { fetch, sent } = fakeFetch(() => json({ ok: true, value: [] }));
    let token = 0;
    const ds = createHttpDataSource({
      endpoint: "/api",
      fetch,
      headers: async () => ({ Authorization: `Bearer t${++token}` }),
    });
    await ds.listConnections();
    await ds.listConnections();
    expect(sent.map((s) => s.headers.get("Authorization"))).toEqual(["Bearer t1", "Bearer t2"]);

    const sync = fakeFetch(() => json({ ok: true, value: [] }));
    await createHttpDataSource({
      endpoint: "/api",
      fetch: sync.fetch,
      headers: () => [["X-Trace", "abc"]],
    }).listConnections();
    expect(sync.sent[0]?.headers.get("X-Trace")).toBe("abc");
  });

  it("利用者が Content-Type を渡しても、JSON として送る", async () => {
    const { fetch, sent } = fakeFetch(() => json({ ok: true, value: [] }));
    await createHttpDataSource({
      endpoint: "/api",
      fetch,
      headers: () => ({ "Content-Type": "text/plain" }),
    }).listConnections();
    expect(sent[0]?.headers.get("Content-Type")).toBe("application/json");
  });

  it("fetch を渡さなければ、呼び出し時点の globalThis.fetch を使う", async () => {
    const { fetch, sent } = fakeFetch(() => json({ ok: true, value: [] }));
    const ds = createHttpDataSource({ endpoint: "/api" });
    vi.stubGlobal("fetch", fetch);
    await ds.listConnections();
    expect(sent).toHaveLength(1);
  });

  it("渡された fetch を、オプションのメソッドとしてではなく単独の関数として呼ぶ（this に依存する fetch を壊さない）", async () => {
    let receivedThis: unknown = "unset";
    const options = {
      endpoint: "/api",
      fetch: function (this: unknown) {
        receivedThis = this;
        return Promise.resolve(json({ ok: true, value: [] }));
      } as unknown as typeof fetch,
    };
    await createHttpDataSource(options).listConnections();
    expect(receivedThis).not.toBe(options);
  });
});

describe("createHttpDataSource: レスポンスの変換", () => {
  const connections: ReadonlyArray<ConnectionInfo> = [
    { name: main, dialect: "postgres", readOnly: true, capabilities: { cancel: true } },
  ];

  it("成功の応答は、値をそのまま ok で返す", async () => {
    const { fetch } = fakeFetch(() => json({ ok: true, value: connections }));
    const result = await createHttpDataSource({ endpoint: "/api", fetch }).listConnections();
    expect(result).toEqual(ok(connections));
  });

  it("null や空の値も成功の値として返す", async () => {
    const { fetch } = fakeFetch(() => json({ ok: true, value: { value: null } }));
    const result = await createHttpDataSource({ endpoint: "/api", fetch }).fetchCell(
      main,
      table,
      { id: "1" },
      columnName("bio"),
    );
    expect(result).toEqual(ok({ value: null }));
  });

  it("結果表も、値の型を変えずに返す", async () => {
    const outcome: QueryOutcome = { kind: "rows", ...emptyResultSet, elapsedMs: 3 };
    const { fetch } = fakeFetch(() => json({ ok: true, value: outcome }));
    const result = await createHttpDataSource({ endpoint: "/api", fetch }).executeQuery(
      main,
      "select 1",
      queryId("q"),
    );
    expect(result).toEqual(ok(outcome));
  });

  it("HTTP 200 のドメインのエラー（query など）は、そのまま err で返す", async () => {
    const error = {
      kind: "query",
      message: "syntax error",
      sqlState: "42601",
      position: 7,
    } as const;
    const { fetch } = fakeFetch(() => json({ ok: false, error }));
    const result = await createHttpDataSource({ endpoint: "/api", fetch }).executeQuery(
      main,
      "selec 1",
      queryId("q"),
    );
    expect(result).toEqual(err(error));
  });

  it("401 は、本文が何であっても unauthorized にする", async () => {
    for (const response of [
      () => new Response("", { status: 401 }),
      () => new Response("<html>nope</html>", { status: 401 }),
      () => json({ ok: false, error: { kind: "unauthorized" } }, 401),
    ]) {
      const { fetch } = fakeFetch(response);
      const result = await createHttpDataSource({ endpoint: "/api", fetch }).listConnections();
      expect(result).toEqual(err({ kind: "unauthorized" }));
    }
  });

  it("400 でサーバーが invalidRequest を返したら、そのまま渡す", async () => {
    const error = { kind: "invalidRequest", issues: ["op: Invalid key"] } as const;
    const { fetch } = fakeFetch(() => json({ ok: false, error }, 400));
    const result = await createHttpDataSource({ endpoint: "/api", fetch }).listConnections();
    expect(result).toEqual(err(error));
  });

  it.each([404, 405])("%i で本文が応答の形ではないときは internal にする", async (status) => {
    const { fetch } = fakeFetch(() => new Response("Method Not Allowed", { status }));
    const result = await createHttpDataSource({ endpoint: "/api", fetch }).listConnections();
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe("internal");
    expect(!result.ok && result.error.kind === "internal" && result.error.message).toContain(
      String(status),
    );
  });

  it.each([500, 502, 503])(
    "%i は internal にし、本文（秘密を含みうる）は載せない",
    async (status) => {
      const { fetch } = fakeFetch(
        () =>
          new Response("Error: ECONNREFUSED postgres://user:secret@db/prod\n  at stack", {
            status,
          }),
      );
      const result = await createHttpDataSource({ endpoint: "/api", fetch }).listConnections();
      expect(result.ok).toBe(false);
      if (result.ok || result.error.kind !== "internal") throw new Error("expected internal error");
      expect(result.error.message).toContain(String(status));
      expect(result.error.message).not.toContain("secret");
    },
  );

  it("5xx で本文が正しい応答の形でも、internal にする", async () => {
    const { fetch } = fakeFetch(() => json({ ok: true, value: [] }, 502));
    const result = await createHttpDataSource({ endpoint: "/api", fetch }).listConnections();
    expect(!result.ok && result.error.kind).toBe("internal");
  });

  it("2xx 以外で ok: true の本文が来たら、成功として扱わず internal にする", async () => {
    const { fetch } = fakeFetch(() => json({ ok: true, value: [] }, 400));
    const result = await createHttpDataSource({ endpoint: "/api", fetch }).listConnections();
    expect(!result.ok && result.error.kind).toBe("internal");
  });

  it.each([
    ["壊れた JSON", () => new Response("{not json", { status: 200 })],
    ["空の本文", () => new Response("", { status: 200 })],
    ["HTML", () => new Response("<html></html>", { status: 200 })],
    ["応答の形ではない JSON", () => json({ hello: "world" })],
    ["配列", () => json([])],
    ["null", () => json(null)],
    ["ok が真偽値でない", () => json({ ok: "true", value: [] })],
    ["ok: true で value がない", () => json({ ok: true })],
    ["ok: false で error が知らない種類", () => json({ ok: false, error: { kind: "weird" } })],
    ["ok: false で error がない", () => json({ ok: false })],
  ])("200 でも %s なら、例外を投げず internal にする", async (_label, response) => {
    const { fetch } = fakeFetch(response);
    const result = await createHttpDataSource({ endpoint: "/api", fetch }).listConnections();
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe("internal");
  });
});

describe("createHttpDataSource: 通信と準備の失敗", () => {
  it("fetch が reject（接続できないなど）しても、例外にせず internal にして原因を残す", async () => {
    const fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof globalThis.fetch;
    const result = await createHttpDataSource({ endpoint: "/api", fetch }).listConnections();
    expect(result.ok).toBe(false);
    if (result.ok || result.error.kind !== "internal") throw new Error("expected internal error");
    expect(result.error.message).toContain("Failed to fetch");
  });

  it("fetch が同期的に投げても、internal にする", async () => {
    const fetch = (() => {
      throw new Error("sync boom");
    }) as typeof globalThis.fetch;
    const result = await createHttpDataSource({ endpoint: "/api", fetch }).listConnections();
    expect(!result.ok && result.error.kind).toBe("internal");
  });

  it("本文の読み取りに失敗しても、internal にする", async () => {
    const fetch = (async () => {
      const response = new Response("x");
      response.text = () => Promise.reject(new Error("stream aborted"));
      return response;
    }) as typeof globalThis.fetch;
    const result = await createHttpDataSource({ endpoint: "/api", fetch }).listConnections();
    expect(!result.ok && result.error.kind).toBe("internal");
  });

  it("headers が失敗したら、リクエストを送らずに internal にする", async () => {
    const { fetch, sent } = fakeFetch(() => json({ ok: true, value: [] }));
    const result = await createHttpDataSource({
      endpoint: "/api",
      fetch,
      headers: async () => {
        throw new Error("token refresh failed");
      },
    }).listConnections();
    expect(sent).toHaveLength(0);
    if (result.ok || result.error.kind !== "internal") throw new Error("expected internal error");
    expect(result.error.message).toContain("token refresh failed");
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
