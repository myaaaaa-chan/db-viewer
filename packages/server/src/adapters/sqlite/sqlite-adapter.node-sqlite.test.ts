import { schemaName } from "@myaaaaa_chan/db-viewer-core";
import { describe, it } from "vitest";
import { describeAdapterSuite } from "../../testing/adapter-suite";
import type { SqliteDatabaseLike } from "./driver";
import { sqliteAdapter } from "./index";

// @types/node 20 には node:sqlite の型がない（ビルドの最小の Node に合わせているため）。型を持たない形で読む。
type NodeSqlite = {
  readonly DatabaseSync: new (path: string) => SqliteDatabaseLike & { close(): void };
};
const specifier = "node:sqlite";
const nodeSqlite = (await import(specifier).catch(() => null)) as NodeSqlite | null;

// 列の名前を返す columns() は Node 22.16 から。それより前の node:sqlite は README で対象外にしている（R9）。
const supported =
  nodeSqlite !== null &&
  typeof new nodeSqlite.DatabaseSync(":memory:").prepare("SELECT 1").columns === "function";

if (nodeSqlite !== null && supported) {
  const { DatabaseSync } = nodeSqlite;
  describeAdapterSuite({
    name: "sqlite (node:sqlite)",
    dialect: "sqlite",
    expectedCapabilities: { cancel: false, enforcesTimeout: false },
    open: async ({ readOnly }) => {
      const db = new DatabaseSync(":memory:");
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
  describe("DbAdapter 共通テスト: sqlite (node:sqlite)", () => {
    it.skip("この Node の node:sqlite は columns() がない（22.16 未満）ので対象外", () => {});
  });
}
