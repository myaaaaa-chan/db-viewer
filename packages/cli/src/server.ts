import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { createHandler } from "@myaaaaa_chan/db-viewer-server";
import { createApp } from "./app";
import type { CliConfig } from "./args";
import { openConnections } from "./connections";
import { createAuthorize, generateToken } from "./token";

export type RunningServer = {
  readonly url: string;
  readonly token: string;
  readonly close: () => Promise<void>;
};

const HOST = "127.0.0.1";

const listen = (fetch: (request: Request) => Response | Promise<Response>, port: number) =>
  new Promise<Server>((resolve, reject) => {
    const server = serve({ fetch, hostname: HOST, port }, () => resolve(server as Server));
    server.once("error", reject);
  });

const closeServer = (server: Server) =>
  new Promise<void>((resolve) => {
    server.close(() => resolve());
    // 開きっぱなしの接続（keep-alive、読み込み中の応答）があっても終了できるようにする
    server.closeAllConnections();
  });

/** 05_CLI §3 の 2 から 5。ポートが埋まっているなどで失敗したら、DB 接続を閉じてから投げる。 */
export const startServer = async (config: CliConfig, uiDir: string): Promise<RunningServer> => {
  const connections = await openConnections(config.connections, config.write);
  const token = generateToken();
  const handler = createHandler({
    connections: connections.adapters,
    authorize: createAuthorize(token),
  });
  const app = createApp({ handler, uiDir });
  try {
    const server = await listen(app.fetch, config.port ?? 0);
    const { port } = server.address() as AddressInfo;
    return {
      url: `http://${HOST}:${port}/`,
      token,
      close: async () => {
        await closeServer(server);
        await connections.close();
      },
    };
  } catch (cause) {
    await connections.close();
    throw cause;
  }
};
