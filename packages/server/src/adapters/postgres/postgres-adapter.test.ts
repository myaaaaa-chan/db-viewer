import { ok, schemaName, tableName } from "@myaaaaa_chan/db-viewer-core";
import pg from "pg";
import Cursor from "pg-cursor";
import { afterAll, beforeAll, describe, expect } from "vitest";
import { resolveLimits } from "../../limits";
import {
  type AdapterCase,
  type AdapterEnvironment,
  describeAdapterSuite,
} from "../../testing/adapter-suite";
import { errorValue, nextQueryId, okValue } from "../../testing/adapter-suite/context";
import { detectDocker, type PostgresServer, startPostgres } from "../../testing/postgres-container";
import { postgresAdapter } from "./postgres-adapter";
import { inTransaction } from "./session";
import { queryRows, readStatement } from "./statement";

const docker = await detectDocker();
const skipReason = docker.available ? null : docker.reason;
if (skipReason !== null) console.warn(`[postgres-adapter.test] スキップ: ${skipReason}`);

const SLEEP_FOREVER = "SELECT pg_sleep(30)";
const limits = resolveLimits;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (condition: () => Promise<boolean> | boolean, what: string) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${what}`);
};

describe.skipIf(skipReason !== null)(
  `postgresAdapter（実 PostgreSQL / Testcontainers${skipReason === null ? "" : "。Docker に繋がらないためスキップ"}）`,
  { timeout: 60_000 },
  () => {
    let server: PostgresServer;
    let admin: pg.Pool;
    let schemaCount = 0;

    beforeAll(async () => {
      server = await startPostgres();
      admin = new pg.Pool({ connectionString: server.uri, max: 2 });
    }, 180_000);

    afterAll(async () => {
      await admin?.end();
      await server?.container.stop();
    }, 60_000);

    // テストごとに、専用のスキーマを search_path にした接続で開く（表名を修飾しないシードと SQL のため）
    const poolOn = (schema: string, max = 4) =>
      new pg.Pool({ connectionString: server.uri, max, options: `-c search_path=${schema}` });

    const createSchema = async () => {
      const schema = `suite_${++schemaCount}`;
      await admin.query(`CREATE SCHEMA ${schema}`);
      return schema;
    };

    const countOf = async (env: AdapterEnvironment, table: string) =>
      (await admin.query(`SELECT count(*)::int AS n FROM ${env.schema}.${table}`)).rows[0].n;

    // 共通テストのための 1 テスト分の環境
    const harnessOpen = async ({ readOnly }: { readonly readOnly: boolean }) => {
      const schema = await createSchema();
      const pool = poolOn(schema);
      const execPool = poolOn(schema, 1);
      return {
        adapter: postgresAdapter(pool, { readOnly }),
        schema: schemaName(schema),
        exec: async (sql: string) => {
          await execPool.query(sql);
        },
        close: async () => {
          await pool.end();
          await execPool.end();
          await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        },
      };
    };

    // 中断の対象になる文を流し、DB の上で動き出したことを確かめてから返す
    const startSleeping = async (
      adapter: ReturnType<typeof postgresAdapter>,
      id = nextQueryId(),
    ) => {
      const running = adapter.execute(SLEEP_FOREVER, id, limits({ statementTimeoutMs: 60_000 }));
      await waitFor(
        async () =>
          (
            await admin.query(
              "SELECT 1 FROM pg_stat_activity WHERE state = 'active' AND query = $1",
              [SLEEP_FOREVER],
            )
          ).rowCount === 1,
        "pg_sleep to start",
      );
      return { id, running };
    };

    const extraCases: ReadonlyArray<AdapterCase> = [
      {
        name: "timeZone を指定すると timestamptz をその時刻で表示し、指定しなければ DB の既定のまま。Pool の他の利用者には影響しない",
        run: async () => {
          const pool = new pg.Pool({
            connectionString: server.uri,
            max: 1,
            options: "-c TimeZone=America/New_York",
          });
          try {
            const sql =
              "SELECT '2024-01-01 00:00:00+00'::timestamptz AS t, current_setting('TimeZone') AS zone";
            const run = async (readOnly: boolean, timeZone?: string) => {
              const adapter = postgresAdapter(
                pool,
                timeZone === undefined ? { readOnly } : { readOnly, timeZone },
              );
              const outcome = okValue(await adapter.execute(sql, nextQueryId(), limits()));
              if (outcome.kind !== "rows") throw new Error("rows expected");
              return outcome.rows[0];
            };
            // 書き込み可（COMMIT で終わる）でも、設定がトランザクションの外に残らないこと
            for (const readOnly of [true, false]) {
              expect(await run(readOnly), `readOnly=${readOnly}`).toEqual([
                "2023-12-31 19:00:00-05",
                "America/New_York",
              ]);
              expect(await run(readOnly, "Asia/Tokyo"), `readOnly=${readOnly}`).toEqual([
                "2024-01-01 09:00:00+09",
                "Asia/Tokyo",
              ]);
              // 同じ接続（max: 1）のまま
              const after = await pool.query("SHOW TimeZone");
              expect(after.rows[0].TimeZone, `readOnly=${readOnly}`).toBe("America/New_York");
            }
          } finally {
            await pool.end();
          }
        },
      },
      {
        name: "timeZone は fetchRows の表示にも効く",
        run: async ({ open }) => {
          const env = await open();
          await env.exec("CREATE TABLE events (id integer PRIMARY KEY, at timestamptz)");
          await env.exec("INSERT INTO events VALUES (1, '2024-06-01 12:00:00+00')");
          const pool = poolOn(env.schema);
          try {
            const rowsIn = async (timeZone: string) => {
              const adapter = postgresAdapter(pool, { timeZone });
              const result = okValue(
                await adapter.fetchRows(
                  {
                    table: { schema: env.schema, name: tableName("events") },
                    filters: [],
                    rawWhere: null,
                    sort: null,
                    limit: 10,
                    offset: 0,
                  },
                  limits(),
                ),
              );
              return result.rows[0]?.[1];
            };
            expect(await rowsIn("Asia/Tokyo")).toBe("2024-06-01 21:00:00+09");
            expect(await rowsIn("UTC")).toBe("2024-06-01 12:00:00+00");
          } finally {
            await pool.end();
          }
        },
      },
      {
        name: "存在しない timeZone は query エラー（22023）で、接続は使い続けられる",
        run: async ({ open }) => {
          const env = await open();
          const pool = poolOn(env.schema, 1);
          try {
            const bad = postgresAdapter(pool, { timeZone: "Not/AZone" });
            const error = errorValue(await bad.execute("SELECT 1", nextQueryId(), limits()));
            expect(error).toMatchObject({ kind: "query", sqlState: "22023" });
            const good = postgresAdapter(pool);
            expect((await good.execute("SELECT 1", nextQueryId(), limits())).ok).toBe(true);
          } finally {
            await pool.end();
          }
        },
      },
      {
        name: "型名は format_type の形（integer[]、character varying(255)、numeric(10,2)）で、execute・fetchRows・getTableDetail が揃う",
        run: async ({ open }) => {
          const env = await open();
          await env.exec(
            "CREATE TABLE typed (a integer[], b character varying(255), c numeric(10,2), d timestamptz, e text[])",
          );
          const ref = { schema: env.schema, name: tableName("typed") };

          const detail = okValue(await env.adapter.getTableDetail(ref));
          expect(detail.columns.map((c) => c.dbType)).toEqual([
            "integer[]",
            "character varying(255)",
            "numeric(10,2)",
            "timestamp with time zone",
            "text[]",
          ]);

          const fetched = okValue(
            await env.adapter.fetchRows(
              { table: ref, filters: [], rawWhere: null, sort: null, limit: 10, offset: 0 },
              limits(),
            ),
          );
          expect(fetched.columns.map((c) => c.dbType)).toEqual(detail.columns.map((c) => c.dbType));

          const sql = "SELECT a, b, c, d, e, 1::int8 AS n FROM typed";
          for (let attempt = 0; attempt < 2; attempt++) {
            const outcome = okValue(await env.adapter.execute(sql, nextQueryId(), limits()));
            if (outcome.kind !== "rows") throw new Error("rows expected");
            expect(outcome.columns.map((c) => c.dbType)).toEqual([
              ...detail.columns.map((c) => c.dbType),
              "bigint",
            ]);
          }
        },
      },
      {
        name: "Pool を使い切っていても中断できる（connectionString / 文字列のパスワード / 関数のパスワード）",
        run: async () => {
          const forms: Record<string, pg.PoolConfig> = {
            connectionString: { connectionString: server.uri },
            文字列のパスワード: {
              host: server.host,
              port: server.port,
              user: server.user,
              password: server.password,
              database: server.database,
            },
            関数のパスワード: {
              host: server.host,
              port: server.port,
              user: server.user,
              password: async () => server.password,
              database: server.database,
            },
          };
          for (const [form, config] of Object.entries(forms)) {
            const pool = new pg.Pool({ ...config, max: 1 });
            try {
              const adapter = postgresAdapter(pool);
              const { id, running } = await startSleeping(adapter);
              // 唯一の接続が実行中。Pool からは、もう接続を取れない
              expect(pool.totalCount, form).toBe(1);
              expect(pool.idleCount, form).toBe(0);

              const startedAt = performance.now();
              expect(okValue(await adapter.cancel(id)), form).toEqual({ cancelled: true });
              expect(errorValue(await running), form).toEqual({ kind: "cancelled" });
              expect(performance.now() - startedAt, form).toBeLessThan(5_000);

              // 中断した後の接続は、そのまま次のクエリに使える
              const next = okValue(
                await adapter.execute("SELECT 42 AS n", nextQueryId(), limits()),
              );
              expect(next).toMatchObject({ kind: "rows", rows: [["42"]] });
            } finally {
              await pool.end();
            }
          }
        },
      },
      {
        name: "実行を始める前の中断（接続待ち）は、文を送らずに cancelled を返す（R5）",
        run: async ({ open }) => {
          const env = await open();
          const pool = poolOn(env.schema, 1);
          try {
            const adapter = postgresAdapter(pool);
            // 唯一の接続を取っておく。adapter.execute は接続を待つことになる
            const held = await pool.connect();
            const id = nextQueryId();
            const waiting = adapter.execute(SLEEP_FOREVER, id, limits());
            await waitFor(() => pool.waitingCount === 1, "execute to wait for a connection");
            expect(okValue(await adapter.cancel(id))).toEqual({ cancelled: true });
            held.release();
            const startedAt = performance.now();
            expect(errorValue(await waiting)).toEqual({ kind: "cancelled" });
            expect(performance.now() - startedAt).toBeLessThan(5_000);
          } finally {
            await pool.end();
          }
        },
      },
      {
        name: "終わったクエリの中断は cancelled: false で、同じ接続の次のクエリを止めない（R5）",
        run: async ({ open }) => {
          const env = await open();
          const pool = poolOn(env.schema, 1);
          try {
            const adapter = postgresAdapter(pool);
            const id = nextQueryId();
            expect((await adapter.execute("SELECT 1", id, limits())).ok).toBe(true);
            expect(okValue(await adapter.cancel(id))).toEqual({ cancelled: false });
            const next = await adapter.execute(
              "SELECT pg_sleep(0.3), 7 AS n",
              nextQueryId(),
              limits(),
            );
            expect(okValue(next)).toMatchObject({ kind: "rows", rows: [["", "7"]] });
          } finally {
            await pool.end();
          }
        },
      },
      {
        name: "タイムアウトは SET LOCAL なので、書き込み可（COMMIT）でも接続に残らず、timeout と cancelled を取り違えない",
        run: async ({ open }) => {
          const env = await open();
          const pool = poolOn(env.schema, 1);
          try {
            for (const readOnly of [true, false]) {
              const adapter = postgresAdapter(pool, { readOnly });
              const slow = await adapter.execute(
                SLEEP_FOREVER,
                nextQueryId(),
                limits({ statementTimeoutMs: 200 }),
              );
              expect(errorValue(slow), `readOnly=${readOnly}`).toEqual({
                kind: "timeout",
                timeoutMs: 200,
              });
              // 成功して COMMIT する文でも、設定は残らない
              const quick = await adapter.execute(
                "SELECT 1",
                nextQueryId(),
                limits({ statementTimeoutMs: 200 }),
              );
              expect(quick.ok, `readOnly=${readOnly}`).toBe(true);
              const after = await pool.query("SHOW statement_timeout");
              expect(after.rows[0].statement_timeout, `readOnly=${readOnly}`).toBe("0");
            }
          } finally {
            await pool.end();
          }
        },
      },
      {
        name: "pg.types のグローバルな設定を変えず、同じプロセスの pg の型変換はそのまま",
        run: async ({ open }) => {
          const oids = [
            16, 17, 20, 21, 23, 25, 114, 700, 701, 1007, 1009, 1082, 1114, 1184, 1186, 1700, 2950,
            3802,
          ];
          const snapshot = () =>
            oids.flatMap((oid) => [
              pg.types.getTypeParser(oid),
              pg.types.getTypeParser(oid, "binary"),
            ]);
          const before = snapshot();

          const env = await open({ readOnly: false });
          await env.exec(
            "CREATE TABLE mixed (i integer, b bigint, t timestamptz, j jsonb, n numeric)",
          );
          await env.exec(
            "INSERT INTO mixed VALUES (1, 2, '2024-01-01 00:00:00+00', '{\"a\": 1}', 1.50)",
          );
          await env.adapter.fetchRows(
            {
              table: { schema: env.schema, name: tableName("mixed") },
              filters: [],
              rawWhere: null,
              sort: null,
              limit: 10,
              offset: 0,
            },
            limits(),
          );
          await env.adapter.execute("SELECT * FROM mixed", nextQueryId(), limits());
          await env.adapter.execute("INSERT INTO mixed (i) VALUES (2)", nextQueryId(), limits());
          await env.adapter.getTableDetail({ schema: env.schema, name: tableName("mixed") });
          await env.adapter.cancel(nextQueryId());

          const after = snapshot();
          expect(after.length).toBe(before.length);
          after.forEach((parser, index) => {
            expect(parser === before[index], `oid index ${index}`).toBe(true);
          });

          // 同じプロセスの利用者が普通に pg を使うと、これまでどおり JS の値になる
          const plain = await admin.query(
            "SELECT 1::int4 AS i, 2::int8 AS b, now() AS t, '{\"a\":1}'::jsonb AS j",
          );
          const row = plain.rows[0];
          expect(typeof row.i).toBe("number");
          expect(typeof row.b).toBe("string");
          expect(row.t).toBeInstanceOf(Date);
          expect(row.j).toEqual({ a: 1 });
        },
      },
      {
        name: "R4: COMMIT; DELETE のように文を足しても、読み取り専用は破れない。データも変わらない",
        run: async ({ open }) => {
          const env = await open({ readOnly: true });
          for (const sql of [
            "COMMIT; DELETE FROM users",
            "SET TRANSACTION READ WRITE; DELETE FROM users",
            "SELECT 1; DELETE FROM users",
          ]) {
            const result = await env.adapter.execute(sql, nextQueryId(), limits());
            expect(errorValue(result), sql).toEqual({ kind: "multipleStatements" });
          }
          expect(await countOf(env, "users")).toBe(3);
        },
      },
      {
        name: "R3: 1 文の蓋は DB 側の extended protocol。ドライバに複数の文を渡しても 42601 で拒否される",
        run: async ({ open }) => {
          const env = await open();
          await env.exec("CREATE TABLE victim (id integer)");
          await env.exec("INSERT INTO victim VALUES (1), (2), (3)");
          const client = new pg.Client({
            connectionString: server.uri,
            options: `-c search_path=${env.schema}`,
          });
          await client.connect();
          try {
            const attacks = [
              "COMMIT; DELETE FROM victim",
              "SET TRANSACTION READ WRITE; DELETE FROM victim",
            ];
            for (const attack of attacks) {
              await client.query("BEGIN READ ONLY");
              await expect(readStatement(client, Cursor, attack, 10), attack).rejects.toMatchObject(
                {
                  code: "42601",
                },
              );
              await client.query("ROLLBACK");
              await client.query("BEGIN READ ONLY");
              await expect(queryRows(client, attack), attack).rejects.toMatchObject({
                code: "42601",
              });
              await client.query("ROLLBACK");
              expect(await countOf(env, "victim"), attack).toBe(3);
            }

            // 対照: values: [] だけでは simple protocol で送られ、COMMIT で読み取り専用を抜けて DELETE が通る
            await client.query("BEGIN READ ONLY");
            await client.query({ text: "COMMIT; DELETE FROM victim", values: [] });
            expect(await countOf(env, "victim")).toBe(0);
          } finally {
            await client.end();
          }
        },
      },
      {
        name: "R4: SET TRANSACTION READ WRITE を流した後でも、次の依頼の書き込みは拒否される（同じ接続で）",
        run: async ({ open }) => {
          const env = await open();
          await env.exec("CREATE SEQUENCE vseq");
          const pool = poolOn(env.schema, 1);
          try {
            const adapter = postgresAdapter(pool, { readOnly: true });
            const escapes = [
              "SET TRANSACTION READ WRITE",
              "SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE",
              "SET default_transaction_read_only = off",
              "SELECT set_config('transaction_read_only', 'off', false)",
            ];
            for (const attempt of escapes) {
              await adapter.execute(attempt, nextQueryId(), limits());
              const write = await adapter.execute("DELETE FROM users", nextQueryId(), limits());
              expect(errorValue(write).kind, attempt).toBe("readOnlyViolation");
              const sequence = await adapter.execute(
                "SELECT nextval('vseq')",
                nextQueryId(),
                limits(),
              );
              expect(errorValue(sequence).kind, attempt).toBe("readOnlyViolation");
            }
            expect(await countOf(env, "users")).toBe(3);
            const state = await admin.query(`SELECT is_called FROM ${env.schema}.vseq`);
            expect(state.rows[0].is_called).toBe(false);
          } finally {
            await pool.end();
          }
        },
      },
      {
        name: "SQL の位置は、利用者が入力した文字列の中の 0 始まりの位置（先頭のコメントや絵文字があってもずれない）",
        run: async ({ open }) => {
          const env = await open();
          const cases = [
            ["SELEC 1", "SELEC"],
            ["  /* メモ */ SELECT 1 FORM x;", "x"],
            ["SELECT '😀' FORM x", "x"],
          ] as const;
          for (const [sql, token] of cases) {
            const error = errorValue(await env.adapter.execute(sql, nextQueryId(), limits()));
            expect(error.kind, sql).toBe("query");
            if (error.kind !== "query") continue;
            expect(sql.slice(error.position ?? -1).startsWith(token), sql).toBe(true);
          }
        },
      },
      {
        name: "行数の上限は、カーソルで maxRows + 1 行だけ読んで決める（大きな結果でも、接続はそのまま使える）",
        run: async ({ open }) => {
          const env = await open();
          const pool = poolOn(env.schema, 1);
          try {
            await env.exec(
              "CREATE TABLE big AS SELECT g AS id, repeat('x', 100) AS pad FROM generate_series(1, 200000) g",
            );
            const adapter = postgresAdapter(pool);
            const outcome = okValue(
              await adapter.execute("SELECT * FROM big", nextQueryId(), limits({ maxRows: 5 })),
            );
            if (outcome.kind !== "rows") throw new Error("rows expected");
            expect(outcome.rows).toHaveLength(5);
            expect(outcome.truncated).toBe(true);
            // ポータルを閉じていて、トランザクションも終わっている（同じ接続で、すぐ次が流れる）
            const idle = await admin.query(
              "SELECT count(*)::int AS n FROM pg_stat_activity WHERE state = 'idle in transaction'",
            );
            expect(idle.rows[0].n).toBe(0);
            expect((await adapter.execute("SELECT 1", nextQueryId(), limits())).ok).toBe(true);
          } finally {
            await pool.end();
          }
        },
      },
      {
        name: "COPY は結果の表にならない。TO STDOUT は command、FROM STDIN は未対応の query エラー。プロセスは落ちず、接続は使い続けられる",
        run: async ({ open }) => {
          const env = await open();
          const pool = poolOn(env.schema, 1);
          const short = limits({ statementTimeoutMs: 5_000 });
          try {
            const writable = postgresAdapter(pool, { readOnly: false });
            const out = await writable.execute("COPY (SELECT 1) TO STDOUT", nextQueryId(), short);
            expect(okValue(out)).toMatchObject({ kind: "command", affectedRows: 1 });
            const incoming = await writable.execute("COPY users FROM STDIN", nextQueryId(), short);
            expect(errorValue(incoming)).toMatchObject({ kind: "query", sqlState: "0A000" });
            expect(await countOf(env, "users")).toBe(3);

            const readOnly = postgresAdapter(pool);
            const refused = await readOnly.execute("COPY users FROM STDIN", nextQueryId(), short);
            expect(errorValue(refused).kind).toBe("readOnlyViolation");
            expect((await readOnly.execute("SELECT 1", nextQueryId(), short)).ok).toBe(true);
          } finally {
            await pool.end();
          }
        },
      },
      {
        name: "実行中に接続を切られても、プロセスを落とさずエラーを返し、Pool は使い続けられる",
        run: async ({ open }) => {
          const env = await open();
          const pool = poolOn(env.schema, 1);
          try {
            const adapter = postgresAdapter(pool);
            const { running } = await startSleeping(adapter);
            await admin.query(
              "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE query = $1",
              [SLEEP_FOREVER],
            );
            const error = errorValue(await running);
            expect(error.kind).toBe("query");
            expect((await adapter.execute("SELECT 1", nextQueryId(), limits())).ok).toBe(true);
          } finally {
            await pool.end();
          }
        },
      },
      {
        name: "文と文の間で接続を切られても、未処理の 'error' でプロセスを落とさず、その接続を Pool に戻さない",
        run: async ({ open }) => {
          const env = await open();
          const pool = poolOn(env.schema, 1);
          try {
            const result = await inTransaction(
              pool,
              { readOnly: true, statementTimeoutMs: 5_000, timeZone: undefined },
              { timeoutMs: 5_000, cancelRequested: false, sent: null },
              async ({ pid }) => {
                await admin.query("SELECT pg_terminate_backend($1)", [pid]);
                await sleep(300);
                return ok("done");
              },
            );
            expect(result.ok).toBe(false);
            expect(pool.totalCount).toBe(0);
            const next = await postgresAdapter(pool).execute("SELECT 1", nextQueryId(), limits());
            expect(next.ok).toBe(true);
          } finally {
            await pool.end();
          }
        },
      },
      {
        name: "getTableDetail の DDL は近似。流し直すと、列・インデックス・外部キーが同じ構造に戻る",
        run: async ({ open }) => {
          const env = await open();
          await env.exec(`CREATE TABLE ddl_src (
            id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            user_id integer NOT NULL REFERENCES users (id),
            name character varying(40) NOT NULL DEFAULT 'n',
            qty integer NOT NULL CHECK (qty >= 0),
            total integer GENERATED ALWAYS AS (qty * 2) STORED,
            tags text[],
            UNIQUE (user_id, name)
          )`);
          await env.exec(
            "CREATE INDEX ddl_src_lower_idx ON ddl_src (lower(name), qty DESC) WHERE qty > 0",
          );
          const ref = { schema: env.schema, name: tableName("ddl_src") };

          const before = okValue(await env.adapter.getTableDetail(ref));
          expect(before.ddl.approximate).toBe(true);
          await env.exec("DROP TABLE ddl_src");
          await env.exec(before.ddl.text);
          const after = okValue(await env.adapter.getTableDetail(ref));

          expect(after.columns).toEqual(before.columns);
          expect(after.indexes).toEqual(before.indexes);
          expect(after.foreignKeys).toEqual(before.foreignKeys);
          expect(after.ddl.text).toBe(before.ddl.text);
          expect(before.indexes.map((i) => i.columns)).toContainEqual(["lower(name::text)", "qty"]);
        },
      },
      {
        name: "ビューとマテリアライズドビュー: kind は view、DDL は pg_get_viewdef",
        run: async ({ open }) => {
          const env = await open();
          await env.exec("CREATE MATERIALIZED VIEW names AS SELECT id, name FROM users");
          await env.exec("CREATE UNIQUE INDEX names_id_idx ON names (id)");
          const tables = okValue(await env.adapter.listTables(env.schema));
          expect(tables.find((t) => t.ref.name === "names")?.kind).toBe("view");

          const view = okValue(
            await env.adapter.getTableDetail({ schema: env.schema, name: tableName("adults") }),
          );
          expect(view.ddl.text).toMatch(/^CREATE VIEW ".+"\."adults" AS\nSELECT /);
          const materialized = okValue(
            await env.adapter.getTableDetail({ schema: env.schema, name: tableName("names") }),
          );
          expect(materialized.summary.kind).toBe("view");
          expect(materialized.indexes).toEqual([
            { name: "names_id_idx", columns: ["id"], unique: true, primary: false },
          ]);
          expect(materialized.ddl.text).toContain("CREATE MATERIALIZED VIEW");
          expect(materialized.ddl.text).toContain("CREATE UNIQUE INDEX names_id_idx");
        },
      },
      {
        name: "システムのスキーマ（pg_catalog・information_schema・pg_toast・一時スキーマ）は一覧に出ない",
        run: async ({ open }) => {
          const env = await open();
          const client = await admin.connect();
          try {
            await client.query("CREATE TEMP TABLE scratch (a integer)");
            const schemas = okValue(await env.adapter.listSchemas());
            expect(schemas.filter((name) => /^(pg_|information_schema)/.test(name))).toEqual([]);
          } finally {
            client.release();
          }
        },
      },
      {
        name: "存在しない接続先など、接続の失敗は internal で返し、接続先を含めない",
        run: async () => {
          const pool = new pg.Pool({
            host: "127.0.0.1",
            port: 1,
            user: "nobody",
            password: "secret-password",
            database: "nowhere",
            max: 1,
            connectionTimeoutMillis: 2_000,
          });
          pool.on("error", () => {});
          try {
            const adapter = postgresAdapter(pool);
            const failures = [
              errorValue(await adapter.listSchemas()),
              errorValue(await adapter.execute("SELECT 1", nextQueryId(), limits())),
            ];
            for (const failure of failures) {
              const message = JSON.stringify(failure);
              expect(message).not.toContain("secret-password");
              expect(message).not.toContain("127.0.0.1");
              expect(failure.kind).toBe("internal");
            }
          } finally {
            await pool.end();
          }
        },
      },
    ];

    describeAdapterSuite({
      name: "postgres (pg + Testcontainers)",
      dialect: "postgres",
      open: harnessOpen,
      expectedCapabilities: { cancel: true, enforcesTimeout: true },
      slowSql: "SELECT pg_sleep(2)",
      extraCases,
    });
  },
);
