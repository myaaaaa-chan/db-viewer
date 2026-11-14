import type { ReactNode } from "react";
import { DbViewerContext } from "../context";
import { useDbvI18n } from "../hooks/useDbvI18n";
import { useViewerState } from "../hooks/useViewerState";
import { DbvI18nContext } from "../i18n/useT";
import type { DbViewerProps } from "../types";
import { cx } from "./cx";

export type DbViewerProviderProps = DbViewerProps & { readonly children?: ReactNode };

// dataSource・言語・テーマ・選択中の接続とテーブルを、配下の部品に共有する。
// 色の変数（--dbv-*）を効かせるため、ルートの要素 .dbv-root もここで描く。
export function DbViewerProvider(props: DbViewerProviderProps) {
  const { dataSource, language = "en", resources, theme = "system", className, children } = props;
  const i18n = useDbvI18n(language, resources);
  const viewer = useViewerState(dataSource);

  return (
    <DbvI18nContext.Provider value={i18n}>
      <DbViewerContext.Provider value={viewer}>
        <div className={cx("dbv-root", className)} data-theme={theme}>
          {children}
        </div>
      </DbViewerContext.Provider>
    </DbvI18nContext.Provider>
  );
}
