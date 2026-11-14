import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";

const uiDir = mkdtempSync(join(tmpdir(), "dbv-ui-"));
mkdirSync(join(uiDir, "assets"));
writeFileSync(join(uiDir, "index.html"), "<!doctype html><title>shell</title>");
writeFileSync(join(uiDir, "assets", "app.js"), "console.log(1)");

const app = createApp({
  uiDir,
  handler: async (request) => new Response(`api:${request.method}`, { status: 200 }),
});

describe("createApp", () => {
  it("POST /api は handler に渡す", async () => {
    const response = await app.request("/api", { method: "POST" });
    expect(await response.text()).toBe("api:POST");
  });

  it("/api は GET でも HTML を返さず handler に任せる（405 などを handler が決める）", async () => {
    const response = await app.request("/api");
    expect(await response.text()).toBe("api:GET");
  });

  it("同梱したファイルをそのまま返す", async () => {
    const response = await app.request("/assets/app.js");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("javascript");
    expect(await response.text()).toBe("console.log(1)");
  });

  it("/ と、見つからない GET は index.html を返す（SPA）", async () => {
    for (const path of ["/", "/anything/deep"]) {
      const response = await app.request(path);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("<title>shell</title>");
    }
  });

  it("ディレクトリをさかのぼる指定では UI の外のファイルを返さない", async () => {
    const response = await app.request("/..%2f..%2fetc/passwd");
    expect(await response.text()).toContain("<title>shell</title>");
  });

  it("応答にトークンを漏らさないヘッダーを付ける", async () => {
    const response = await app.request("/");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
