import Database from "better-sqlite3";
import { USER_COUNT, userEmail } from "../seed";
import { startCli } from "../support/cli";
import { expect, test } from "../support/fixtures";
import { openTable, runSql, switchToSql } from "../support/viewer";

test("ツリーでテーブルを開くとデータ表が出て、URL からトークンが消える", async ({ page, cli }) => {
  await page.goto(cli.url);
  await openTable(page, "users");
  await expect(page.getByRole("grid", { name: "main.users data" })).toBeVisible();
  await expect(page.getByRole("gridcell", { name: userEmail(1) })).toBeVisible();
  await expect(page.getByText("NULL", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Read-only")).toBeVisible();
  expect(page.url()).toBe(`${cli.origin}/`);
});

test("ビューも開ける", async ({ page, cli }) => {
  await page.goto(cli.url);
  await page.getByRole("treeitem", { name: "Views" }).click();
  await openTable(page, "active_users");
  await expect(page.getByRole("gridcell", { name: userEmail(10) })).toBeVisible();
});

test("WHERE 句で絞り込める", async ({ page, cli }) => {
  await page.goto(cli.url);
  await openTable(page, "users");
  await page.getByRole("textbox", { name: "WHERE clause" }).fill("id <= 3");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("Rows 1–3")).toBeVisible();
  await expect(page.getByRole("gridcell", { name: userEmail(3) })).toBeVisible();
  await expect(page.getByRole("gridcell", { name: userEmail(4) })).toHaveCount(0);
});

test("全件の件数を取得できる", async ({ page, cli }) => {
  await page.goto(cli.url);
  await openTable(page, "users");
  await page.getByRole("button", { name: "Get count" }).click();
  await expect(page.getByText(`${USER_COUNT} rows in total`)).toBeVisible();
});

test("セルを選んで Ctrl+C すると、TSV としてクリップボードに入る", async ({
  page,
  cli,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: cli.origin });
  await page.goto(cli.url);
  await openTable(page, "users");
  await page.getByRole("gridcell", { name: userEmail(2) }).click();
  await page.keyboard.press("ControlOrMeta+C");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(userEmail(2));
});

test("SQL タブで実行すると結果が表に出る", async ({ page, cli }) => {
  await page.goto(cli.url);
  await switchToSql(page);
  await runSql(page, "select count(*) as n from users");
  await expect(page.getByRole("grid", { name: "SQL result" })).toBeVisible();
  await expect(page.getByRole("gridcell", { name: String(USER_COUNT), exact: true })).toBeVisible();
});

test("SQL のエラーは画面に出る", async ({ page, cli }) => {
  await page.goto(cli.url);
  await switchToSql(page);
  await runSql(page, "select * from no_such_table");
  await expect(page.getByRole("alert")).toContainText("no_such_table");
});

const countOrders = (file: string): number => {
  const db = new Database(file, { readonly: true });
  try {
    return (db.prepare("select count(*) as n from orders").get() as { n: number }).n;
  } finally {
    db.close();
  }
};

test("読み取り専用では書き込みの SQL が拒否され、ファイルは変わらない", async ({
  page,
  cli,
  sqliteFile,
}) => {
  await page.goto(cli.url);
  await switchToSql(page);
  await runSql(page, "delete from orders");
  await expect(page.getByRole("alert")).toBeVisible();
  expect(countOrders(sqliteFile)).toBe(30);
});

test("--write を付けると書き込みの SQL が通り、読み取り専用の表示が消える", async ({
  page,
  sqliteFile,
}) => {
  const cli = await startCli([sqliteFile, "--write"]);
  try {
    await page.goto(cli.url);
    await expect(page.getByRole("treeitem", { name: "users", exact: true })).toBeVisible();
    await expect(page.getByText("Read-only")).toHaveCount(0);
    await switchToSql(page);
    await runSql(page, "delete from orders where id <= 5");
    await expect(page.getByText("5 rows affected")).toBeVisible();
    expect(countOrders(sqliteFile)).toBe(25);
  } finally {
    await cli.stop();
  }
});
