import { playwright } from "@vitest/browser-playwright";
import { defineProject } from "vitest/config";
import { coreAlias } from "./vitest.shared.ts";

export default defineProject({
  resolve: { alias: coreAlias, dedupe: ["react", "react-dom"] },
  // 事前バンドルの途中で React が 2 つにならないよう、先にまとめて指定する
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "vitest-browser-react",
    ],
  },
  test: {
    name: "react:browser",
    include: ["src/**/*.browser.test.{ts,tsx}"],
    testTimeout: 8000,
    setupFiles: ["./test/browser/setup.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});
