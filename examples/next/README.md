# examples/next

Next.js App Router. `app/admin/db/route.ts` exports the handler as `POST`, and `app/admin/viewer.tsx` is a `"use client"` component that renders `<DbViewer>` and imports `styles.css`.
CI builds this example to check the RSC setup (design risk R7).

```sh
pnpm build                          # at the repository root, builds the packages first
pnpm --filter example-next build
pnpm --filter example-next start    # http://localhost:3000/admin
```

`better-sqlite3` is listed in `serverExternalPackages` of `next.config.ts` because it is a native module.
`authorize` is `() => true` for this local example. A real app checks its session. Do not deploy or expose this example with `authorize: () => true`: anyone who can reach it can run SQL.
