import {
  type ConnectionInfo,
  connectionName,
  type DbResult,
  type DbViewerError,
  err,
  ok,
  type RpcRequest,
  RpcRequestSchema,
} from "@myaaaaa_chan/db-viewer-core";
import * as v from "valibot";
import type { DbAdapter } from "./adapter";
import { type Limits, resolveLimits } from "./limits";

export type HandlerOptions = {
  // キーが ConnectionName になる
  readonly connections: Readonly<Record<string, DbAdapter>>;
  // 必須。全員に許可したい場合は () => true と明示的に書く（ADR 002）
  readonly authorize: (request: Request) => boolean | Promise<boolean>;
  readonly limits?: Partial<Limits>;
};

export type Handler = (request: Request) => Promise<Response>;

// 想定外の例外の中身（接続文字列などを含みうる）は応答に載せない。
const INTERNAL_ERROR: DbViewerError = {
  kind: "internal",
  message: "An unexpected error occurred.",
};

const MAX_REPORTED_ISSUES = 20;

const json = (body: unknown, status: number, headers: Record<string, string> = {}): Response =>
  Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });

const failure = (error: DbViewerError, status: number, headers?: Record<string, string>) =>
  json(err(error), status, headers);

const invalidRequest = (...issues: ReadonlyArray<string>): DbViewerError => ({
  kind: "invalidRequest",
  issues,
});

// Content-Type を application/json に限る。text/plain の form から別サイトに POST させて、
// ログイン中の利用者の権限で SQL を実行させる攻撃（CSRF）は、この検査で成り立たなくなる。
const isJsonContentType = (request: Request): boolean => {
  const mediaType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  return mediaType === "application/json";
};

// 入口で 1 回だけ検証する。ここを通った後は型を信頼する（01 §3）。
const parseRequest = async (request: Request): Promise<DbResult<RpcRequest>> => {
  if (!isJsonContentType(request)) {
    return err(invalidRequest("Content-Type must be application/json."));
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err(invalidRequest("The request body is not valid JSON."));
  }
  const parsed = v.safeParse(RpcRequestSchema, body);
  if (parsed.success) return ok(parsed.output);
  return err(
    invalidRequest(
      ...parsed.issues
        .slice(0, MAX_REPORTED_ISSUES)
        .map((issue) => `${v.getDotPath(issue) ?? "(root)"}: ${issue.message}`),
    ),
  );
};

const connectionInfos = (
  connections: ReadonlyMap<string, DbAdapter>,
): ReadonlyArray<ConnectionInfo> =>
  Array.from(connections, ([name, adapter]) => ({
    name: connectionName(name),
    dialect: adapter.dialect,
    readOnly: adapter.readOnly,
    // enforcesTimeout は ConnectionInfo（core の通信仕様）に含めない
    capabilities: { cancel: adapter.capabilities.cancel },
  }));

type AdapterRequest = Exclude<RpcRequest, { readonly op: "listConnections" }>;

const callAdapter = (
  adapter: DbAdapter,
  request: AdapterRequest,
  limits: Limits,
): Promise<DbResult<unknown>> => {
  switch (request.op) {
    case "listSchemas":
      return adapter.listSchemas();
    case "listTables":
      return adapter.listTables(request.schema);
    case "getTableDetail":
      return adapter.getTableDetail(request.table);
    case "fetchRows":
      return adapter.fetchRows(request.query, limits);
    case "countRows":
      return adapter.countRows(request.table, request.filters, request.rawWhere, limits);
    case "fetchCell":
      return adapter.fetchCell(request.table, request.primaryKey, request.column, limits);
    case "executeQuery":
      return adapter.execute(request.sql, request.queryId, limits);
    case "cancelQuery":
      return adapter.cancel(request.queryId);
    default:
      return assertNever(request);
  }
};

const assertNever = (value: never): never => {
  throw new Error(`unhandled op: ${JSON.stringify(value)}`);
};

/**
 * Web 標準の fetch ハンドラを作る（03_サーバー §2）。ルーティングは持たない。
 * 1. POST 以外は 405 → 2. authorize が false なら 401 → 3. JSON を読んで検証、失敗は 400
 * → 4. 接続名でアダプターを選ぶ → 5. op に応じて呼ぶ → 6. Result を JSON で返す。
 */
export const createHandler = (options: HandlerOptions): Handler => {
  const limits = resolveLimits(options.limits);
  // 作成時に写して、Object.prototype の名前（constructor など）が接続名として通らないようにする
  const connections = new Map(Object.entries(options.connections));

  const handle = async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return failure(invalidRequest("Method not allowed. Use POST."), 405, { allow: "POST" });
    }
    if (!(await options.authorize(request))) return failure({ kind: "unauthorized" }, 401);

    const parsed = await parseRequest(request);
    if (!parsed.ok) return failure(parsed.error, 400);
    const rpc = parsed.value;

    if (rpc.op === "listConnections") return json(ok(connectionInfos(connections)), 200);

    const adapter = connections.get(rpc.connection);
    if (adapter === undefined) {
      return failure({ kind: "connectionNotFound", connection: rpc.connection }, 200);
    }
    // SQL のエラーなどのドメインのエラーも 200 で返す（本文の ok で区別する。02 §6）
    return json(await callAdapter(adapter, rpc, limits), 200);
  };

  return async (request) => {
    try {
      return await handle(request);
    } catch {
      return failure(INTERNAL_ERROR, 500);
    }
  };
};
