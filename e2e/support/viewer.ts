import type { Page } from "@playwright/test";

// 画面の操作を、ARIA の役割と名前（英語の文言）で表す。
export const openTable = async (page: Page, table: string) => {
  await page.getByRole("treeitem", { name: table, exact: true }).click();
};

export const switchToSql = async (page: Page) => {
  await page.getByRole("tab", { name: "SQL" }).click();
};

export const runSql = async (page: Page, sql: string) => {
  const editor = page.getByRole("textbox", { name: "SQL" });
  await editor.fill(sql);
  await page.getByRole("button", { name: "Run the statement at the cursor" }).click();
};
