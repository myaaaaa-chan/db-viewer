import type {
  ConnectionInfo,
  ConnectionName,
  DbResult,
  SchemaName,
  TableRef,
  TableSummary,
} from "@myaaaaa_chan/db-viewer-core";
import { idle, type Remote, request, settle } from "./remote";

export type ViewerMode = "data" | "sql";

// DbViewerProvider が共有する状態。ツリーの読み込み結果と、選択中の接続・テーブル、表示の切り替え。
export type ViewerState = {
  readonly connections: Remote<ReadonlyArray<ConnectionInfo>>;
  readonly connection: ConnectionName | null;
  readonly schemas: Remote<ReadonlyArray<SchemaName>>;
  // 開いたスキーマだけを持つ（開いた階層だけを読み込む）
  readonly tables: Readonly<Record<string, Remote<ReadonlyArray<TableSummary>>>>;
  readonly table: TableRef | null;
  readonly mode: ViewerMode;
};

export const initialViewerState: ViewerState = {
  connections: idle,
  connection: null,
  schemas: idle,
  tables: {},
  table: null,
  mode: "data",
};

export type ViewerAction =
  | { readonly type: "connectionsRequested"; readonly requestId: number }
  | {
      readonly type: "connectionsLoaded";
      readonly requestId: number;
      readonly result: DbResult<ReadonlyArray<ConnectionInfo>>;
    }
  | { readonly type: "connectionSelected"; readonly connection: ConnectionName }
  | {
      readonly type: "schemasRequested";
      readonly connection: ConnectionName;
      readonly requestId: number;
    }
  | {
      readonly type: "schemasLoaded";
      readonly connection: ConnectionName;
      readonly requestId: number;
      readonly result: DbResult<ReadonlyArray<SchemaName>>;
    }
  | { readonly type: "tablesRequested"; readonly schema: SchemaName; readonly requestId: number }
  | {
      readonly type: "tablesLoaded";
      readonly schema: SchemaName;
      readonly requestId: number;
      readonly result: DbResult<ReadonlyArray<TableSummary>>;
    }
  | { readonly type: "tableSelected"; readonly table: TableRef }
  | { readonly type: "modeChanged"; readonly mode: ViewerMode };

const switchConnection = (state: ViewerState, connection: ConnectionName): ViewerState => ({
  ...state,
  connection,
  schemas: idle,
  tables: {},
  table: null,
});

export const viewerReducer = (state: ViewerState, action: ViewerAction): ViewerState => {
  switch (action.type) {
    case "connectionsRequested":
      return { ...state, connections: request(state.connections, action.requestId) };
    case "connectionsLoaded": {
      const connections = settle(state.connections, action.requestId, action.result);
      if (connections === state.connections) return state;
      const first = connections.status === "ready" ? connections.value[0] : undefined;
      const next = { ...state, connections };
      return state.connection === null && first ? switchConnection(next, first.name) : next;
    }
    case "connectionSelected":
      return action.connection === state.connection
        ? state
        : switchConnection(state, action.connection);
    case "schemasRequested":
      return action.connection === state.connection
        ? { ...state, schemas: request(state.schemas, action.requestId) }
        : state;
    case "schemasLoaded":
      return action.connection === state.connection
        ? { ...state, schemas: settle(state.schemas, action.requestId, action.result) }
        : state;
    case "tablesRequested":
      return {
        ...state,
        tables: {
          ...state.tables,
          [action.schema]: request(state.tables[action.schema] ?? idle, action.requestId),
        },
      };
    case "tablesLoaded": {
      const current = state.tables[action.schema];
      if (!current) return state;
      return {
        ...state,
        tables: {
          ...state.tables,
          [action.schema]: settle(current, action.requestId, action.result),
        },
      };
    }
    case "tableSelected":
      return { ...state, table: action.table, mode: "data" };
    case "modeChanged":
      return { ...state, mode: action.mode };
  }
};

// 未読み込みか、前回失敗したスキーマだけを読み込む。読み込み中と読み込み済みは読み直さない。
export const needsTables = (state: ViewerState, schema: SchemaName): boolean => {
  const status = (state.tables[schema] ?? idle).status;
  return status === "idle" || status === "failed";
};

export const selectedConnection = (state: ViewerState): ConnectionInfo | null => {
  if (state.connections.status !== "ready") return null;
  return state.connections.value.find((c) => c.name === state.connection) ?? null;
};
