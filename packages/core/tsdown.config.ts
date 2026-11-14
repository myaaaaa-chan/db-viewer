import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    testing: "src/testing/index.ts",
  },
  format: "esm",
  platform: "neutral",
  target: "es2022",
  dts: true,
  clean: true,
});
