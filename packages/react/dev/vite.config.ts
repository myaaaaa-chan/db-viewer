import { defineConfig } from "vite";
import { coreAlias } from "../vitest.shared.ts";

export default defineConfig({
  root: import.meta.dirname,
  resolve: { alias: coreAlias, dedupe: ["react", "react-dom"] },
  server: { port: 5174, strictPort: true },
});
