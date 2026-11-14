import { expect, test } from "../support/fixtures";

const listConnections = (origin: string, headers: Record<string, string> = {}) =>
  fetch(`${origin}/api`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ op: "listConnections" }),
  });

test("トークンなしの API は 401 を返す", async ({ cli }) => {
  expect((await listConnections(cli.origin)).status).toBe(401);
});

test("別のトークンの API は 401 を返し、正しいトークンなら 200 を返す", async ({ cli }) => {
  expect((await listConnections(cli.origin, { authorization: "Bearer wrong" })).status).toBe(401);
  const ok = await listConnections(cli.origin, { authorization: `Bearer ${cli.token}` });
  expect(ok.status).toBe(200);
  expect(await ok.json()).toMatchObject({ ok: true, value: [{ name: "shop", dialect: "sqlite" }] });
});

test("トークンを付けずに開くと、データは出ず認証エラーが画面に出る", async ({ page, cli }) => {
  await page.goto(cli.origin);
  await expect(page.getByRole("treeitem", { name: "users", exact: true })).toHaveCount(0);
  await expect(page.getByText("Could not load connections")).toBeVisible();
});

test("違うトークンで開いても、データは出ない", async ({ page, cli }) => {
  await page.goto(`${cli.origin}/#token=wrong`);
  await expect(page.getByText("Could not load connections")).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "users", exact: true })).toHaveCount(0);
});

test("トークンはクエリ文字列やサーバーの出力に残らない（フラグメントだけ）", async ({
  page,
  cli,
}) => {
  const requests: Array<string> = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(cli.url);
  await expect(page.getByRole("treeitem", { name: "users", exact: true })).toBeVisible();
  expect(requests.filter((url) => url.includes(cli.token))).toEqual([]);
  expect(await page.evaluate(() => document.referrer + location.href)).not.toContain(cli.token);
});

test("ほかのオリジンから、Content-Type が JSON でない POST は 400 になる", async ({ cli }) => {
  const response = await fetch(`${cli.origin}/api`, {
    method: "POST",
    headers: { "content-type": "text/plain", authorization: `Bearer ${cli.token}` },
    body: JSON.stringify({ op: "listConnections" }),
  });
  expect(response.status).toBe(400);
});
