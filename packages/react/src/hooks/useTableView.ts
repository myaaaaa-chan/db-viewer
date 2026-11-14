import type { ConnectionName, TableRef } from "@myaaaaa_chan/db-viewer-core";
import { useCallback, useEffect, useMemo, useReducer } from "react";
import { useDbViewer } from "../context";
import type { ActiveCell } from "../lib/active-cell";
import { shownValue } from "../state/remote";
import { initialTableViewState, rowsQueryOf, tableViewReducer } from "../state/table-view";
import { useRequestIds } from "./useRequestIds";

// 1 つのテーブルの行・件数・詳細・セルの全体を DataSource から読み、reducer に流す薄いフック。
// 条件・並べ替え・ページのどれかが変わるたびに行を読み直す。古い応答は reducer が捨てる。
export const useTableView = (connection: ConnectionName, table: TableRef) => {
  const { dataSource } = useDbViewer();
  const [state, dispatch] = useReducer(tableViewReducer, initialTableViewState);
  const nextRequestId = useRequestIds();
  const { filters, rawWhere, sort, page } = state;

  const query = useMemo(
    () => rowsQueryOf(table, { filters, rawWhere, sort, page }),
    [table, filters, rawWhere, sort, page],
  );

  useEffect(() => {
    const requestId = nextRequestId();
    dispatch({ type: "detailRequested", requestId });
    void dataSource
      .getTableDetail(connection, table)
      .then((result) => dispatch({ type: "detailLoaded", requestId, result }));
  }, [dataSource, connection, table, nextRequestId]);

  useEffect(() => {
    const requestId = nextRequestId();
    dispatch({ type: "rowsRequested", requestId });
    void dataSource
      .fetchRows(connection, query)
      .then((result) => dispatch({ type: "rowsLoaded", requestId, result }));
  }, [dataSource, connection, query, nextRequestId]);

  // 件数は、ボタンを押したときだけ数える（大きなテーブルで毎回数えない）
  const loadCount = useCallback(() => {
    const requestId = nextRequestId();
    dispatch({ type: "countRequested", requestId });
    void dataSource
      .countRows(connection, table, filters, rawWhere)
      .then((result) => dispatch({ type: "countLoaded", requestId, result }));
  }, [dataSource, connection, table, filters, rawWhere, nextRequestId]);

  const loadFullCell = useCallback(
    (cell: ActiveCell) => {
      if (cell.primaryKey === null) return;
      const requestId = nextRequestId();
      dispatch({ type: "fullCellRequested", requestId });
      void dataSource
        .fetchCell(connection, table, cell.primaryKey, cell.columnName)
        .then((result) => dispatch({ type: "fullCellLoaded", requestId, result }));
    },
    [dataSource, connection, table, nextRequestId],
  );

  return { state, dispatch, loadCount, loadFullCell, shownRows: shownValue(state.rows) };
};
