import { defineConfig } from "tsdown";

// UI（dist/ui）は vite build が作る。tsdown は先に dist を空にするので、build の順序は tsdown、vite の順にする。
export default defineConfig({
  entry: { bin: "src/bin.ts" },
  format: "esm",
  platform: "node",
  target: "node20",
  dts: false,
  clean: true,
  fixedExtension: false,
});
