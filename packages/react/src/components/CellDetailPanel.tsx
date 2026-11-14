import type { CellValue } from "@myaaaaa_chan/db-viewer-core";
import { useEffect, useState } from "react";
import { copyText } from "../clipboard";
import { useErrorString } from "../hooks/useErrorString";
import { useT } from "../i18n/useT";
import { type ActiveCell, describePrimaryKey } from "../lib/active-cell";
import { formatCellDetail } from "../lib/cell-detail";
import { formatInteger } from "../lib/format";
import type { Remote } from "../state/remote";
import { Icon } from "./Icon";

export type CellDetailPanelProps = {
  readonly cell: ActiveCell | null;
  // 切り詰めたセルを fetchCell で取り直した値
  readonly full: Remote<CellValue>;
  readonly onLoadFull: () => void;
};

const COPIED_MS = 1500;

// 選んだセルの値の全体。json / jsonb は整形する。切り詰めたセルは、主キーがあれば全体を取り直せる。
export function CellDetailPanel(props: CellDetailPanelProps) {
  const { cell, full, onLoadFull } = props;
  const { t, language } = useT();
  const errorString = useErrorString();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  if (!cell) {
    return (
      <section className="dbv-detail" aria-label={t("detail.label")}>
        <div className="dbv-detail-head">
          <span className="dbv-detail-caption">{t("detail.heading")}</span>
        </div>
        <p className="dbv-detail-empty">{t("detail.empty")}</p>
      </section>
    );
  }

  const shown: CellValue = full.status === "ready" ? full.value : cell.value;
  const showingFull = full.status === "ready";
  const content = formatCellDetail(shown, cell.dbType);
  const primaryKeyText = describePrimaryKey(cell.primaryKey);
  const partial = cell.truncated && !showingFull;

  const copy = () => {
    void copyText(shown ?? "").then((ok) => setCopied(ok));
  };

  return (
    <section className="dbv-detail" aria-label={t("detail.label")}>
      <div className="dbv-detail-head">
        <span className="dbv-detail-caption">{t("detail.heading")}</span>
        <span className="dbv-detail-title">
          {cell.columnName}{" "}
          <span className="dbv-detail-meta">
            {cell.dbType ?? ""}
            {primaryKeyText ? ` · ${primaryKeyText}` : ""}
          </span>
        </span>
      </div>

      {partial ? (
        <div className="dbv-detail-warning">
          {cell.primaryKey ? (
            <>
              <span>
                {t("detail.truncated", {
                  formatted: formatInteger(Array.from(cell.value ?? "").length, language),
                })}
              </span>
              <button
                type="button"
                className="dbv-button dbv-button--warning"
                disabled={full.status === "loading"}
                onClick={onLoadFull}
              >
                {full.status === "loading" ? t("detail.loadingFull") : t("detail.loadFull")}
              </button>
              {full.status === "failed" ? (
                <span>
                  {t("detail.fullFailed")}: {errorString(full.error)}
                </span>
              ) : null}
            </>
          ) : (
            <span>{t("detail.partial")}</span>
          )}
        </div>
      ) : null}

      <pre className="dbv-detail-value">
        {content.kind === "null" ? (
          <span className="dbv-detail-null">NULL</span>
        ) : content.text === "" ? (
          <span className="dbv-detail-null">{t("detail.emptyString")}</span>
        ) : (
          content.text
        )}
      </pre>

      <div className="dbv-detail-actions">
        <button type="button" className="dbv-button dbv-button--wide" onClick={copy}>
          <Icon name="copy" size={14} />
          {copied ? t("detail.copied") : t("detail.copy")}
        </button>
      </div>
    </section>
  );
}
