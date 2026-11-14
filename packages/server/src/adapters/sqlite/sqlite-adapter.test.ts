import { columnName, queryId, schemaName, tableName } from "@myaaaaa_chan/db-viewer-core";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { resolveLimits } from "../../limits";
import { sqliteAdapter } from "./index";

const limits = resolveLimits();
const main = schemaName("main");
const ref = (name: string) => ({ schema: main, name: tableName(name) });
const q = (n: number) => queryId(`q-${n}`);

const open = (seed: ReadonlyArray<string> = []) => {
  const db = new Database(":memory:");
  for (const statement of seed) db.exec(statement);
  return db;
};

describe("sqliteAdapter: 宣言", () => {
  it("読み取り専用が初期値。タイムアウトの強制と中断は宣言しない（R1）", () => {
    const adapter = sqliteAdapter(open());
    expect(adapter.dialect).toBe("sqlite");
    expect(adapter.readOnly).toBe(true);
    expect(adapter.capabilities).toEqual({ cancel: false, enforcesTimeout: false });
    expect(sqliteAdapter(open(), { readOnly: false }).readOnly).toBe(false);
  });

  it("列の名前を返せないドライバは、最初のリクエストを待たず作成時に使えないと分かる", () => {
    const withoutColumns = {
      prepare: () => ({ all: () => [], iterate: () => [], run: () => ({ changes: 0 }) }),
      exec: () => {},
    };
    expect(() => sqliteAdapter(withoutColumns)).toThrow(/22\.16/);
  });
});

describe("sqliteAdapter: 渡されたインスタンスをアプリと共有する（R2）", () => {
  it("読み取り専用のアダプターを使った後も、アプリ自身の書き込みは止まらない", async () => {
    const db = open(["CREATE TABLE t (a)"]);
    const adapter = sqliteAdapter(db, { readOnly: true });
    await adapter.execute("SELECT 1", q(1), limits);
    await adapter.fetchRows(
      { table: ref("t"), filters: [], rawWhere: null, sort: null, limit: 10, offset: 0 },
      limits,
    );
    expect(() => db.exec("INSERT INTO t (a) VALUES (1)")).not.toThrow();
    const rejected = await adapter.execute("INSERT INTO t (a) VALUES (2)", q(2), limits);
    expect(rejected.ok).toBe(false);
    expect(() => db.exec("INSERT INTO t (a) VALUES (3)")).not.toThrow();
  });

  it("アプリが自分で query_only を ON にしていたら、アダプターの後も ON のまま", async () => {
    const db = open(["CREATE TABLE t (a)"]);
    db.exec("PRAGMA query_only = ON");
    const adapter = sqliteAdapter(db, { readOnly: true });
    await adapter.execute("SELECT 1", q(1), limits);
    expect(() => db.exec("INSERT INTO t (a) VALUES (1)")).toThrow(/readonly/);
  });

  it("書き込みを許すアダプターは query_only に触れない", async () => {
    const db = open(["CREATE TABLE t (a)"]);
    db.exec("PRAGMA query_only = ON");
    const adapter = sqliteAdapter(db, { readOnly: false });
    const result = await adapter.execute("INSERT INTO t (a) VALUES (1)", q(1), limits);
    expect(result.ok).toBe(false);
  });

  it("実行した SQL が query_only を OFF にしても、アダプターの次の書き込みは拒否され、アプリの状態も元に戻る", async () => {
    const db = open(["CREATE TABLE t (a)"]);
    const adapter = sqliteAdapter(db, { readOnly: true });
    await adapter.execute("PRAGMA query_only = OFF", q(1), limits);
    expect(db.pragma("query_only", { simple: true })).toBe(0);
    const write = await adapter.execute("INSERT INTO t (a) VALUES (1)", q(2), limits);
    expect(write.ok ? "ok" : write.error.kind).toBe("readOnlyViolation");
  });
});

describe("sqliteAdapter: メタデータ", () => {
  it("内部のテーブル（sqlite_sequence）は一覧に出さない", async () => {
    const db = open([
      "CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT)",
      "INSERT INTO t DEFAULT VALUES",
    ]);
    const result = await sqliteAdapter(db).listTables(main);
    const names = result.ok ? result.value.map((t) => t.ref.name) : [];
    expect(names).toEqual(["t"]);
  });

  it("式インデックスは、式の文字列を列として返す", async () => {
    const db = open([
      "CREATE TABLE t (name TEXT, age INTEGER)",
      "CREATE INDEX t_expr ON t (lower(name), age DESC)",
    ]);
    const result = await sqliteAdapter(db).getTableDetail(ref("t"));
    expect(result.ok && result.value.indexes).toEqual([
      { name: "t_expr", columns: ["lower(name)", "age"], unique: false, primary: false },
    ]);
  });

  it("参照先の列を省略した外部キーは、参照先の主キーの列として返す", async () => {
    const db = open([
      "CREATE TABLE parent (id INTEGER PRIMARY KEY)",
      "CREATE TABLE child (pid INTEGER REFERENCES parent)",
    ]);
    const result = await sqliteAdapter(db).getTableDetail(ref("child"));
    expect(result.ok && result.value.foreignKeys[0]?.references.columns).toEqual([
      columnName("id"),
    ]);
  });

  it("生成列も、列として返し、行にも含める", async () => {
    const db = open([
      "CREATE TABLE g (a INTEGER, b INTEGER GENERATED ALWAYS AS (a * 2) VIRTUAL)",
      "INSERT INTO g (a) VALUES (21)",
    ]);
    const adapter = sqliteAdapter(db);
    const detail = await adapter.getTableDetail(ref("g"));
    expect(detail.ok && detail.value.columns.map((c) => c.name)).toEqual(["a", "b"]);
    const rows = await adapter.fetchRows(
      { table: ref("g"), filters: [], rawWhere: null, sort: null, limit: 10, offset: 0 },
      limits,
    );
    expect(rows.ok && rows.value.rows).toEqual([["21", "42"]]);
  });
});

describe("sqliteAdapter: 値", () => {
  const outcome = async (sql: string) => {
    const result = await sqliteAdapter(open()).execute(sql, q(1), limits);
    if (!result.ok || result.value.kind !== "rows") throw new Error(JSON.stringify(result));
    return result.value;
  };

  it("REAL は整数に見える値でも REAL と分かる文字列、INTEGER は精度を落とさない", async () => {
    expect((await outcome("SELECT 3.0 AS r, 3 AS i, 0.1 + 0.2 AS s")).rows).toEqual([
      ["3.0", "3", "0.30000000000000004"],
    ]);
  });

  it("空の SQL とコメントだけの SQL は、DB に渡さず query エラーにする", async () => {
    const adapter = sqliteAdapter(open());
    for (const sql of ["", "   ", "-- コメントだけ", "/* x */ ;"]) {
      const result = await adapter.execute(sql, q(1), limits);
      expect(result.ok ? "ok" : result.error.kind, JSON.stringify(sql)).toBe("query");
    }
  });
});
