import type {
  ConnectionName,
  DataSource,
  SchemaName,
  TableRef,
} from "@myaaaaa_chan/db-viewer-core";
import { useCallback, useEffect, useMemo, useReducer } from "react";
import type { DbViewerContextValue } from "../context";
import { initialViewerState, type ViewerMode, viewerReducer } from "../state/viewer";
import { useRequestIds } from "./useRequestIds";

// 接続・スキーマ・テーブルの一覧を DataSource から読み、reducer に流す薄いフック。
// 古い応答は、要求のたびに振る番号で reducer が捨てる。
export const useViewerState = (dataSource: DataSource): DbViewerContextValue => {
  const [state, dispatch] = useReducer(viewerReducer, initialViewerState);
  const nextRequestId = useRequestIds();

  useEffect(() => {
    const requestId = nextRequestId();
    dispatch({ type: "connectionsRequested", requestId });
    void dataSource
      .listConnections()
      .then((result) => dispatch({ type: "connectionsLoaded", requestId, result }));
  }, [dataSource, nextRequestId]);

  const { connection } = state;
  useEffect(() => {
    if (connection === null) return;
    const requestId = nextRequestId();
    dispatch({ type: "schemasRequested", connection, requestId });
    void dataSource
      .listSchemas(connection)
      .then((result) => dispatch({ type: "schemasLoaded", connection, requestId, result }));
  }, [dataSource, connection, nextRequestId]);

  const loadTables = useCallback(
    (target: ConnectionName, schema: SchemaName) => {
      const requestId = nextRequestId();
      dispatch({ type: "tablesRequested", schema, requestId });
      void dataSource
        .listTables(target, schema)
        .then((result) => dispatch({ type: "tablesLoaded", schema, requestId, result }));
    },
    [dataSource, nextRequestId],
  );

  const selectConnection = useCallback(
    (next: ConnectionName) => dispatch({ type: "connectionSelected", connection: next }),
    [],
  );
  const selectTable = useCallback(
    (table: TableRef) => dispatch({ type: "tableSelected", table }),
    [],
  );
  const setMode = useCallback((mode: ViewerMode) => dispatch({ type: "modeChanged", mode }), []);

  return useMemo(
    () => ({ dataSource, state, selectConnection, selectTable, setMode, loadTables }),
    [dataSource, state, selectConnection, selectTable, setMode, loadTables],
  );
};
