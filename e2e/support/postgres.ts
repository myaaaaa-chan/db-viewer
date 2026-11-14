import pg from "pg";
import { SEED_SQL } from "../seed";

// 手元では postgres:17。別の版で流すときは DB_VIEWER_TEST_POSTGRES_IMAGE を指定する（server のテストと同じ）
const { CI, DB_VIEWER_TEST_POSTGRES_IMAGE } = process.env;
const IMAGE = DB_VIEWER_TEST_POSTGRES_IMAGE ?? "postgres:17";

/** Docker に繋がらないとき、手元ではスキップし、CI では失敗させる（黙って緑にしない）。 */
export const dockerSkipReason = async (): Promise<string | null> => {
  try {
    const { getContainerRuntimeClient } = await import("testcontainers");
    await getContainerRuntimeClient();
    return null;
  } catch (cause) {
    const reason = `Docker に接続できません（${cause instanceof Error ? cause.message : String(cause)}）`;
    if (CI) throw new Error(reason);
    return reason;
  }
};

export type SeededPostgres = {
  readonly url: string;
  readonly password: string;
  readonly stop: () => Promise<void>;
};

export const startSeededPostgres = async (): Promise<SeededPostgres> => {
  const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
  const container = await new PostgreSqlContainer(IMAGE).start();
  const url = container.getConnectionUri();
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    for (const statement of SEED_SQL) await client.query(statement);
  } finally {
    await client.end();
  }
  return { url, password: container.getPassword(), stop: () => container.stop().then(() => {}) };
};
