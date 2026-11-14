import type { ResultColumn } from "@myaaaaa_chan/db-viewer-core";

/*
 * アダプターが受け取る SQLite ドライバの型。
 *
 * better-sqlite3 / node:sqlite / bun:sqlite の 3 つを実際に動かして比べた結果（2026-11-14）、
 * 3 つに共通で、同じ意味で使えるのは次のものだけだった。
 *   Database:  prepare(sql) / exec(sql)
 *   Statement: all(...params) / iterate(...params) / run(...params)
 * ただし all と iterate の行は、既定ではオブジェクトで、同名の列が 1 つにまとまり、
 * 2^53 を超える整数は丸められる（node:sqlite は例外）。列の名前と宣言された型も取れない。
 * これでは 02 §3 の値の表し方を守れないので、次の任意のメンバーを宣言し、あるものを実行時に使う。
 * 名前もしくは意味がドライバごとに違うため、共通の名前にはできなかった。
 *
 *   列の名前と宣言された型  columns()                     better-sqlite3, node:sqlite（22.16 以上）
 *                          （better-sqlite3 は行を返さない文で例外になるので reader で先に見分ける）
 *                          columnNames と declaredTypes   bun:sqlite
 *   整数を BigInt で受け取る  safeIntegers(true)             better-sqlite3, bun:sqlite
 *                          setReadBigInts(true)           node:sqlite
 *   配列の行               raw(true)                      better-sqlite3
 *                          setReturnArrays(true)          node:sqlite（24 以上）
 *                          values()                       bun:sqlite（全行を一度に読む）
 *
 * bun:sqlite の raw() は Uint8Array の配列を返す別の機能なので、better-sqlite3 の raw(true) と
 * 見分けて呼ぶ（columns() があるものだけ）。
 */
export interface SqliteStatementLike {
  all(...params: Array<unknown>): ReadonlyArray<unknown>;
  iterate(...params: Array<unknown>): Iterable<unknown>;
  run(...params: Array<unknown>): { readonly changes: number | bigint };

  // false なら行を返さない文。better-sqlite3 は、行を返さない文の columns() が例外になる
  readonly reader?: boolean;
  columns?(): ReadonlyArray<{ readonly name: string; readonly type: string | null }>;
  readonly columnNames?: ReadonlyArray<string>;
  readonly declaredTypes?: ReadonlyArray<string | null>;
  safeIntegers?(enabled?: boolean): unknown;
  setReadBigInts?(enabled: boolean): void;
  // bun:sqlite の raw は引数の型が違う別の機能なので、引数を取らない型にして、better-sqlite3 だけを呼ぶ
  raw?(...params: Array<never>): unknown;
  setReturnArrays?(enabled: boolean): void;
  values?(...params: Array<unknown>): ReadonlyArray<ReadonlyArray<unknown>>;
}

export interface SqliteDatabaseLike {
  prepare(sql: string): SqliteStatementLike;
  exec(sql: string): void;
}

export class UnsupportedSqliteDriverError extends Error {
  override readonly name = "UnsupportedSqliteDriverError";
}

// 同名の列を返すクエリを、オブジェクトの行しか返せないドライバで実行した。黙って列を 1 つ落とさず、失敗にする。
export class DuplicateColumnNamesError extends Error {
  override readonly name = "DuplicateColumnNamesError";
  constructor() {
    super(
      "This SQLite driver cannot return two columns with the same name. Give each column a distinct alias with AS.",
    );
  }
}

export type OpenedStatement = {
  // 行を返さない文（INSERT など）では空
  readonly columns: ReadonlyArray<ResultColumn>;
  // true なら INTEGER は bigint で届く。false の接続では number が INTEGER か REAL か区別できない
  readonly integersAsBigInt: boolean;
  readonly rows: (params: ReadonlyArray<string | number>) => Iterable<ReadonlyArray<unknown>>;
  readonly run: (params: ReadonlyArray<string | number>) => { readonly changes: number | bigint };
};

const enableBigIntegers = (statement: SqliteStatementLike): boolean => {
  if (typeof statement.safeIntegers === "function") {
    statement.safeIntegers(true);
    return true;
  }
  if (typeof statement.setReadBigInts === "function") {
    statement.setReadBigInts(true);
    return true;
  }
  return false;
};

const readColumns = (statement: SqliteStatementLike): ReadonlyArray<ResultColumn> => {
  if (statement.reader === false) return [];
  if (typeof statement.columns === "function") {
    return statement.columns().map((column) => ({ name: column.name, dbType: column.type }));
  }
  if (Array.isArray(statement.columnNames)) {
    return statement.columnNames.map((name, index) => ({
      name,
      dbType: statement.declaredTypes?.[index] ?? null,
    }));
  }
  throw new UnsupportedSqliteDriverError(
    "This SQLite driver does not report column names. node:sqlite needs Node.js 22.16 or later; better-sqlite3 and bun:sqlite are supported as they are.",
  );
};

type RowReader = (params: ReadonlyArray<string | number>) => Iterable<ReadonlyArray<unknown>>;

function* pickByNames(
  rows: Iterable<unknown>,
  names: ReadonlyArray<string>,
): Iterable<ReadonlyArray<unknown>> {
  for (const row of rows) {
    const record = row as Readonly<Record<string, unknown>>;
    yield names.map((name) => record[name]);
  }
}

const rowReader = (
  statement: SqliteStatementLike,
  columns: ReadonlyArray<ResultColumn>,
): RowReader => {
  const iterateArrays: RowReader = (params) =>
    statement.iterate(...params) as Iterable<ReadonlyArray<unknown>>;

  if (typeof statement.setReturnArrays === "function") {
    statement.setReturnArrays(true);
    return iterateArrays;
  }
  if (typeof statement.raw === "function" && typeof statement.columns === "function") {
    (statement.raw as (enabled: boolean) => unknown).call(statement, true);
    return iterateArrays;
  }

  // ここから先はオブジェクトの行しか読めない。同名の列があると 1 つにまとまってしまう。
  const names = columns.map((column) => column.name);
  if (new Set(names).size === names.length) {
    return (params) => pickByNames(statement.iterate(...params), names);
  }
  const values = statement.values;
  if (typeof values === "function") {
    return (params) => values.call(statement, ...params);
  }
  throw new DuplicateColumnNamesError();
};

// 1 回の実行ごとに文を作り、ドライバごとの違いを吸収した形（配列の行・BigInt の整数）にそろえる。
// DB の既定（better-sqlite3 の defaultSafeIntegers など）に左右されないよう、毎回明示して設定する。
export const openStatement = (db: SqliteDatabaseLike, sql: string): OpenedStatement => {
  const statement = db.prepare(sql);
  const integersAsBigInt = enableBigIntegers(statement);
  const columns = readColumns(statement);
  const rows: RowReader = columns.length === 0 ? () => [] : rowReader(statement, columns);
  return {
    columns,
    integersAsBigInt,
    rows,
    run: (params) => statement.run(...params),
  };
};

// アダプターを作る時点で、使えるドライバかを確かめる。使えないものは、最初のリクエストを待たずに分かるようにする。
export const assertSupportedDriver = (db: SqliteDatabaseLike): void => {
  openStatement(db, "SELECT 1 AS probe");
};
