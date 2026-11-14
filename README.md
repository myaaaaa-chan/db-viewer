# db-viewer

A DBeaver-like database viewer for your web app: a schema tree, a data grid with filters and paging, and a small SQL editor.
It is an npm library you mount in your own app, or a CLI you point at a database.

English | [日本語](./README.ja.md)

| Package                          | What it is                                                  |
| -------------------------------- | ----------------------------------------------------------- |
| `@myaaaaa_chan/db-viewer-react`  | The `<DbViewer>` component and its parts                    |
| `@myaaaaa_chan/db-viewer-server` | A fetch handler and the PostgreSQL / SQLite adapters        |
| `@myaaaaa_chan/db-viewer-core`   | Types and the HTTP `DataSource` shared by the others        |
| `@myaaaaa_chan/db-viewer-cli`    | `npx` command that opens a viewer for one or more databases |

The four packages always have the same version. Install the same number of each.
Requires Node.js 20 or later and React 18 or 19. Packages are ESM only.

## Security first

The viewer runs **arbitrary SQL** that your users type. Read this before you mount it.

- `authorize` is required. Without it the handler cannot be created. Pass `() => true` only when you really mean "everyone".
- Do not expose the viewer to users you do not trust.
- `readOnly` is `true` by default. It is one layer of defence, not the last one. Connect with a database user that has only the privileges it needs.
- Give the viewer its own small connection pool (for example `max` = `maxConcurrentQueries + 1`), so a long query cannot use up the connections of your app.
- SQLite: the adapter cannot stop a running statement (`statementTimeoutMs` is not enforced), so a heavy query blocks the process. Pass a dedicated instance, ideally opened read-only.

Details per database are in [packages/server/README.md](./packages/server/README.md).

## Quick start with the CLI

```sh
# PostgreSQL. Keep the password out of your shell history by using the environment variable.
DATABASE_URL=postgres://user:pass@localhost:5432/app npx @myaaaaa_chan/db-viewer-cli

# SQLite
npx @myaaaaa_chan/db-viewer-cli ./app.db

# Several named connections, writes allowed
npx @myaaaaa_chan/db-viewer-cli --name main=postgres://... --name cache=./cache.sqlite --write
```

The command is `db-viewer`. It checks the connection first (`SELECT 1` for PostgreSQL), prints a URL such as `http://127.0.0.1:51234/#token=...` and opens it. Stop it with Ctrl+C.
It listens on `127.0.0.1` only and protects its API with a random token in the URL fragment. Anyone who has that URL can run SQL with the privileges of the database user, so do not share it.

| Option                   | Meaning                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `<target>...`            | `postgres://` or `postgresql://` URLs, or files ending in `.db`, `.sqlite`, `.sqlite3` |
| `--name <name>=<target>` | Name a connection. Repeatable                                                          |
| `DATABASE_URL`           | Used when no target is given                                                           |
| `--write`                | Allow writes on every connection (read-only by default)                                |
| `--port <number>`        | Port to listen on. A free port by default                                              |
| `--no-open`              | Do not open the browser                                                                |

## Embed it in your app

Two parts: a handler on your server, and `<DbViewer>` in your front end.

```ts
// server
import { createHandler, sqliteAdapter } from "@myaaaaa_chan/db-viewer-server";

const handler = createHandler({
  connections: { main: sqliteAdapter(db) },
  authorize: async (request) => isAdmin(await getSession(request)),
});
```

```tsx
// client
import { createHttpDataSource, DbViewer } from "@myaaaaa_chan/db-viewer-react";
import "@myaaaaa_chan/db-viewer-react/styles.css";

const dataSource = createHttpDataSource({ endpoint: "/admin/db" });

export const Page = () => (
  <div style={{ height: "100vh" }}>
    <DbViewer dataSource={dataSource} />
  </div>
);
```

Give the parent a height. The viewer fills it.

### Hono

[examples/hono](./examples/hono) is a complete app (Hono, SQLite, Vite).

```ts
app.post("/admin/db", (c) => handler(c.req.raw));
```

### Next.js (App Router)

[examples/next](./examples/next) is a complete app.

