import { type DbResult, err } from "@myaaaaa_chan/db-viewer-core";
import type { Pool, PoolClient } from "pg";
import { connectionSurvives, type ErrorContext, toDbError } from "./errors";

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
  });
  const last = Array.isArray(results) ? results[results.length - 1] : results;
  return Number(last?.rows[0]?.[0]);
};

/**
 * 1 回の依頼 = 1 つのトランザクション（03 §4 読み取り専用）。
 * BEGIN READ ONLY（書き込み可なら BEGIN）→ SET LOCAL statement_timeout →（timeZone 指定時）
 * SET LOCAL TimeZone → work → ROLLBACK（書き込み可で work が成功したときだけ COMMIT）。
 *
 * work の中で利用者の SQL を流すのは 1 文まで。同じトランザクションで 2 本流すと、1 本目の
 * SET TRANSACTION READ WRITE で読み取り専用を外せる（R4）。
 *
 * 接続が壊れたかもしれないときは、Pool に戻さず捨てる。
 */
export const inTransaction = async <T>(
  pool: Pool,
  options: TransactionOptions,
  errorContext: ErrorContext,
  work: (session: Session) => Promise<DbResult<T>>,
): Promise<DbResult<T>> => {
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (cause) {
    return err(toDbError(cause, errorContext));
  }
  client.on("error", ignoreConnectionError);
  let discard = false;
  try {
    let outcome: DbResult<T>;
    try {
      const pid = await begin(client, options);
      outcome = await work({ client, pid });
    } catch (cause) {
      outcome = err(toDbError(cause, errorContext));
    }
    try {
      await client.query(outcome.ok && !options.readOnly ? "COMMIT" : "ROLLBACK");
    } catch (cause) {
      // 終わらせられなかった接続は Pool に戻さず捨てる。work が失敗していたら、その失敗のほうを返す
      discard = !connectionSurvives(cause);
      if (outcome.ok) outcome = err(toDbError(cause, errorContext));
    }
    return outcome;
  } finally {
    client.off("error", ignoreConnectionError);
    client.release(discard);
  }
};

/**
 * カタログの読み取りなど、トランザクションを使わない短い処理に接続を 1 本貸す。
 */
export const withClient = async <T>(
  pool: Pool,
  errorContext: ErrorContext,
  work: (client: PoolClient) => Promise<DbResult<T>>,
): Promise<DbResult<T>> => {
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (cause) {
    return err(toDbError(cause, errorContext));
  }
  client.on("error", ignoreConnectionError);
  let discard = false;
  try {
    return await work(client);
  } catch (cause) {
    // 文が失敗しただけなら接続は使える。それ以外（接続が切れたなど）は捨てる
    discard = !connectionSurvives(cause);
    return err(toDbError(cause, errorContext));
  } finally {
    client.off("error", ignoreConnectionError);
    client.release(discard);
  }
};
