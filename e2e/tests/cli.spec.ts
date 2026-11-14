import { createServer } from "node:net";
import { runCliToExit, startCli } from "../support/cli";
import { expect, test } from "../support/fixtures";

test("引数がなく DATABASE_URL もなければ、使い方を出して終了コード 2 で終わる", async () => {
  const result = await runCliToExit([]);
  expect(result.code).toBe(2);
  expect(result.stderr).toContain("DATABASE_URL");
});

test("存在しない SQLite ファイルは、名前付きのエラーで終了コード 1 で終わる", async () => {
  const result = await runCliToExit(["/no/such/dir/app.db"]);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain('Cannot connect to "app"');
});

test("PostgreSQL に接続できないときは、パスワードを出さずに終了コード 1 で終わる", async () => {
  const result = await runCliToExit(["--port=0", "postgres://user:s3cretpw@127.0.0.1:1/app"]);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain('Cannot connect to "app"');
  expect(result.stdout + result.stderr).not.toContain("s3cretpw");
});

test("--version と --help は終了コード 0 で終わる", async () => {
  expect((await runCliToExit(["--version"])).stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  expect((await runCliToExit(["--help"])).stdout).toContain("Usage:");
});

test("--name で付けた複数の接続が、ツリーの接続の選択に並ぶ", async ({ page, sqliteFile }) => {
  const cli = await startCli(["--name", `first=${sqliteFile}`, "--name", `second=${sqliteFile}`]);
  try {
    await page.goto(cli.url);
    await expect(page.getByRole("combobox", { name: "Connection" })).toBeVisible();
    await page.getByRole("combobox", { name: "Connection" }).click();
    await expect(page.getByRole("option", { name: /first/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /second/ })).toBeVisible();
  } finally {
    await cli.stop();
  }
});

test("--port で指定したポートで、127.0.0.1 だけで待ち受ける", async ({ sqliteFile }) => {
  const free = await new Promise<number>((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
  const cli = await startCli([sqliteFile, "--port", String(free)]);
  try {
    expect(cli.origin).toBe(`http://127.0.0.1:${free}`);
  } finally {
    await cli.stop();
  }
});

test("使用中のポートを指定すると、終了コード 1 で終わる", async ({ sqliteFile }) => {
  const holder = createServer();
  const port = await new Promise<number>((resolve) => {
    holder.listen(0, "127.0.0.1", () => {
      const address = holder.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
  try {
    const result = await runCliToExit([sqliteFile, "--no-open", "--port", String(port)]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("EADDRINUSE");
  } finally {
    holder.close();
  }
});

test("SIGINT で終了コード 0 で終わり、ポートを閉じる", async ({ sqliteFile }) => {
  const cli = await startCli([sqliteFile]);
  expect(await cli.stop()).toBe(0);
  await expect(fetch(`${cli.origin}/`)).rejects.toThrow();
});
