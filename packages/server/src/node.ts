import type { IncomingMessage, ServerResponse } from "node:http";
import { getRequestListener } from "@hono/node-server";
import type { Handler } from "./handler";

/**
 * createHandler が返す fetch ハンドラを、node:http のリクエストリスナー（Express などにも渡せる）にする。
 * Request と Response への変換は @hono/node-server の getRequestListener に任せる（ADR 008）。
 * 使うには @hono/node-server と hono の両方が要る（どちらも optional な peerDependencies）。
 *
 * Express では、express.json() などで本文を読む前のルートに置く。読んだ後に渡すと
 * "Body is unusable" になり 500 を返す。
 */
export const toNodeHandler = (
  handler: Handler,
): ((req: IncomingMessage, res: ServerResponse) => void) => getRequestListener(handler);
