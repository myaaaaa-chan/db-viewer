import { defineConfig } from "@playwright/test";

const { CI } = process.env;

// CLI は dist を起動する。先に `pnpm build` が要る（support/cli.ts が無ければ案内して止まる）。
export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: Boolean(CI),
  retries: CI ? 1 : 0,
  reporter: CI ? [["github"], ["list"]] : "list",
  use: {
    browserName: "chromium",
    trace: "retain-on-failure",
    // CLI は 127.0.0.1 の空きポートで起動する。ブラウザの locale は英語に固定する（画面の文言を確かめるため）
    locale: "en-US",
  },
});
