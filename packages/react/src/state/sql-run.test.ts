import { err, ok, queryId } from "@myaaaaa_chan/db-viewer-core";
import { describe, expect, it } from "vitest";
import {
  absoluteErrorPosition,
  initialSqlRunState,
  type SqlRunAction,
  sqlRunReducer,
} from "./sql-run";

const id = queryId("q1");
const target = { from: 10, to: 28, text: "SELECT id, emial FROM t" };
const started = (queryIdValue = id): SqlRunAction => ({
  type: "runStarted",
  queryId: queryIdValue,
  startedAt: 1000,
  target,
});
const run = (actions: ReadonlyArray<SqlRunAction>) =>
  actions.reduce(sqlRunReducer, initialSqlRunState);

describe("sqlRunReducer", () => {
  it("実行を始めると、実行中の状態になる", () => {
    expect(run([started()])).toEqual({
      status: "running",
      queryId: id,
      startedAt: 1000,
      target,
    });
  });

  it("結果の行は、サーバーが数えた経過時間を持つ", () => {
    const outcome = {
      kind: "rows" as const,
      columns: [{ name: "id", dbType: "int8" }],
      rows: [["1"]],
      truncated: false,
      truncatedCells: [],
      elapsedMs: 128,
    };
    const state = run([
      started(),
      { type: "runFinished", queryId: id, finishedAt: 1500, result: ok(outcome) },
    ]);
    expect(state).toEqual({ status: "succeeded", target, outcome });
  });

  it("失敗は、実行を始めてから終わるまでの経過時間を持つ", () => {
    const error = { kind: "query" as const, message: "x", sqlState: "42703", position: 7 };
    const state = run([
      started(),
      { type: "runFinished", queryId: id, finishedAt: 1009, result: err(error) },
    ]);
    expect(state).toEqual({ status: "failed", target, error, elapsedMs: 9 });
  });

  it("実行中は、別の実行を始められない", () => {
    const other = queryId("q2");
    const state = run([started(), started(other)]);
    expect(state).toMatchObject({ status: "running", queryId: id });
  });

  it("実行中でない番号の応答は捨てる", () => {
    const stale = run([
      started(),
      {
        type: "runFinished",
        queryId: queryId("other"),
        finishedAt: 2000,
        result: err({ kind: "cancelled" }),
      },
    ]);
    expect(stale.status).toBe("running");
    expect(
      sqlRunReducer(initialSqlRunState, {
        type: "runFinished",
        queryId: id,
        finishedAt: 1,
        result: err({ kind: "cancelled" }),
      }),
    ).toBe(initialSqlRunState);
  });

  it("文がなかったときは、その状態にする。実行中は変えない", () => {
    expect(sqlRunReducer(initialSqlRunState, { type: "noStatementFound" })).toEqual({
      status: "noStatement",
    });
    const running = run([started()]);
    expect(sqlRunReducer(running, { type: "noStatementFound" })).toBe(running);
  });

  it("接続を切り替えたら、結果を消して初期の状態に戻す", () => {
    const state = run([
      started(),
      { type: "runFinished", queryId: id, finishedAt: 1100, result: err({ kind: "cancelled" }) },
      { type: "cleared" },
    ]);
    expect(state).toEqual(initialSqlRunState);
  });
});

describe("absoluteErrorPosition", () => {
  it("エラーの位置を、エディタ全体での位置に直す", () => {
    const state = run([
      started(),
      {
        type: "runFinished",
        queryId: id,
        finishedAt: 1100,
        result: err({ kind: "query", message: "x", sqlState: null, position: 11 }),
      },
    ]);
    expect(absoluteErrorPosition(state)).toBe(21);
  });

  it("位置のないエラーや、失敗以外の状態では null を返す", () => {
    const noPosition = run([
      started(),
      {
        type: "runFinished",
        queryId: id,
        finishedAt: 1100,
        result: err({ kind: "query", message: "x", sqlState: null, position: null }),
      },
    ]);
    expect(absoluteErrorPosition(noPosition)).toBeNull();
    expect(absoluteErrorPosition(initialSqlRunState)).toBeNull();
  });
});
