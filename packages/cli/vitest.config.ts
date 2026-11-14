import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";

const source = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));

// 他のパッケージは dist を作る前でも読めるよう、テストではソースを直接読む。
export default defineProject({
  resolve: {
    alias: [
      { find: "@myaaaaa_chan/db-viewer-core", replacement: source("core/src/index.ts") },
      { find: "@myaaaaa_chan/db-viewer-server", replacement: source("server/src/index.ts") },
    ],
  },
  test: {
    name: "cli",
    environment: "node",
    include: ["src/**/*.test.ts", "ui/**/*.test.ts"],
  },
});
