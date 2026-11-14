import { type ReactNode, useRef } from "react";
import { useDbViewer } from "../context";
import { useSqlEditor } from "../hooks/useSqlEditor";
import { useT } from "../i18n/useT";
import { currentModifierLabels } from "../lib/platform";
import { selectedConnection } from "../state/viewer";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { ReadOnlyBadge } from "./ReadOnlyBadge";
import { SqlResult } from "./SqlResult";

export type SqlEditorProps = {
  // ツールバーの先頭に置くもの（<DbViewer> が「データ / SQL」の切り替えを置く）
  readonly toolbarStart?: ReactNode;
  readonly className?: string;
};

// SQL エディタ（CodeMirror 6）・実行と停止のボタン・結果。実行するのは、カーソル位置にある 1 文。
export function SqlEditor(props: SqlEditorProps) {
  const { t } = useT();
  const { state } = useDbViewer();
  const connection = selectedConnection(state);
  const containerRef = useRef<HTMLDivElement>(null);
  const sql = useSqlEditor(containerRef, connection);
  const running = sql.run.status === "running";
  const labels = currentModifierLabels();

  return (
    <div className={cx("dbv-sql", props.className)}>
      <div className="dbv-toolbar">
        {props.toolbarStart}
        {connection?.readOnly ? <ReadOnlyBadge /> : null}
        <span className="dbv-spacer" />
        <button
          type="button"
          className="dbv-run"
          aria-label={t("sql.runLabel")}
          aria-keyshortcuts="Control+Enter Meta+Enter"
          disabled={!connection || running}
          onClick={sql.runStatement}
        >
          <Icon name="play" size={14} />
          {t("sql.run")}
          <kbd className="dbv-run-kbd">{labels.run}</kbd>
        </button>
        {connection?.capabilities.cancel ? (
          <button type="button" className="dbv-stop" disabled={!running} onClick={sql.stop}>
            <Icon name="stop" size={12} />
            {t("sql.stop")}
          </button>
        ) : null}
      </div>
      <div className="dbv-editor" ref={containerRef} />
      <SqlResult run={sql.run} now={sql.now} onGoToError={sql.goToError} />
    </div>
  );
}
