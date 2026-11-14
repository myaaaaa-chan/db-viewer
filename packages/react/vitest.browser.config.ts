import { playwright } from "@vitest/browser-playwright";
import { defineProject } from "vitest/config";
import { coreAlias } from "./vitest.shared.ts";

export default defineProject({
  resolve: { alias: coreAlias },
  test: {
    name: "react:browser",
    include: ["src/**/*.browser.test.{ts,tsx}"],
    testTimeout: 8000,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});
