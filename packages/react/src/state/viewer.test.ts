import {
  type ConnectionInfo,
  connectionName,
  err,
  ok,
  schemaName,
  type TableSummary,
  tableName,
} from "@myaaaaa_chan/db-viewer-core";
import { describe, expect, it } from "vitest";
import {
  initialViewerState,
  needsTables,
  selectedConnection,
  type ViewerAction,
  type ViewerState,
  viewerReducer,
} from "./viewer";

const main: ConnectionInfo = {
  name: connectionName("main"),
  dialect: "postgres",
  readOnly: true,
  capabilities: { cancel: true, enforcesTimeout: true },
};
const local: ConnectionInfo = {
  name: connectionName("local"),
  dialect: "sqlite",
  readOnly: false,
  capabilities: { cancel: false, enforcesTimeout: false },
};
const publicSchema = schemaName("public");
const users: TableSummary = {
  ref: { schema: publicSchema, name: tableName("users") },
  kind: "table",
};

const run = (actions: ReadonlyArray<ViewerAction>, from: ViewerState = initialViewerState) =>
  actions.reduce(viewerReducer, from);

const withConnections = () =>
  run([
    { type: "connectionsRequested", requestId: 1 },
    { type: "connectionsLoaded", requestId: 1, result: ok([main, local]) },
  ]);

describe("接続", () => {
  it("読み込めたら先頭の接続を選ぶ", () => {
    const state = withConnections();
    expect(state.connection).toBe("main");
    expect(selectedConnection(state)).toEqual(main);
  });

  it("古い応答は捨てる", () => {
    const state = run([
      { type: "connectionsRequested", requestId: 1 },
      { type: "connectionsRequested", requestId: 2 },
      { type: "connectionsLoaded", requestId: 1, result: ok([main]) },
    ]);
    expect(state.connections.status).toBe("loading");
    expect(state.connection).toBeNull();
  });

  it("読み込みに失敗したら接続を選ばない", () => {
    const state = run([
      { type: "connectionsRequested", requestId: 1 },
      { type: "connectionsLoaded", requestId: 1, result: err({ kind: "unauthorized" }) },
    ]);
    expect(state.connections).toEqual({ status: "failed", error: { kind: "unauthorized" } });
    expect(state.connection).toBeNull();
  });

  it("接続を切り替えると、スキーマ・テーブル・選択中のテーブルを空に戻す", () => {
    const state = run(
      [
        { type: "schemasRequested", connection: main.name, requestId: 2 },
        { type: "schemasLoaded", connection: main.name, requestId: 2, result: ok([publicSchema]) },
        { type: "tablesRequested", schema: publicSchema, requestId: 3 },
        { type: "tablesLoaded", schema: publicSchema, requestId: 3, result: ok([users]) },
        { type: "tableSelected", table: users.ref },
        { type: "connectionSelected", connection: local.name },
      ],
      withConnections(),
    );
    expect(state.connection).toBe("local");
    expect(state.schemas).toEqual({ status: "idle" });
    expect(state.tables).toEqual({});
    expect(state.table).toBeNull();
  });

  it("同じ接続を選び直しても何も変えない", () => {
    const before = withConnections();
    expect(viewerReducer(before, { type: "connectionSelected", connection: main.name })).toBe(
      before,
    );
  });
});

describe("スキーマとテーブル", () => {
  it("スキーマを開くまでテーブルは読み込まれていない", () => {
    expect(needsTables(withConnections(), publicSchema)).toBe(true);
  });

  it("テーブルの応答は、要求したスキーマごとに持つ", () => {
    const state = run(
      [
        { type: "tablesRequested", schema: publicSchema, requestId: 5 },
        { type: "tablesLoaded", schema: publicSchema, requestId: 5, result: ok([users]) },
      ],
      withConnections(),
    );
    expect(state.tables[publicSchema]).toEqual({ status: "ready", value: [users] });
    expect(needsTables(state, publicSchema)).toBe(false);
  });

  it("読み込み中のスキーマは、もう一度読み込まない", () => {
    const state = run(
      [{ type: "tablesRequested", schema: publicSchema, requestId: 5 }],
      withConnections(),
    );
    expect(needsTables(state, publicSchema)).toBe(false);
  });

  it("失敗したスキーマは、開き直したときに読み込み直せる", () => {
    const state = run(
      [
        { type: "tablesRequested", schema: publicSchema, requestId: 5 },
        {
          type: "tablesLoaded",
          schema: publicSchema,
          requestId: 5,
          result: err({ kind: "internal", message: "x" }),
        },
      ],
      withConnections(),
    );
    expect(needsTables(state, publicSchema)).toBe(true);
  });

  it("接続を切り替えた後に届いた古いテーブルの応答は捨てる", () => {
    const state = run(
      [
        { type: "tablesRequested", schema: publicSchema, requestId: 5 },
        { type: "connectionSelected", connection: local.name },
        { type: "tablesLoaded", schema: publicSchema, requestId: 5, result: ok([users]) },
      ],
      withConnections(),
    );
    expect(state.tables).toEqual({});
  });

  it("別の接続のスキーマの応答は捨てる", () => {
    const state = run(
      [
        { type: "schemasRequested", connection: main.name, requestId: 2 },
        { type: "connectionSelected", connection: local.name },
        { type: "schemasRequested", connection: local.name, requestId: 3 },
        { type: "schemasLoaded", connection: main.name, requestId: 2, result: ok([publicSchema]) },
      ],
      withConnections(),
    );
    expect(state.schemas.status).toBe("loading");
  });
});

describe("テーブルの選択と表示の切り替え", () => {
  it("テーブルを選ぶと「データ」に切り替わる", () => {
    const state = run([
      { type: "modeChanged", mode: "sql" },
      { type: "tableSelected", table: users.ref },
    ]);
    expect(state.table).toEqual(users.ref);
    expect(state.mode).toBe("data");
  });

  it("表示を切り替えても、選択中のテーブルは変わらない", () => {
    const state = run([
      { type: "tableSelected", table: users.ref },
      { type: "modeChanged", mode: "sql" },
    ]);
    expect(state.table).toEqual(users.ref);
    expect(state.mode).toBe("sql");
  });

  it("最初は「データ」を表示する", () => {
    expect(initialViewerState.mode).toBe("data");
  });
});
