import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";

export type AppOptions = {
  readonly handler: (request: Request) => Promise<Response>;
  // 同梱した UI（dist/ui）の絶対パス
  readonly uiDir: string;
};

/**
 * 05_CLI §3 の 5。/api は handler に渡し、それ以外の GET は同梱した UI の静的ファイル、
 * 見つからなければ index.html（SPA の振り分け）を返す。
 */
export const createApp = ({ handler, uiDir }: AppOptions): Hono => {
  const app = new Hono();
  app.use(async (c, next) => {
    await next();
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Content-Type-Options", "nosniff");
  });
  app.all("/api", (c) => handler(c.req.raw));
  app.use("/*", serveStatic({ root: uiDir }));
  app.get("*", serveStatic({ root: uiDir, path: "index.html" }));
  return app;
};
