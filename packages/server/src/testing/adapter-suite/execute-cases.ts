import { describe, expect, it } from "vitest";
import { errorOf, nextQueryId, refOf, rowsQuery, type SuiteContext, valueOf } from "./context";
import type { AdapterHarness } from "./harness";
import { sqlFor } from "./seed";

type Env = Awaited<ReturnType<SuiteContext["open"]>>;

const rowsOf = async (env: Env, sql: string, overrides = {}, limits: SuiteContext["limits"]) => {
  const outcome = valueOf(await env.adapter.execute(sql, nextQueryId(), limits(overrides)));
  if (outcome.kind !== "rows") throw new Error(`expected rows but got ${outcome.kind}`);
  return outcome;
};

const userCount = async (env: Env, limits: SuiteContext["limits"]) =>
  valueOf(await env.adapter.countRows(refOf(env, "users"), [], null, limits())).count;

export const executeCases = (harness: AdapterHarness, { open, limits }: SuiteContext) => {
  const sql = sqlFor(harness.dialect);

  describe("execute: 結果の形", () => {
    it("rows の結果は、列・行の配列・打ち切りの有無・経過時間を持つ", async () => {
      const env = await open();
      const outcome = await rowsOf(env, "SELECT id, name FROM users ORDER BY id", {}, limits);
      expect(outcome.columns.map((c) => c.name)).toEqual(["id", "name"]);
      expect(outcome.rows).toEqual([
        ["1", "alice"],
        ["2", "bob"],
        ["3", "carol"],
      ]);
      expect(outcome.truncated).toBe(false);
      expect(outcome.truncatedCells).toEqual([]);
      expect(outcome.elapsedMs).toBeGreaterThanOrEqual(0);
    });

    it("同名の列があっても、列を落とさず並びを保つ", async () => {
      const env = await open();
      const outcome = await rowsOf(env, "SELECT 1 AS a, 2 AS a, 3 AS b", {}, limits);
      expect(outcome.columns.map((c) => c.name)).toEqual(["a", "a", "b"]);
      expect(outcome.rows).toEqual([["1", "2", "3"]]);
    });

    it("0 行でも、列の名前は返す", async () => {
      const env = await open();
      const outcome = await rowsOf(env, "SELECT id, name FROM users WHERE 1 = 0", {}, limits);
      expect(outcome.columns.map((c) => c.name)).toEqual(["id", "name"]);
      expect(outcome.rows).toEqual([]);
    });

    it("NULL と空文字、bigint、numeric、バイナリの文字列表現", async () => {
      const env = await open();
      const outcome = await rowsOf(
        env,
        `SELECT NULL AS n, '' AS e, 9007199254740993 AS a, 9223372036854775807 AS b, 1.5 AS r, ${sql.blobLiteral("0aff")} AS x`,
        {},
        limits,
      );
      expect(outcome.rows).toEqual([
        [null, "", "9007199254740993", "9223372036854775807", "1.5", "\\x0aff"],
      ]);
    });

    it("行数の上限で打ち切ったら truncated。ちょうど上限なら false", async () => {
      const env = await open();
      const cut = await rowsOf(env, "SELECT id FROM many ORDER BY id", { maxRows: 10 }, limits);
      expect(cut.rows).toHaveLength(10);
      expect(cut.truncated).toBe(true);
      const exact = await rowsOf(env, "SELECT id FROM many ORDER BY id", { maxRows: 25 }, limits);
      expect(exact.rows).toHaveLength(25);
      expect(exact.truncated).toBe(false);
    });

    it("maxCellChars を超えたセルは、受け取った後に切り詰めて位置を返す", async () => {
      const env = await open();
      const outcome = await rowsOf(
        env,
        "SELECT body FROM docs WHERE id IN (1, 2, 3, 4) ORDER BY id",
        { maxCellChars: 10 },
        limits,
      );
      expect(outcome.rows.map((row) => row[0])).toEqual([
        "abcdefghij",
        "abcdefghij",
        "あいうえおかきくけこ",
        "😀😀😀😀😀😀",
      ]);
      expect(outcome.truncatedCells).toEqual([
        [0, 0],
        [2, 0],
      ]);
    });

    it("末尾の ; やコメント、文字列の中の ; があっても 1 文として実行する", async () => {
      const env = await open();
      expect((await rowsOf(env, "SELECT 1 AS a; -- 以上", {}, limits)).rows).toEqual([["1"]]);
      expect((await rowsOf(env, "SELECT 'a;b' AS a;", {}, limits)).rows).toEqual([["a;b"]]);
    });
  });

  describe("execute: 失敗の種類", () => {
    it("構文エラーと実行時のエラーは query。DB のメッセージとコードをそのまま持つ", async () => {
      const env = await open();
      const syntax = errorOf(await env.adapter.execute("SELEC 1", nextQueryId(), limits()));
      expect(syntax.kind).toBe("query");
      if (syntax.kind !== "query") return;
      expect(syntax.message.length).toBeGreaterThan(0);
      expect(typeof syntax.sqlState).toBe("string");

      const runtime = await env.adapter.execute(
        "SELECT * FROM no_such_table",
        nextQueryId(),
        limits(),
      );
      expect(errorOf(runtime).kind).toBe("query");
    });

    it("2 文以上は multipleStatements。後ろの文は実行されない", async () => {
      const env = await open({ readOnly: false });
      const result = await env.adapter.execute(
        "SELECT 1; DELETE FROM users",
        nextQueryId(),
        limits(),
      );
      expect(errorOf(result)).toEqual({ kind: "multipleStatements" });
      expect(await userCount(env, limits)).toBe("3");
      const two = await env.adapter.execute("SELECT 1; SELECT 2", nextQueryId(), limits());
      expect(errorOf(two)).toEqual({ kind: "multipleStatements" });
    });
  });

  describe("execute: 読み取り専用", () => {
    it.each([
      ["INSERT", "INSERT INTO users (id, name) VALUES (99, 'x')"],
      ["UPDATE", "UPDATE users SET name = 'x'"],
      ["DELETE", "DELETE FROM users"],
      ["CREATE TABLE", "CREATE TABLE evil (a TEXT)"],
      ["DROP TABLE", "DROP TABLE no_pk"],
    ])("%s は readOnlyViolation で、データは変わらない", async (_name, statement) => {
      const env = await open({ readOnly: true });
      expect(env.adapter.readOnly).toBe(true);
      const result = await env.adapter.execute(statement, nextQueryId(), limits());
      expect(errorOf(result).kind).toBe("readOnlyViolation");
      expect(await userCount(env, limits)).toBe("3");
      const tables = valueOf(await env.adapter.listTables(env.schema));
      expect(tables.map((t) => t.ref.name)).toContain("no_pk");
      expect(tables.map((t) => t.ref.name)).not.toContain("evil");
    });

    it("読み取り専用を解除しようとした後でも、次の書き込みは拒否される（R4）", async () => {
      for (const escape of sql.readOnlyEscapes) {
        const env = await open({ readOnly: true });
        await env.adapter.execute(escape, nextQueryId(), limits());
        const write = await env.adapter.execute("DELETE FROM users", nextQueryId(), limits());
        expect(errorOf(write).kind, escape).toBe("readOnlyViolation");
        expect(await userCount(env, limits)).toBe("3");
      }
    });

    it("rawWhere を使う fetchRows でも読み取り専用が保たれる", async () => {
      const env = await open({ readOnly: true });
      const result = await env.adapter.fetchRows(
        rowsQuery(env, "users", { rawWhere: "id IN (SELECT id FROM users)" }),
        limits(),
      );
      expect(result.ok).toBe(true);
      expect(await userCount(env, limits)).toBe("3");
    });
  });

  describe("execute: 書き込みを許す接続", () => {
    it("INSERT / UPDATE / DELETE は command で、影響した行数を返す", async () => {
      const env = await open({ readOnly: false });
      expect(env.adapter.readOnly).toBe(false);
      const run = async (statement: string) =>
        valueOf(await env.adapter.execute(statement, nextQueryId(), limits()));

      const inserted = await run("INSERT INTO users (id, name) VALUES (10, 'dave')");
      expect(inserted).toMatchObject({ kind: "command", affectedRows: 1 });
      const updated = await run("UPDATE users SET status = 'x' WHERE id IN (1, 2)");
      expect(updated).toMatchObject({ kind: "command", affectedRows: 2 });
      const deleted = await run("DELETE FROM users WHERE id = 10");
      expect(deleted).toMatchObject({ kind: "command", affectedRows: 1 });
      const noop = await run("DELETE FROM users WHERE id = 12345");
      expect(noop).toMatchObject({ kind: "command", affectedRows: 0 });
      expect(await userCount(env, limits)).toBe("3");
    });

    it("DDL は command。影響した行数は 0 か null（古い値を引きずらない）", async () => {
      const env = await open({ readOnly: false });
      await env.adapter.execute("UPDATE users SET status = status", nextQueryId(), limits());
      const created = valueOf(
        await env.adapter.execute("CREATE TABLE created (a TEXT)", nextQueryId(), limits()),
      );
      expect(created.kind).toBe("command");
      if (created.kind !== "command") return;
      expect([0, null]).toContain(created.affectedRows);
      expect(valueOf(await env.adapter.listTables(env.schema)).map((t) => t.ref.name)).toContain(
        "created",
      );
    });
  });

  describe("同時実行数・タイムアウト・中断", () => {
    it("同時に投げたクエリは、成功するか busy のどちらか。busy は上限の数を伝える", async () => {
      const env = await open();
      const only = limits({ maxConcurrentQueries: 1 });
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          env.adapter.execute(harness.slowSql ?? "SELECT 1", nextQueryId(), {
            ...only,
            statementTimeoutMs: 5_000,
          }),
        ),
      );
      for (const result of results) {
        if (!result.ok) expect(result.error).toEqual({ kind: "busy", maxConcurrentQueries: 1 });
      }
      if (harness.slowSql !== undefined) {
        expect(results.filter((r) => !r.ok).length).toBeGreaterThanOrEqual(1);
      }
    });

    it("busy の後も、アダプターは次のクエリを受け付ける", async () => {
      const env = await open();
      await Promise.all(
        Array.from({ length: 4 }, () =>
          env.adapter.execute(
            harness.slowSql ?? "SELECT 1",
            nextQueryId(),
            limits({ maxConcurrentQueries: 1 }),
          ),
        ),
      );
      const after = await env.adapter.execute("SELECT 1", nextQueryId(), limits());
      expect(after.ok).toBe(true);
    });

    it("宣言した capabilities と、アダプターの実際の宣言が一致する", async () => {
      const env = await open();
      expect(env.adapter.capabilities).toEqual(harness.expectedCapabilities);
      expect(env.adapter.dialect).toBe(harness.dialect);
    });

    it("中断に対応しないアダプターの cancel は unsupported。対応するなら、実行中でない ID は cancelled: false", async () => {
      const env = await open();
      const result = await env.adapter.cancel(nextQueryId());
      if (harness.expectedCapabilities.cancel) {
        expect(valueOf(result)).toEqual({ cancelled: false });
      } else {
        expect(errorOf(result)).toEqual({ kind: "unsupported", feature: "cancel" });
      }
    });

    it.skipIf(!harness.expectedCapabilities.enforcesTimeout)(
      "タイムアウトを強制するアダプターは、上限を超えたクエリを timeout にする",
      async () => {
        if (harness.slowSql === undefined) throw new Error("harness.slowSql is required");
        const env = await open();
        const result = await env.adapter.execute(
          harness.slowSql,
          nextQueryId(),
          limits({ statementTimeoutMs: 200 }),
        );
        expect(errorOf(result)).toEqual({ kind: "timeout", timeoutMs: 200 });
      },
    );
  });
};
