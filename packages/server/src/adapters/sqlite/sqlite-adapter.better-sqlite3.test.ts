import { schemaName } from "@myaaaaa_chan/db-viewer-core";
import Database from "better-sqlite3";
import { describeAdapterSuite } from "../../testing/adapter-suite";
import { sqliteAdapter } from "./index";

describeAdapterSuite({
  name: "sqlite (better-sqlite3)",
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
