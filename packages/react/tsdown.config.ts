import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: "esm",
  platform: "browser",
  target: "es2022",
  dts: true,
  clean: true,
  // Next.js の RSC 環境で、このパッケージ全体をクライアントの部品として扱わせる
  banner: { js: '"use client";' },
  // styles.css は JS から import せず、そのまま配る（利用者が明示的に import する）
  copy: [{ from: "src/styles.css", to: "dist" }],
});
