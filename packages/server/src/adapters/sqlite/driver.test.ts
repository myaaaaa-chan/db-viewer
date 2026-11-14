import { describe, expect, it, vi } from "vitest";
import {
  DuplicateColumnNamesError,
  openStatement,
  type SqliteDatabaseLike,
  type SqliteStatementLike,
  UnsupportedSqliteDriverError,
} from "./driver";

// 各ドライバの実測（2026-11-14）で分かった形を写した代役。本物との照合はアダプターの共通テストと実機で行う。
const dbOf = (statement: Partial<SqliteStatementLike>): SqliteDatabaseLike => ({
  prepare: () => ({
    all: () => [],
    iterate: () => [],
    run: () => ({ changes: 0 }),
    ...statement,
  }),
  exec: () => {},
});

const betterSqlite3Like = (rows: ReadonlyArray<ReadonlyArray<unknown>>) => {
  const calls: Array<string> = [];
  return {
    calls,
    db: dbOf({
      columns: () => [
        { name: "id", type: "INTEGER" },
        { name: "id", type: "TEXT" },
      ],
      safeIntegers: (enabled) => {
        calls.push(`safeIntegers(${enabled})`);
        return undefined;
      },
      raw: (enabled) => {
        calls.push(`raw(${enabled})`);
        return undefined;
      },
      iterate: () => rows,
    }),
  };
};

describe("openStatement / better-sqlite3 の形", () => {
  it("整数を BigInt に、行を配列にして読む。同名の列もそのまま残る", () => {
    const { db, calls } = betterSqlite3Like([[1n, "a"]]);
    const opened = openStatement(db, "select 1");
    expect(opened.integersAsBigInt).toBe(true);
    expect(opened.columns).toEqual([
      { name: "id", dbType: "INTEGER" },
      { name: "id", dbType: "TEXT" },
    ]);
    expect([...opened.rows([])]).toEqual([[1n, "a"]]);
    expect(calls).toEqual(["safeIntegers(true)", "raw(true)"]);
  });
});

describe("openStatement / node:sqlite 24 以上の形", () => {
  it("setReadBigInts と setReturnArrays を使う", () => {
    const calls: Array<string> = [];
    const opened = openStatement(
      dbOf({
        columns: () => [{ name: "a", type: null }],
        setReadBigInts: (enabled) => calls.push(`setReadBigInts(${enabled})`) && undefined,
        setReturnArrays: (enabled) => calls.push(`setReturnArrays(${enabled})`) && undefined,
        iterate: () => [[1n]],
      }),
      "select 1",
    );
    expect(opened.integersAsBigInt).toBe(true);
    expect([...opened.rows([])]).toEqual([[1n]]);
    expect(calls).toEqual(["setReadBigInts(true)", "setReturnArrays(true)"]);
  });
});

describe("openStatement / node:sqlite 22.16 から 23 の形（配列の行がない）", () => {
  const nodeSqlite22 = (rows: ReadonlyArray<Record<string, unknown>>, names: Array<string>) =>
    dbOf({
      columns: () => names.map((name) => ({ name, type: null })),
      setReadBigInts: () => {},
      iterate: () => rows,
    });

  it("オブジェクトの行を、列の並び順の配列にする（数字だけの名前はオブジェクトでは並びが変わる）", () => {
    const opened = openStatement(nodeSqlite22([{ 1: "b", 2: "a" }], ["2", "1"]), "select");
    expect([...opened.rows([])]).toEqual([["a", "b"]]);
  });

  it("同名の列があるときは、1 つ落とさず失敗にする", () => {
    expect(() => openStatement(nodeSqlite22([], ["id", "id"]), "select")).toThrow(
      DuplicateColumnNamesError,
    );
  });
});

describe("openStatement / bun:sqlite の形", () => {
  const bunLike = (overrides: Partial<SqliteStatementLike> = {}) => {
    const raw = vi.fn();
    const db = dbOf({
      columnNames: ["id", "name"],
      declaredTypes: ["INTEGER", null],
      safeIntegers: () => undefined,
      iterate: () => [{ id: 1n, name: "a" }],
      values: () => [[1n, "a"]],
      raw,
      ...overrides,
    });
    return { db, raw };
  };

  it("columnNames と declaredTypes から列を作る", () => {
    const opened = openStatement(bunLike().db, "select");
    expect(opened.columns).toEqual([
      { name: "id", dbType: "INTEGER" },
      { name: "name", dbType: null },
    ]);
  });

  it("raw() は呼ばない（bun の raw は Uint8Array を返す別の機能で、引数は実行の値になる）", () => {
    const { db, raw } = bunLike();
    const opened = openStatement(db, "select");
    expect([...opened.rows([])]).toEqual([[1n, "a"]]);
    expect(raw).not.toHaveBeenCalled();
  });

  it("同名の列があるときだけ values() で全行を読む", () => {
    const { db } = bunLike({ columnNames: ["id", "id"], declaredTypes: [null, null] });
    const opened = openStatement(db, "select");
    expect([...opened.rows([])]).toEqual([[1n, "a"]]);
  });
});

describe("openStatement / 使えないドライバ", () => {
  it("列の情報を返せない node:sqlite（22.15 以前）は、使えないと分かるエラーにする", () => {
    expect(() => openStatement(dbOf({ setReadBigInts: () => {} }), "select")).toThrow(
      UnsupportedSqliteDriverError,
    );
    expect(() => openStatement(dbOf({ setReadBigInts: () => {} }), "select")).toThrow(/22\.16/);
  });
});

describe("openStatement / 行を返さない文", () => {
  it("reader が false の文は、columns() が例外になるドライバでも呼ばずに列を空にする（better-sqlite3）", () => {
    const columns = vi.fn(() => {
      throw new Error("The columns() method is only for statements that return data");
    });
    const opened = openStatement(
      dbOf({ reader: false, columns, safeIntegers: () => undefined }),
      "insert",
    );
    expect(opened.columns).toEqual([]);
    expect(columns).not.toHaveBeenCalled();
  });

  it("列が空なら rows は空で、run を使える", () => {
    const run = vi.fn(() => ({ changes: 2 }));
    const opened = openStatement(
      dbOf({ columns: () => [], safeIntegers: () => undefined, run }),
      "update t set a = 1",
    );
    expect(opened.columns).toEqual([]);
    expect([...opened.rows([])]).toEqual([]);
    expect(opened.run([])).toEqual({ changes: 2 });
  });

  it("BigInt に切り替える手段がないドライバでは、integersAsBigInt が false になる", () => {
    const opened = openStatement(dbOf({ columns: () => [] }), "select");
    expect(opened.integersAsBigInt).toBe(false);
  });
});
