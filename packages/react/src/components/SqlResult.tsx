import type { ReactNode } from "react";
import { useErrorString } from "../hooks/useErrorString";
import { useT } from "../i18n/useT";
import { formatInteger } from "../lib/format";
import { errorLocation, type SqlRunState } from "../state/sql-run";
import { ErrorCard } from "./ErrorCard";
import { Icon } from "./Icon";
import { ResultGrid } from "./ResultGrid";

export type SqlResultProps = {
  readonly run: SqlRunState;
  // 実行中の経過時間を出すための現在時刻
  readonly now: number;
  readonly onGoToError: () => void;
};

// 実行の状態に応じた、結果・エラー・実行中・文がないときの表示。
export function SqlResult(props: SqlResultProps) {
  const { run, now, onGoToError } = props;
  const { t, tc, language } = useT();
  const errorString = useErrorString();
  const ms = (value: number) =>
    t("sql.elapsedMs", { ms: formatInteger(Math.max(Math.round(value), 0), language) });

  const bar = (children: ReactNode) => (
    <div className="dbv-result-bar">
      <span className="dbv-result-title">{t("sql.result")}</span>
      {children}
    </div>
  );

  switch (run.status) {
    case "idle":
      return null;
    case "noStatement":
      return bar(<span role="status">{t("sql.noStatement")}</span>);
    case "running":
      return bar(
        <span role="status">
          {t("sql.running")}{" "}
          {t("sql.elapsedSeconds", { seconds: ((now - run.startedAt) / 1000).toFixed(1) })}
        </span>,
      );
    case "failed": {
      const { error } = run;
      const location = errorLocation(run);
      return (
        <>
          {bar(
            <span>
              {t("sql.failedShort")} · {ms(run.elapsedMs)}
            </span>,
          )}
          <div className="dbv-result-error">
            <ErrorCard
              title={error.kind === "cancelled" ? t("sql.cancelledTitle") : t("sql.failedTitle")}
              message={errorString(error)}
              badge={
                error.kind === "query" && error.sqlState
                  ? t("sql.sqlState", { code: error.sqlState })
                  : null
              }
            >
              {location ? (
                <div className="dbv-error-position">
                  <span>{t("sql.position", location)}</span>
                  <button
                    type="button"
                    className="dbv-button dbv-button--danger"
                    onClick={onGoToError}
                  >
                    {t("sql.goToError")}
                  </button>
                </div>
              ) : null}
            </ErrorCard>
          </div>
        </>
      );
    }
    case "succeeded": {
      const { outcome } = run;
      if (outcome.kind === "command") {
        return (
          <>
            {bar(
              <>
                <span>
                  {outcome.affectedRows === null
                    ? t("sql.commandDone")
                    : tc("sql.affected", outcome.affectedRows)}
                </span>
                <span>{ms(outcome.elapsedMs)}</span>
              </>,
            )}
          </>
        );
      }
      return (
        <>
          {bar(
            <>
              <span>
                {tc("grid.rowCount", outcome.rows.length)} ·{" "}
                {tc("grid.columnCount", outcome.columns.length)}
              </span>
              <span>{ms(outcome.elapsedMs)}</span>
              {outcome.truncated ? (
                <span className="dbv-chip-warning">
                  <Icon name="warning" size={12} />
                  {tc("sql.truncated", outcome.rows.length)}
                </span>
              ) : null}
            </>,
          )}
          <div className="dbv-result-body">
            <ResultGrid result={outcome} emptyMessage={t("sql.noRows")} />
          </div>
        </>
      );
    }
  }
}
