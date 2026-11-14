import { type DbResult, type DbViewerError, err } from "@myaaaaa_chan/db-viewer-core";
import type { Pool, PoolClient } from "pg";
import { ConnectionFailedError, connectionSurvives, type ErrorContext, toDbError } from "./errors";
import { TEXT_TYPES } from "./statement";

export type TransactionOptions = {
  readonly readOnly: boolean;
  readonly statementTimeoutMs: number;
  // 指定したときだけ SET LOCAL TimeZone を発行する。指定しなければ DB の既定のまま
  readonly timeZone: string | undefined;
};

export type Session = {
  readonly client: PoolClient;
  // 接続の向こうの backend の pid（Pool の前に pgbouncer などがあっても、DB 側の値）
  readonly pid: number;
  // この接続を Pool に戻さず捨てる（COMMIT / ROLLBACK は通常どおり行う）
  readonly discard: () => void;
};

export type TransactionHooks = {
  // 接続を待っている間に、これが解決したら待つのをやめて、解決した値のエラーを返す
  readonly abortConnect?: Promise<DbViewerError>;
};

// 接続を貸している間に切れても、'error' が未処理でプロセスが落ちないようにする。
// 切れた接続での次の問い合わせは失敗として返るので、状態は失われない。
const ignoreConnectionError = () => undefined;

const beginStatements = (
  client: PoolClient,
  options: TransactionOptions,
): ReadonlyArray<string> => [
  options.readOnly ? "BEGIN READ ONLY" : "BEGIN",
  `SET LOCAL statement_timeout = ${options.statementTimeoutMs}`,
  ...(options.timeZone === undefined
    ? []
    : [`SET LOCAL TimeZone TO ${client.escapeLiteral(options.timeZone)}`]),
  "SELECT pg_catalog.pg_backend_pid()",
];

// 準備の文は、こちらで書いた固定の文だけなので、1 回の通信にまとめる（simple protocol）。
// 利用者の SQL はここに入れない。
const begin = async (client: PoolClient, options: TransactionOptions): Promise<number> => {
  const results = await client.query({
    text: beginStatements(client, options).join(";\n"),
    rowMode: "array",
    // 組み込み先が int4 のパーサーを替えていても、pid を数として読めるように
    types: TEXT_TYPES,
  });
  const last = Array.isArray(results) ? results[results.length - 1] : results;
  return Number(last?.rows[0]?.[0]);
};

type Connected = { readonly client: PoolClient } | { readonly aborted: DbViewerError };

// Pool が使い切られていると、pool.connect() は（connectionTimeoutMillis が 0 の既定では）いつまでも待つ。
// 待っている間に中断が来たら、待つのをやめる。後から取れた接続は、使わずに返す。
const connect = async (pool: Pool, hooks: TransactionHooks): Promise<Connected> => {
  const connecting = pool.connect();
  if (hooks.abortConnect === undefined) return { client: await connecting };
  const aborted = hooks.abortConnect.then((error) => ({ aborted: error }));
  const winner = await Promise.race([connecting.then((client) => ({ client })), aborted]);
  if ("aborted" in winner) {
    connecting.then(
      (client) => client.release(),
      () => undefined,
    );
  }
  return winner;
};

/**
 * 1 回の依頼 = 1 つのトランザクション。
 * BEGIN READ ONLY（書き込み可なら BEGIN）→ SET LOCAL statement_timeout →（timeZone 指定時）
 * SET LOCAL TimeZone → work → ROLLBACK（書き込み可で work が成功したときだけ COMMIT）。
 *
 * work の中で利用者の SQL を流すのは 1 文まで。同じトランザクションで 2 本流すと、1 本目の
 * SET TRANSACTION READ WRITE で読み取り専用を外せる。
 *
 * 接続が壊れたかもしれないときは、Pool に戻さず捨てる。
 */
export const inTransaction = async <T>(
  pool: Pool,
  options: TransactionOptions,
  errorContext: ErrorContext,
  work: (session: Session) => Promise<DbResult<T>>,
  hooks: TransactionHooks = {},
): Promise<DbResult<T>> => {
  let connected: Connected;
  try {
    connected = await connect(pool, hooks);
  } catch (cause) {
    return err(toDbError(new ConnectionFailedError(cause), errorContext));
  }
  if ("aborted" in connected) return err(connected.aborted);

  const { client } = connected;
  client.on("error", ignoreConnectionError);
  let discard = false;
  try {
    let outcome: DbResult<T>;
    try {
      const pid = await begin(client, options);
      outcome = await work({
        client,
        pid,
        discard: () => {
          discard = true;
        },
      });
    } catch (cause) {
      outcome = err(toDbError(cause, errorContext));
    }
    try {
      await client.query(outcome.ok && !options.readOnly ? "COMMIT" : "ROLLBACK");
    } catch (cause) {
      // 終わらせられなかった接続は Pool に戻さず捨てる。work が失敗していたら、その失敗のほうを返す
      discard = discard || !connectionSurvives(cause);
      if (outcome.ok) outcome = err(toDbError(cause, errorContext));
    }
    return outcome;
  } finally {
    client.off("error", ignoreConnectionError);
    client.release(discard);
  }
};
