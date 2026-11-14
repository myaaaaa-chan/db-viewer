import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createHandler, sqliteAdapter } from "@myaaaaa_chan/db-viewer-server";
import Database from "better-sqlite3";
import { Hono } from "hono";

const db = new Database(":memory:");
db.exec(readFileSync(new URL("../../../fixtures/seed/sqlite.sql", import.meta.url), "utf8"));

const handler = createHandler({
  connections: { main: sqliteAdapter(db) },
  // This example listens on 127.0.0.1 only. A real app checks its session here.
  authorize: () => true,
});

const app = new Hono();
app.post("/admin/db", (c) => handler(c.req.raw));
app.use("/*", serveStatic({ root: "./dist" }));

const port = Number(process.env["PORT"] ?? 3000);
serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, () => {
  console.log(`db-viewer example: http://127.0.0.1:${port}`);
});
