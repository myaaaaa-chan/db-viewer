import type {
  DbResult,
  DbViewerError,
  QueryId,
  QueryOutcome,
  Statement,
} from "@myaaaaa_chan/db-viewer-core";

// 実行した範囲（target）を結果にも持たせる。エラーの位置はこの範囲の先頭からの位置なので、
// エディタ全体での位置に直すのに要る。
export type SqlRunState =
  | { readonly status: "idle" }
  | { readonly status: "noStatement" }
  | {
      readonly status: "running";
      readonly queryId: QueryId;
      readonly startedAt: number;
      readonly target: Statement;
    }
  | { readonly status: "succeeded"; readonly target: Statement; readonly outcome: QueryOutcome }
  | {
      readonly status: "failed";
      readonly target: Statement;
      readonly error: DbViewerError;
      readonly elapsedMs: number;
    };

export const initialSqlRunState: SqlRunState = { status: "idle" };

export type SqlRunAction =
  | {
      readonly type: "runStarted";
      readonly queryId: QueryId;
      readonly startedAt: number;
      readonly target: Statement;
    }
  | {
      readonly type: "runFinished";
      readonly queryId: QueryId;
      readonly finishedAt: number;
      readonly result: DbResult<QueryOutcome>;
    }
  | { readonly type: "noStatementFound" }
  | { readonly type: "cleared" };

export const sqlRunReducer = (state: SqlRunState, action: SqlRunAction): SqlRunState => {
  switch (action.type) {
    case "runStarted":
      if (state.status === "running") return state;
      return {
        status: "running",
        queryId: action.queryId,
        startedAt: action.startedAt,
        target: action.target,
      };
    case "runFinished": {
      if (state.status !== "running" || state.queryId !== action.queryId) return state;
      const { target } = state;
      return action.result.ok
        ? { status: "succeeded", target, outcome: action.result.value }
        : {
            status: "failed",
            target,
            error: action.result.error,
            elapsedMs: action.finishedAt - state.startedAt,
          };
    }
    case "noStatementFound":
      return state.status === "running" ? state : { status: "noStatement" };
    case "cleared":
      return initialSqlRunState;
  }
};

// エディタ全体での、エラーの位置（下線を引く先頭）。
export const absoluteErrorPosition = (state: SqlRunState): number | null => {
  if (state.status !== "failed" || state.error.kind !== "query") return null;
  return state.error.position === null ? null : state.target.from + state.error.position;
};
