import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";

// core は dist を作る前でも読めるよう、テストではソースを直接読む。
const coreSource = fileURLToPath(new URL("../core/src/index.ts", import.meta.url));

export default defineProject({
  resolve: { alias: [{ find: "@myaaaaa_chan/db-viewer-core", replacement: coreSource }] },
  test: {
    name: "server",
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
