import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as base } from "@playwright/test";
import Database from "better-sqlite3";
import { SEED_SQL } from "../seed";
import { type RunningCli, startCli } from "./cli";

type Fixtures = {
  // 初期データ入りの SQLite ファイル（テストごとに作る）
  sqliteFile: string;
  // sqliteFile に対して CLI を起動する（読み取り専用）
  cli: RunningCli;
};

export const test = base.extend<Fixtures>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright の fixture は第 1 引数を分割代入で受ける
  sqliteFile: async ({}, use) => {
    const directory = mkdtempSync(join(tmpdir(), "dbv-e2e-"));
    const file = join(directory, "shop.db");
    const db = new Database(file);
    for (const statement of SEED_SQL) db.exec(statement);
    db.close();
    await use(file);
    rmSync(directory, { recursive: true, force: true });
  },
  cli: async ({ sqliteFile }, use) => {
    const cli = await startCli([sqliteFile]);
    await use(cli);
    await cli.stop();
  },
});

export { expect } from "@playwright/test";