```ts
// app/admin/db/route.ts
export const POST = handler;
```

```tsx
// app/admin/viewer.tsx. The component runs in the browser, so this file starts with "use client".
"use client";
import "@myaaaaa_chan/db-viewer-react/styles.css";
```

`better-sqlite3` is a native module. Add it to `serverExternalPackages` in `next.config.ts`.

### Express and other Node servers

```ts
import { toNodeHandler } from "@myaaaaa_chan/db-viewer-server/node";

// Put this route before express.json() or any body parser.
// A body that was already read makes the request fail with a 500.
app.post("/admin/db", toNodeHandler(handler));
```

`toNodeHandler` needs the optional peer dependencies `@hono/node-server` and `hono`.

## Options

### `createHandler`

| Option                        | Meaning                                                                                |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| `connections`                 | `Record<string, DbAdapter>`. The key is the connection name shown in the UI            |
| `authorize`                   | **Required.** `(request: Request) => boolean \| Promise<boolean>`. `false` answers 401 |
| `limits.maxRows`              | Rows returned by one query. Default 1000                                               |
| `limits.statementTimeoutMs`   | Statement timeout. Default 30000. Not enforced for SQLite                              |
| `limits.maxCellChars`         | Longest cell text sent to the browser. Default 10000                                   |
| `limits.maxConcurrentQueries` | Queries running at once per connection. More are refused with `busy`. Default 2        |

The default limits are design values and have not been measured.

### Adapters

| Adapter                           | Options                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `postgresAdapter(pool, options?)` | `readOnly` (default `true`), `timeZone` (for example `"Asia/Tokyo"`). Needs `pg` 8.12+ and `pg-cursor` 2.12+ |
| `sqliteAdapter(db, options?)`     | `readOnly` (default `true`). Accepts `better-sqlite3`, `node:sqlite` (Node.js 22.16+) and `bun:sqlite`       |

`better-sqlite3` 13 needs Node.js 22 or later. On Node.js 20 use `better-sqlite3` 12.

### `<DbViewer>`

| Prop         | Meaning                                                                 |
| ------------ | ----------------------------------------------------------------------- |
| `dataSource` | Required. Usually `createHttpDataSource({ endpoint, headers? })`        |
| `language`   | `"en"` (default) or `"ja"`, or a language you add with `resources`      |
| `resources`  | `Record<language, partial messages>`. Adds a language or overrides text |
| `theme`      | `"light"`, `"dark"` or `"system"` (default, follows the OS)             |
| `className`  | Class for the root element                                              |

`createHttpDataSource` takes `endpoint`, an optional `headers: () => HeadersInit | Promise<HeadersInit>` (called on every request) and an optional `fetch`.

The parts `<DbViewerProvider>`, `<SchemaTree>`, `<TableView>`, `<SqlEditor>` and `<ResultGrid>` are exported too, if you want your own layout. Put them inside `<DbViewerProvider>`.

## Theme and language

Colors, fonts and the radius are CSS variables named `--dbv-*`. Override them on `.dbv-root`:

```css
.dbv-root {
  --dbv-accent: #0f766e;
  --dbv-radius: 4px;
}
```

The variables are defined with `:where()`, so a plain `.dbv-root` rule wins. The stylesheet is not in a CSS layer.
If your page switches themes with a class or an attribute, pass `theme="light"` or `theme="dark"` yourself. `theme="system"` only follows `prefers-color-scheme`.

```tsx
<DbViewer
  dataSource={dataSource}
  language="ja"
  resources={{ ja: { viewer: { sql: "SQL 実行" } } }}
/>;
```

The viewer keeps no state outside memory (no `localStorage`). Reloading the page clears the SQL editor.

## Development

```sh
pnpm install
pnpm build        # packages and examples
pnpm test         # needs Docker for the PostgreSQL tests (Testcontainers)
pnpm lint && pnpm typecheck
```

Design documents are in [docs/設計](./docs/設計/01_MVP基本設計/README.md) and decisions in [docs/adr](./docs/adr/README.md) (Japanese).
Run `pnpm changeset` to describe a change for the next release.

## License

MIT
