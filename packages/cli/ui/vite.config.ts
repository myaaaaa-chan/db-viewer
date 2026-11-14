import { defineConfig } from "vite";

export default defineConfig({
  root: import.meta.dirname,
  build: {
    outDir: "../dist/ui",
    emptyOutDir: true,
    target: "es2022",
    // SQL エディタ（CodeMirror）を含むので 500 kB を超える。CLI は localhost から配るので分割しない
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      // 依存の "use client" は、このアプリ（クライアントだけ）では意味を持たない
      onLog(level, log, defaultHandler) {
        if (log.code === "MODULE_LEVEL_DIRECTIVE") return;
        defaultHandler(level, log);
      },
    },
  },
});
