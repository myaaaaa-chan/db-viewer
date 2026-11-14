import { useVirtualizer } from "@tanstack/react-virtual";
import type { RefObject } from "react";
import { type KeyboardEvent, useEffect, useMemo, useReducer } from "react";
import { useDbViewer } from "../context";
import { idle } from "../state/remote";
import {
  flattenTree,
  initialTreeUi,
  type TreeRow,
  treeKeyAction,
  treeUiReducer,
} from "../state/tree";
import { needsTables } from "../state/viewer";

// 行の高さ 30px + 行の間の 1px
export const TREE_ROW_PITCH = 31;
export const TREE_ROW_HEIGHT = 30;

// ツリーの行を作り、開いたスキーマのテーブル一覧を読み込み、キーボード操作を受け持つ。
export const useSchemaTree = (scrollRef: RefObject<HTMLDivElement | null>) => {
  const { state, selectTable, loadTables } = useDbViewer();
  const [ui, dispatch] = useReducer(treeUiReducer, initialTreeUi);

  const rows = useMemo(
    () => flattenTree({ schemas: state.schemas, tables: state.tables, ui, selected: state.table }),
    [state.schemas, state.tables, ui, state.table],
  );

  // 開いているスキーマのうち、まだ読み込みを要求していないものだけを読む。
  // 失敗したスキーマは自動では読み直さず、開き直したときに読み直す（失敗の繰り返しを避ける）。
  useEffect(() => {
    if (state.connection === null) return;
    for (const row of rows) {
      if (row.kind !== "schema" || !row.expanded) continue;
      if ((state.tables[row.schema] ?? idle).status === "idle") {
        loadTables(state.connection, row.schema);
      }
    }
  }, [rows, state.connection, state.tables, loadTables]);

  const focusedIndex = rows.findIndex((row) => row.key === ui.focusedKey);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => TREE_ROW_PITCH,
    overscan: 10,
  });

  useEffect(() => {
    if (focusedIndex >= 0) virtualizer.scrollToIndex(focusedIndex, { align: "auto" });
  }, [focusedIndex, virtualizer]);

  const toggle = (row: Extract<TreeRow, { kind: "schema" | "group" }>, expanded: boolean) => {
    dispatch({ type: "toggled", key: row.key, expanded });
    if (expanded && row.kind === "schema" && state.connection !== null) {
      if (needsTables(state, row.schema)) loadTables(state.connection, row.schema);
    }
  };

  const activate = (row: TreeRow) => {
    if (row.kind === "status") return;
    dispatch({ type: "focused", key: row.key });
    if (row.kind === "table") selectTable(row.ref);
    else toggle(row, !row.expanded);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const action = treeKeyAction(rows, ui.focusedKey, event.key);
    if (!action) return;
    event.preventDefault();
    if ("focus" in action) dispatch({ type: "focused", key: action.focus });
    else if ("activate" in action) selectTable(action.activate);
    else {
      const row = rows.find((r) => r.key === action.toggle.key);
      if (row && row.kind !== "status" && row.kind !== "table") {
        toggle(row, action.toggle.expanded);
      }
    }
  };

  return {
    state,
    rows,
    query: ui.query,
    setQuery: (query: string) => dispatch({ type: "queryChanged", query }),
    focusedIndex,
    focusedKey: ui.focusedKey,
    virtualItems: virtualizer.getVirtualItems(),
    totalSize: virtualizer.getTotalSize(),
    activate,
    onKeyDown,
    onFocus: () => {
      if (ui.focusedKey === null && rows[0]) dispatch({ type: "focused", key: rows[0].key });
    },
  };
};
