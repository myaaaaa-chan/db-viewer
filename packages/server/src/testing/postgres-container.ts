import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { getContainerRuntimeClient } from "testcontainers";

// 手元では postgres:17。別の版で流すときは DB_VIEWER_TEST_POSTGRES_IMAGE（例: postgres:14）を指定する
const { CI, DB_VIEWER_TEST_POSTGRES_IMAGE } = process.env;
const IMAGE = DB_VIEWER_TEST_POSTGRES_IMAGE ?? "postgres:17";

export type DockerStatus =
  | { readonly available: true }
  | { readonly available: false; readonly reason: string };

/**
 * Docker（コンテナのランタイム）に繋がるか。繋がらない環境では PostgreSQL のテストをスキップする。
 * ただし CI（環境変数 CI がある）では、黙ってスキップせず失敗させる。アダプターのテストが
 * 1 本も流れないまま緑になるのを防ぐため。
 */
export const detectDocker = async (): Promise<DockerStatus> => {
  try {
    await getContainerRuntimeClient();
    return { available: true };
  } catch (cause) {
    const reason = `Docker に接続できません（${cause instanceof Error ? cause.message : String(cause)}）。Docker を起動するか、DOCKER_HOST を設定してください`;
    if (CI) throw new Error(reason);
    return { available: false, reason };
  }
};

export type PostgresServer = {
  readonly container: StartedPostgreSqlContainer;
  readonly uri: string;
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
};

export const startPostgres = async (): Promise<PostgresServer> => {
  const container = await new PostgreSqlContainer(IMAGE).start();
  return {
    container,
    uri: container.getConnectionUri(),
    host: container.getHost(),
    port: container.getPort(),
    user: container.getUsername(),
    password: container.getPassword(),
    database: container.getDatabase(),
  };
};
