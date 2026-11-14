import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  connectionName,
  createHttpDataSource,
  generateQueryId,
} from "@myaaaaa_chan/db-viewer-core";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { sqliteAdapter } from "./adapters/sqlite";
import { createHandler } from "./handler";
import { toNodeHandler } from "./node";

const servers: Array<Server> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        }),
    ),
  );
});

// node:http の本物のサーバーに載せる。Node 以外の実行環境を想定した handler 本体のテストは handler.test.ts にある。
const listen = async (handler: ReturnType<typeof createHandler>) => {
  const server = createServer(toNodeHandler(handler));
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/admin/db`;
};

describe("toNodeHandler", () => {
  it("node:http のサーバーに載せると、core の HTTP クライアントから POST が通り、認証と SQL の実行ができる", async () => {
    const db = new Database(":memory:");
    db.exec(
      "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO t VALUES (1, 'あ'), (2, NULL)",
    );
    const endpoint = await listen(
      createHandler({
        connections: { main: sqliteAdapter(db) },
        authorize: (request) => request.headers.get("authorization") === "Bearer secret",
      }),
    );

    const client = createHttpDataSource({
      endpoint,
      headers: () => ({ authorization: "Bearer secret" }),
    });
    const connections = await client.listConnections();
    expect(connections).toEqual({
      ok: true,
      value: [
        {
          name: "main",
          dialect: "sqlite",
          readOnly: true,
          capabilities: { cancel: false, enforcesTimeout: false },
        },
      ],
    });

    const outcome = await client.executeQuery(
      connectionName("main"),
      "SELECT id, name FROM t ORDER BY id",
      generateQueryId(),
    );
    expect(outcome.ok && outcome.value).toMatchObject({
      kind: "rows",
      rows: [
        ["1", "あ"],
        ["2", null],
      ],
    });

    const unauthorized = await createHttpDataSource({ endpoint }).listConnections();
    expect(unauthorized).toEqual({ ok: false, error: { kind: "unauthorized" } });
  });

  it("POST 以外は 405 が、Node のサーバーからもそのまま返る", async () => {
    const endpoint = await listen(createHandler({ connections: {}, authorize: () => true }));
    const response = await fetch(endpoint);
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});
