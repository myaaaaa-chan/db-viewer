# examples/hono

Hono + `@myaaaaa_chan/db-viewer-server` + `<DbViewer>` on an in-memory SQLite database (`fixtures/seed/sqlite.sql`).

```sh
pnpm build            # at the repository root, builds the packages first
pnpm --filter example-hono build
pnpm --filter example-hono serve   # http://127.0.0.1:3000 (set PORT to change)
```

For hot reload, run `serve` in one terminal and `pnpm --filter example-hono dev` in another (Vite proxies `/admin/db`).
`authorize` is `() => true` here because the server listens on `127.0.0.1` only. A real app checks its session.
