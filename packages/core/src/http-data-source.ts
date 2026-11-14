import * as v from "valibot";
import type { DataSource, DbResult } from "./data-source";
import type { DbViewerError } from "./error";
import { err, ok, tryAsync } from "./result";
import { RpcEnvelopeSchema, type RpcRequest, type RpcResult } from "./rpc";

export type HttpDataSourceOptions = {
  // 例: "/admin/db"
  readonly endpoint: string;
  // 認証用のヘッダーなど。リクエストのたびに呼ぶ（トークンの更新に追従できる）。
  readonly headers?: () => HeadersInit | Promise<HeadersInit>;
  readonly fetch?: typeof fetch;
};

type RawResponse = { readonly status: number; readonly ok: boolean; readonly text: string };

const internal = (message: string): DbViewerError => ({ kind: "internal", message });

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const send = async (options: HttpDataSourceOptions, request: RpcRequest): Promise<RawResponse> => {
  const headers = new Headers(await options.headers?.());
  headers.set("Content-Type", "application/json");
  // ブラウザの fetch は this が window 以外だと動かないので、メソッドとしてではなく単独の関数として呼ぶ。
  const doFetch = options.fetch ?? globalThis.fetch;
  const response = await doFetch(options.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(request),
  });
  return { status: response.status, ok: response.ok, text: await response.text() };
};

const parseEnvelope = (text: string) => {
  try {
    const parsed = v.safeParse(RpcEnvelopeSchema, JSON.parse(text));
    return parsed.success ? parsed.output : null;
  } catch {
    return null;
  }
};

const interpret = <TRequest extends RpcRequest>(
  response: RawResponse,
): DbResult<RpcResult<TRequest["op"]>> => {
  if (response.status === 401) return err({ kind: "unauthorized" });
  // 5xx の本文には、サーバーの内部情報が含まれうるので載せない。
  if (response.status >= 500) return err(internal(`server error (HTTP ${response.status})`));

  const envelope = parseEnvelope(response.text);
  if (envelope === null) return err(internal(`unexpected response (HTTP ${response.status})`));
  if (!envelope.ok) return err(envelope.error);
  if (!response.ok) return err(internal(`unexpected response (HTTP ${response.status})`));
  // 値の中身は検証しない。両端は同じバージョンのパッケージで型を共有している前提で、
  // 行数の多い結果を毎回検証する費用を避ける。
  return ok(envelope.value as RpcResult<TRequest["op"]>);
};

export const createHttpDataSource = (options: HttpDataSourceOptions): DataSource => {
  const call = async <TRequest extends RpcRequest>(
    request: TRequest,
  ): Promise<DbResult<RpcResult<TRequest["op"]>>> => {
    const sent = await tryAsync(
      () => send(options, request),
      (cause) => internal(`request failed: ${messageOf(cause)}`),
    );
    return sent.ok ? interpret<TRequest>(sent.value) : sent;
  };

  return {
    listConnections: () => call({ op: "listConnections" }),
    listSchemas: (connection) => call({ op: "listSchemas", connection }),
    listTables: (connection, schema) => call({ op: "listTables", connection, schema }),
    getTableDetail: (connection, table) => call({ op: "getTableDetail", connection, table }),
    fetchRows: (connection, query) => call({ op: "fetchRows", connection, query }),
    countRows: (connection, table, filters, rawWhere) =>
      call({ op: "countRows", connection, table, filters, rawWhere }),
    fetchCell: (connection, table, primaryKey, column) =>
      call({ op: "fetchCell", connection, table, primaryKey, column }),
    executeQuery: (connection, sql, queryId) =>
      call({ op: "executeQuery", connection, sql, queryId }),
    cancelQuery: (connection, queryId) => call({ op: "cancelQuery", connection, queryId }),
  };
};
