import { test as base, expect } from "@playwright/test";
import { USER_COUNT, userEmail } from "../seed";
import { startCli } from "../support/cli";
import { dockerSkipReason, type SeededPostgres, startSeededPostgres } from "../support/postgres";
import { openTable, runSql, switchToSql } from "../support/viewer";

type Availability =
  | { readonly kind: "ready"; readonly postgres: SeededPostgres }
  | { readonly kind: "skipped"; readonly reason: string };

type Fixtures = { cli: Awaited<ReturnType<typeof startCli>>; postgres: SeededPostgres };
type WorkerFixtures = { availability: Availability };

const test = base.extend<Fixtures, WorkerFixtures>({
  availability: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright の fixture は第 1 引数を分割代入で受ける
    async ({}, use) => {
      const reason = await dockerSkipReason();
      if (reason !== null) {
        await use({ kind: "skipped", reason });
        return;
      }
      const postgres = await startSeededPostgres();
      await use({ kind: "ready", postgres });
      await postgres.stop();
    },
    { scope: "worker", timeout: 180_000 },
  ],
  postgres: async ({ availability }, use, testInfo) => {
    testInfo.skip(
      availability.kind === "skipped",
      availability.kind === "skipped" ? availability.reason : "",
    );
    if (availability.kind === "ready") await use(availability.postgres);
  },
  // README が推奨する DATABASE_URL で渡す（引数に認証情報を載せない）
  cli: async ({ postgres }, use) => {
    const cli = await startCli([], { DATABASE_URL: postgres.url });
    await use(cli);
    await cli.stop();
  },
});

// 1 つのコンテナを、このファイルのテストで共有する（worker ごとに起動しないよう、1 つの worker で流す）
test.describe.configure({ mode: "serial" });

test("PostgreSQL のツリーでテーブルを開くと、データ表が出る", async ({ page, cli }) => {
  await page.goto(cli.url);
  await openTable(page, "users");
  await expect(page.getByRole("grid", { name: "public.users data" })).toBeVisible();
  await expect(page.getByRole("gridcell", { name: userEmail(1) })).toBeVisible();
  await expect(page.getByText("Read-only")).toBeVisible();
  expect(page.url()).toBe(`${cli.origin}/`);
});

test("PostgreSQL で件数を数え、SQL を実行できる", async ({ page, cli }) => {
  await page.goto(cli.url);
  await openTable(page, "users");
  await page.getByRole("button", { name: "Get count" }).click();
  await expect(page.getByText(`${USER_COUNT} rows in total`)).toBeVisible();

  await switchToSql(page);
  await runSql(page, "select count(*)::int as n from orders");
  await expect(page.getByRole("gridcell", { name: "30", exact: true })).toBeVisible();
});

test("PostgreSQL では書き込みの SQL が読み取り専用の違反として拒否される", async ({
  page,
  cli,
}) => {
  await page.goto(cli.url);
  await switchToSql(page);
  await runSql(page, "delete from orders");
  await expect(page.getByRole("alert")).toBeVisible();
  await runSql(page, "select count(*)::int as n from orders");
  await expect(page.getByRole("gridcell", { name: "30", exact: true })).toBeVisible();
});

test("接続の URL に含まれるパスワードは、CLI の出力に出ない", async ({ cli, postgres }) => {
  expect(cli.output()).not.toContain(postgres.password);
});
