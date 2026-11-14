import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHandler, sqliteAdapter } from "@myaaaaa_chan/db-viewer-server";
import Database from "better-sqlite3";

const db = new Database(":memory:");
db.exec(readFileSync(join(process.cwd(), "../../fixtures/seed/sqlite.sql"), "utf8"));

export const handler = createHandler({
  connections: { main: sqliteAdapter(db) },
  // This example is for local use only. A real app checks its session here.
  authorize: () => true,
});
