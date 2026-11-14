# @myaaaaa_chan/db-viewer-server

The fetch handler and database adapters of db-viewer. See the repository README for the full guide.

```ts
import { createHandler, sqliteAdapter } from "@myaaaaa_chan/db-viewer-server";

const handler = createHandler({
  connections: { main: sqliteAdapter(db) },
  // Required. Pass `() => true` explicitly if everyone may use it.
  authorize: async (request) => isAdmin(await getSession(request)),
});

// Hono:    app.post("/admin/db", (c) => handler(c.req.raw));
// Next.js: export const POST = handler;
// Express: app.post("/admin/db", toNodeHandler(handler)); // before express.json(), see below
```

`toNodeHandler` is exported from `@myaaaaa_chan/db-viewer-server/node`. It needs the optional peer
dependencies `@hono/node-server` and `hono`. Put it on a route that runs before `express.json()`
or any other body parser, otherwise the request fails with "Body is unusable".

## Security

- The endpoint runs arbitrary SQL. Do not expose it to untrusted users.
- `authorize` is required. `readOnly` defaults to `true`.
- `readOnly` is one layer of defence. Connect with a database user that has only the privileges you need.

## SQLite

- **No statement timeout.** SQLite drivers have no way to interrupt a running statement, so
  `statementTimeoutMs` is not enforced (`capabilities.enforcesTimeout` is `false`). A heavy query
  blocks the whole process while it runs. Statements cannot be cancelled either.
- **Pass a dedicated instance, ideally opened read-only.** For `readOnly: true` the adapter switches
  `PRAGMA query_only` on for the duration of each call and restores the previous value afterwards,
  so your own writes on the same instance keep working. A `BEGIN` run from the SQL editor leaves a
  transaction open on the instance until a `COMMIT` or `ROLLBACK` is run, so do not rely on
  transactions of your own on the same instance while the viewer is mounted.
- **Drivers.** `better-sqlite3`, `node:sqlite` (Node.js 22.16 or later; 22.15 is not supported) and
  `bun:sqlite` are accepted. The adapter asks every statement for integers as `bigint`, whatever the
  driver defaults are, so values above 2^53 keep their digits.
- A query that returns two columns with the same name (`SELECT a.id, b.id ...`) works on
  `better-sqlite3`, `node:sqlite` 24 or later, and `bun:sqlite`. On `node:sqlite` 22.16 to 23.x it
  fails with a message asking for aliases. On `bun:sqlite` the whole result is read into memory
  before the row limit is applied.
- `PRAGMA query_only` stops changes to the database, not effects on the file system. `ATTACH
  DATABASE` and `VACUUM INTO` can still create files. Run the process as a user that may only write
  where it needs to.
- Only the `main` schema is shown. Internal `sqlite_*` tables are hidden.
