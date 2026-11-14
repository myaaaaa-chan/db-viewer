import { existsSync } from "node:fs";
import type { DbAdapter } from "@myaaaaa_chan/db-viewer-server";
import { postgresAdapter, sqliteAdapter } from "@myaaaaa_chan/db-viewer-server";
import type { ConnectionSpec } from "./args";

export type OpenConnections = {
  readonly adapters: Readonly<Record<string, DbAdapter>>;
  readonly close: () => Promise<void>;
};

type Opened = { readonly adapter: DbAdapter; readonly close: () => Promise<void> };

// pg が出すメッセージに接続文字列のパスワードが入っていても、そのまま出さない。
export const scrubSecrets = (message: string, specs: ReadonlyArray<ConnectionSpec>): string =>
  specs.reduce((text, { target }) => {
    if (target.kind !== "postgres") return text;
    try {
      const { password } = new URL(target.url);
      return password === "" ? text : text.split(decodeURIComponent(password)).join("***");
    } catch {
      return text;
    }
  }, message);

const CONNECT_TIMEOUT_MS = 10_000;

const openPostgres = async (url: string, write: boolean): Promise<Opened> => {
  const { default: pg } = await import("pg");
  // このビューアーだけが使う小さな Pool（server の README の推奨どおり）
  const pool = new pg.Pool({
    connectionString: url,
    max: 3,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  });
  // アイドル中の接続をサーバーが切ると Pool が error を出す。待ち受けがないと Node が終了する。
  pool.on("error", () => {});
  const close = () => pool.end();
  try {
    await pool.query("select 1");
  } catch (cause) {
    await close().catch(() => {});
    throw cause;
  }
  return { adapter: postgresAdapter(pool, { readOnly: !write }), close };
};

const openSqlite = async (path: string, write: boolean): Promise<Opened> => {
  if (!existsSync(path)) throw new Error(`SQLite file not found: ${path}`);
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(path, { readonly: !write, fileMustExist: true });
  return {
    adapter: sqliteAdapter(db, { readOnly: !write }),
    close: async () => {
      db.close();
    },
  };
};

const openOne = ({ target }: ConnectionSpec, write: boolean): Promise<Opened> =>
  target.kind === "postgres" ? openPostgres(target.url, write) : openSqlite(target.path, write);

/**
 * 05_CLI §3 の 2。1 つでも開けなければ、開けたものを閉じてから、名前付きのエラーを投げる。
 */
export const openConnections = async (
  specs: ReadonlyArray<ConnectionSpec>,
  write: boolean,
): Promise<OpenConnections> => {
  const settled = await Promise.allSettled(specs.map((spec) => openOne(spec, write)));
  const opened = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  const closeAll = async () => {
    await Promise.allSettled(opened.map((entry) => entry.close()));
  };

  const failedAt = settled.findIndex((result) => result.status === "rejected");
  if (failedAt >= 0) {
    await closeAll();
    const failed = settled[failedAt];
    const cause = failed?.status === "rejected" ? failed.reason : undefined;
    const detail = cause instanceof Error ? cause.message : "unknown error";
    throw new Error(`Cannot connect to "${specs[failedAt]?.name}": ${scrubSecrets(detail, specs)}`);
  }

  const adapters: Record<string, DbAdapter> = {};
  specs.forEach((spec, index) => {
    const entry = settled[index];
    if (entry?.status === "fulfilled") adapters[spec.name] = entry.value.adapter;
  });
  return { adapters, close: closeAll };
};
