import { defineProject } from "vitest/config";
import { coreAlias } from "./vitest.shared.ts";

export default defineProject({
  resolve: { alias: coreAlias },
  test: {
    name: "react",
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.browser.test.{ts,tsx}"],
  },
});
