import type {
  DbResult,
  DbViewerError,
  QueryId,
  QueryOutcome,
  Statement,
} from "@myaaaaa_chan/db-viewer-core";
import { lineColumn } from "../lib/error-position";

// 実行した文。line と column は、エディタ全体での文の先頭の位置（1 始まり）。
// エラーの位置は文の先頭からの位置なので、エディタ全体での位置に直すのに要る。
export type ExecutedStatement = Statement & { readonly line: number; readonly column: number };

export type SqlRunState =
  | { readonly status: "idle" }
  | { readonly status: "noStatement" }
  | {
      readonly status: "running";
      readonly queryId: QueryId;
      readonly startedAt: number;
      readonly target: ExecutedStatement;
    }
  | {
      readonly status: "succeeded";
      readonly target: ExecutedStatement;
      readonly outcome: QueryOutcome;
    }
  | {
      readonly status: "failed";
      readonly target: ExecutedStatement;
      readonly error: DbViewerError;
      readonly elapsedMs: number;
    };

export const initialSqlRunState: SqlRunState = { status: "idle" };

export type SqlRunAction =
  | {
      readonly type: "runStarted";
      readonly queryId: QueryId;
      readonly startedAt: number;
      readonly target: ExecutedStatement;
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

// エディタ全体での、エラーの行と桁（1 始まり）。
export const errorLocation = (state: SqlRunState): { line: number; column: number } | null => {
  if (state.status !== "failed" || state.error.kind !== "query") return null;
  if (state.error.position === null) return null;
  const { target } = state;
  const within = lineColumn(target.text, state.error.position);
  return within.line === 1
    ? { line: target.line, column: target.column + within.column - 1 }
    : { line: target.line + within.line - 1, column: within.column };
};
