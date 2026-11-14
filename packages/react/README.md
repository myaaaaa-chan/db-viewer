# @myaaaaa_chan/db-viewer-react

The `<DbViewer>` component: a schema tree, a data grid and a SQL editor. It talks to the handler of `@myaaaaa_chan/db-viewer-server`.

```tsx
import { createHttpDataSource, DbViewer } from "@myaaaaa_chan/db-viewer-react";
import "@myaaaaa_chan/db-viewer-react/styles.css";

const dataSource = createHttpDataSource({ endpoint: "/admin/db" });

<DbViewer dataSource={dataSource} />;
```

Peer dependencies: `react` and `react-dom` 18 or 19. See the repository README (`README.md` at the root) for options, theming and Next.js.
