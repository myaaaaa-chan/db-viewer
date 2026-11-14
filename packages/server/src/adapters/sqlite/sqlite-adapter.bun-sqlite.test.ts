import { schemaName } from "@myaaaaa_chan/db-viewer-core";
import { describe, it } from "vitest";
import { describeAdapterSuite } from "../../testing/adapter-suite";
import type { SqliteDatabaseLike } from "./driver";
import { sqliteAdapter } from "./index";

// bun:sqlite は Bun の中でしか読めない。Node の CI では対象外にし、Bun で vitest を動かしたときに流れる。
type BunSqlite = {
  readonly Database: new (path: string) => SqliteDatabaseLike & { close(): void };
};
const specifier = "bun:sqlite";
const bunSqlite = (
  "Bun" in globalThis ? await import(/* @vite-ignore */ specifier).catch(() => null) : null
) as BunSqlite | null;

if (bunSqlite !== null) {
  const { Database } = bunSqlite;
  describeAdapterSuite({
    name: "sqlite (bun:sqlite)",
    dialect: "sqlite",
    expectedCapabilities: { cancel: false, enforcesTimeout: false },
    open: async ({ readOnly }) => {
      const db = new Database(":memory:");
      return {
        adapter: sqliteAdapter(db, { readOnly }),
        schema: schemaName("main"),
        exec: async (sql) => {
          db.exec(sql);
        },
        close: async () => {
          db.close();
        },
      };
    },
  });
} else {
  describe("DbAdapter 共通テスト: sqlite (bun:sqlite)", () => {
    it.skip("Bun の中でだけ流れる（bun --bun vitest）", () => {});
  });
}
