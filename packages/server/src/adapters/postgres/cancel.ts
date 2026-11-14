import type { Pool } from "pg";
import { loadClient } from "./driver";
import { ConnectionFailedError } from "./errors";
import { queryRows } from "./statement";

/**
 * backend pid のクエリを止める。**Pool を通さず**に、新しい接続で pg_cancel_backend を呼ぶ。
 * Pool の接続をすべて使い切っていても止められるようにするため。
 *
 * 接続情報は pool.options をそのまま渡す。password は列挙されないプロパティで、`{ ...pool.options }` に
 * すると落ちる。connectionString、文字列の password、関数の password のどれでも動く。
 */
export const cancelBackend = async (pool: Pool, pid: number): Promise<boolean> => {
  const Client = await loadClient();
  const client = new Client(pool.options);
  // 接続が切れたときの 'error' を未処理にしない（プロセスを落とさない）
  client.on("error", () => undefined);
  try {
    await client.connect();
  } catch (cause) {
    // 認証や接続のエラーのメッセージは、ユーザー名や DB 名、アドレスを含みうる
    throw new ConnectionFailedError(cause);
  }
  try {
    const { rows } = await queryRows(client, "SELECT pg_catalog.pg_cancel_backend($1::int)", [pid]);
    return rows[0]?.[0] === "t";
  } finally {
    await client.end().catch(() => undefined);
  }
};
