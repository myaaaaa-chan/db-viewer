import type { DataSource } from "@myaaaaa_chan/db-viewer-core";
import type { DbvResources } from "./i18n/instance";

export type Theme = "light" | "dark" | "system";

export type DbViewerProps = {
  readonly dataSource: DataSource;
  // 初期値は "en"
  readonly language?: string;
  // 言語の追加や文言の上書き。同梱の辞書の上に深く結合する
  readonly resources?: DbvResources;
  // 初期値は "system"（OS のダークモード設定に追従する）
  readonly theme?: Theme;
  readonly className?: string;
};
