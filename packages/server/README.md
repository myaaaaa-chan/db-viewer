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

## PostgreSQL

```ts
import pg from "pg";
import { createHandler, postgresAdapter } from "@myaaaaa_chan/db-viewer-server";

// A small Pool that only the viewer uses, connected as a read-only database user.
const pool = new pg.Pool({ connectionString: process.env.VIEWER_DATABASE_URL, max: 3 });

const handler = createHandler({
  connections: { main: postgresAdapter(pool, { timeZone: "Asia/Tokyo" }) },
  authorize: async (request) => isAdmin(await getSession(request)),
});
```

- **Install the drivers.** `pg` (8.12.0 or later, for `queryMode: "extended"`) and `pg-cursor` (2.12.0 or
  later) are optional peer dependencies: `npm install pg pg-cursor`. `pg-cursor` reads at most
  `maxRows + 1` rows of a result, so `SELECT * FROM big_table` does not load the whole table into your
  process. If it is missing, running SQL fails with a message that says so.
- **Pass a dedicated, small Pool.** One query holds a connection for up to `statementTimeoutMs` (30 s by
  default). With the Pool of your app, a few slow queries can leave the app without connections. Cancelling
  does not need a connection from the Pool: the adapter opens a temporary connection with `pool.options` (as
  they are, so `connectionString`, a string `password` and a `password` function all work). Starting point
  for `max`: `maxConcurrentQueries + 1` (default 2 + 1; a design guideline, not measured). Beyond
  `maxConcurrentQueries` running queries, further requests are answered with `busy` instead of waiting.
- **Connect as a read-only database user.** `readOnly` is one layer of defence. Each request runs in its own
  `BEGIN READ ONLY` transaction, and the SQL you type runs as one statement over the extended protocol, so a
  second statement (`COMMIT; DELETE ...`) is rejected by the database. The last line of defence is the
  privileges of the database user: with the `dblink` extension installed, `dblink_exec` runs a write in
  another session, outside the read-only transaction (measured), so do not install it for this user.
- **Set `connectionTimeoutMillis` and an `error` listener on the Pool.** `pg` waits for a free connection
  forever by default (`connectionTimeoutMillis: 0`), so a request that waits for a connection of a Pool
  that is in use never ends by itself (cancelling it does end it). `pg` also emits `error` on the Pool when
  an idle connection is closed by the server, and Node.js ends the process if nobody listens
  (`pool.on("error", ...)`), for example when the SQL you type terminates the other sessions.
- **State that a statement leaves in the session stays on the Pool connection.** Everything inside the
  transaction is rolled back, but not session-level advisory locks (`pg_advisory_lock`), `PREPARE`d
  statements, `DEALLOCATE ALL`, `LISTEN`, or `PREPARE TRANSACTION` (if `max_prepared_transactions` is above
  0). With `readOnly: false` each request ends with `COMMIT`, so a plain `SET` (for example
  `SET search_path`, `SET client_encoding`) and `DECLARE ... WITH HOLD` cursors stay as well. Use a Pool
  that only the viewer uses, and a database user that may not do these things. The adapter does not run
  `DISCARD ALL`, because that would also reset the prepared statements of the app on a shared Pool.
- **Time zone.** `timeZone` runs `SET LOCAL TimeZone` before each request, so `timestamptz` values are shown in
  that zone and other users of the Pool are not affected. Without it, the database default is used.
- **Values.** Results are read as text, with a per-query `types` option. The adapter never calls
  `pg.types.setTypeParser`, so ORMs in the same process keep their parsers. Column types are shown as
  `format_type` prints them (`integer[]`, `character varying(255)`, `numeric(10,2)`).
- **Cancelling needs one more connection.** If the database has no free connection (`max_connections`), the
  cancel request fails and the query runs until `statementTimeoutMs`. The request is given up after 5 s (a
  design value, not measured); the Pool connection that ran the query is then closed instead of reused.
- **Catalog reads (schemas, tables, table details) have a 30 s timeout** and run in a read-only transaction.
  Another session that holds a lock on the table (for example a running `ALTER TABLE`) makes the detail
  of that table time out instead of waiting.
- **Very large values.** `execute` cuts a cell to `maxCellChars` after it has been received, and `fetchCell`
  returns the whole value, so the process has to hold what the database sends. A single value of about
  512 million characters or more cannot be received by Node.js (`ERR_STRING_TOO_LONG` is thrown inside `pg`
  and ends the process), and many large values in one result use that much memory. `fetchRows` cuts the
  cells in SQL and is not affected. Keep such tables away from the viewer, or give the database user a
  `statement_timeout`/row-level permissions that do not allow reading them.
- **Not supported.** `COPY ... FROM STDIN` is rejected with SQLSTATE `0A000`. `COPY ... TO STDOUT` runs, but
  its output is discarded and only the number of rows is shown. A statement that contains `;` inside it
  (`CREATE FUNCTION ... BEGIN ATOMIC ...; ...; END`, a rule with several actions in parentheses) is
  answered with `multipleStatements`, because the editor's statement splitter treats it as several statements.
- **A `queryId` that is still running is refused.** Use a new id for every run.
- **DDL is approximate.** The `CREATE` statement shown for a table is built from the catalog
  (`approximate: true`). Views use `pg_get_viewdef`.
- **Tested with** PostgreSQL 14, 17 and 18 (Testcontainers). The tests need Docker; set `DOCKER_HOST` when
  your Docker client does not use `/var/run/docker.sock`. Without Docker they are skipped, and they fail
  when the environment variable `CI` is set.

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
