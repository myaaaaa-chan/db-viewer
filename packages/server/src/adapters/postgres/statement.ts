import type { CustomTypesConfig, FieldDef, QueryArrayConfig } from "pg";
import type Cursor from "pg-cursor";
import { connectionSurvives, UnsupportedStatementError } from "./errors";

// 値は DB が出力した文字列のまま受け取る（02 §3）。型の変換は問い合わせごとの指定だけで変え、
// pg.types のグローバルな設定には触れない（同じプロセスの ORM などの動きを変えないため。03 §4）。
export const TEXT_TYPES: CustomTypesConfig = { getTypeParser: () => (value: string) => value };

export type Cell = string | null;

export type StatementResult = {
  readonly fields: ReadonlyArray<FieldDef>;
  readonly rows: ReadonlyArray<ReadonlyArray<Cell>>;
  // コマンドタグの先頭の語（"SELECT"、"INSERT" など）
  readonly command: string | null;
  // 影響した行数。数えない文（DDL など）では null
  readonly rowCount: number | null;
};

// @types/pg の QueryConfig には queryMode がない（pg 8.12.0 から使える）
type ExtendedQuery = QueryArrayConfig & { readonly queryMode: "extended" };

type Queryable = {
  readonly query: (config: QueryArrayConfig) => Promise<{
    readonly fields: Array<FieldDef>;
    readonly rows: Array<Array<Cell>>;
    readonly command: string;
    readonly rowCount: number | null;
  }>;
};

/**
 * 1 文を extended protocol（Parse / Bind / Execute）で送る。複数の文を含む SQL は、DB が 42601 で拒否する。
 * values: [] だけでは simple protocol で送られ、"COMMIT; DELETE ..." が通ってしまう（R3）。
 *
 * 結果を全部受け取る。行数が小さいと分かっているものに使う（カタログ、LIMIT をつけて組み立てた SQL）。
 */
export const queryRows = async (
  client: Queryable,
  text: string,
  values: ReadonlyArray<unknown> = [],
): Promise<StatementResult> => {
  const config: ExtendedQuery = {
    text,
    values: [...values],
    rowMode: "array",
    types: TEXT_TYPES,
    queryMode: "extended",
  };
  const result = await client.query(config);
  return {
    fields: result.fields,
    rows: result.rows,
    command: result.command || null,
    rowCount: result.rowCount,
  };
};

// pg-cursor は COPY の応答（CopyInResponse、CopyData）を受ける関数を持たない。pg がそれを呼ぶと
// TypeError が未処理の例外になり、プロセスが落ちて結果も返らない。COPY は結果の表にならないので、
// TO STDOUT は受け取って捨て（コマンドの完了だけを返し）、FROM STDIN は流し込む元がないので断る。
const cursorWithoutCopy = (CursorClass: typeof Cursor) =>
  class extends CursorClass<Array<Cell>> {
    copyFromStdinRejected = false;

    handleCopyInResponse(connection: { sendCopyFail: (message: string) => void }) {
      this.copyFromStdinRejected = true;
      connection.sendCopyFail("COPY FROM STDIN is not supported");
    }

    handleCopyData() {}
  };

/**
 * 利用者の SQL 1 文を、カーソルで最大 maxRows + 1 行だけ読む。超えた分は DB が作らない
 * （数百万行の結果をプロセスのメモリに載せない）。maxRows を超えて読めたかで打ち切りが分かる。
 * Cursor も extended protocol なので、複数の文は 42601 で拒否される（R3）。
 */
export const readStatement = async (
  client: { readonly query: <T extends Cursor<Array<Cell>>>(cursor: T) => T },
  CursorClass: typeof Cursor,
  text: string,
  maxRows: number,
): Promise<StatementResult> => {
  const SafeCursor = cursorWithoutCopy(CursorClass);
  const cursor = client.query(new SafeCursor(text, [], { rowMode: "array", types: TEXT_TYPES }));
  try {
    const result = await new Promise<StatementResult>((resolve, reject) => {
      cursor.read(maxRows + 1, (error, rows, queryResult) => {
        if (error) return reject(error);
        resolve({
          fields: queryResult.fields,
          rows,
          command: queryResult.command || null,
          rowCount: queryResult.rowCount,
        });
      });
    });
    await cursor.close();
    return result;
  } catch (cause) {
    if (cursor.copyFromStdinRejected) {
      if (connectionSurvives(cause)) await cursor.close().catch(() => undefined);
      throw new UnsupportedStatementError("COPY FROM STDIN is not supported.");
    }
    // 文が失敗しただけなら、接続は生きていて、ポータルを閉じられる。接続が閉じられたときは待たない
    if (connectionSurvives(cause)) await cursor.close().catch(() => undefined);
    throw cause;
  }
};
