import type {
  ConnectionName,
  DataSource,
  SchemaName,
  TableRef,
} from "@myaaaaa_chan/db-viewer-core";
import { createContext, useContext } from "react";
import type { ViewerMode, ViewerState } from "./state/viewer";

export type DbViewerContextValue = {
  readonly dataSource: DataSource;
  readonly state: ViewerState;
  readonly selectConnection: (connection: ConnectionName) => void;
  readonly selectTable: (table: TableRef) => void;
  readonly setMode: (mode: ViewerMode) => void;
  // スキーマを開いたときに、そのテーブルの一覧を読み込む
  readonly loadTables: (connection: ConnectionName, schema: SchemaName) => void;
};

export const DbViewerContext = createContext<DbViewerContextValue | null>(null);

export const useDbViewer = (): DbViewerContextValue => {
  const value = useContext(DbViewerContext);
  if (!value) throw new Error("This component must be rendered inside <DbViewerProvider>.");
  return value;
};
