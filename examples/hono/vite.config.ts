import { defineConfig } from "vite";

export default defineConfig({
  root: "client",
  build: { outDir: "../dist", emptyOutDir: true },
  server: { proxy: { "/admin/db": "http://127.0.0.1:3000" } },
});
