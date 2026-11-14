import { fileURLToPath } from "node:url";

const coreSource = (path: string) => fileURLToPath(new URL(`../core/src/${path}`, import.meta.url));

// core は dist を作る前でも読めるよう、テストと dev ページではソースを直接読む。
export const coreAlias = [
  { find: "@myaaaaa_chan/db-viewer-core/testing", replacement: coreSource("testing/index.ts") },
  { find: "@myaaaaa_chan/db-viewer-core", replacement: coreSource("index.ts") },
];
