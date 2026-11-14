import type {
  CellValue,
  ColumnName,
  DbResult,
  Filter,
  ResultSet,
  RowsQuery,
  Sort,
  TableDetail,
  TableRef,
} from "@myaaaaa_chan/db-viewer-core";
import { map } from "@myaaaaa_chan/db-viewer-core";
import type { CellPos } from "./grid-selection";
import { idle, type Remote, request, settle } from "./remote";

// U1: 1 ページの件数
export const PAGE_SIZE = 100;

export type DetailTab = "rows" | "columns" | "indexes" | "foreignKeys" | "ddl";

// 1 つのテーブルを開いている間の状態。テーブルを切り替えたら、まるごと作り直す。
export type TableViewState = {
  readonly tab: DetailTab;
  // 適用中の条件。入力途中の値は持たない（コンポーネントの入力値）
  readonly filters: ReadonlyArray<Filter>;
  readonly rawWhere: string | null;
  readonly sort: Sort | null;
  // 0 始まり
  readonly page: number;
  readonly rows: Remote<ResultSet>;
  readonly count: Remote<string>;
  readonly detail: Remote<TableDetail>;
  // 詳細パネルに出すセル
  readonly active: CellPos | null;
  // 切り詰めたセルを fetchCell で取り直した値
  readonly fullCell: Remote<CellValue>;
};

export const initialTableViewState: TableViewState = {
  tab: "rows",
  filters: [],
  rawWhere: null,
  sort: null,
  page: 0,
  rows: idle,
  count: idle,
  detail: idle,
  active: null,
  fullCell: idle,
};

export type TableViewAction =
  | { readonly type: "tabChanged"; readonly tab: DetailTab }
  | { readonly type: "filterAdded"; readonly filter: Filter }
  | { readonly type: "filterRemoved"; readonly index: number }
  | { readonly type: "rawWhereApplied"; readonly text: string }
  | { readonly type: "sortToggled"; readonly column: ColumnName }
  | { readonly type: "pageMoved"; readonly delta: 1 | -1 }
  | { readonly type: "rowsRequested"; readonly requestId: number }
  | {
      readonly type: "rowsLoaded";
      readonly requestId: number;
      readonly result: DbResult<ResultSet>;
    }
  | { readonly type: "countRequested"; readonly requestId: number }
  | {
      readonly type: "countLoaded";
      readonly requestId: number;
      readonly result: DbResult<{ readonly count: string }>;
    }
  | { readonly type: "detailRequested"; readonly requestId: number }
  | {
      readonly type: "detailLoaded";
      readonly requestId: number;
      readonly result: DbResult<TableDetail>;
    }
  | { readonly type: "activeCellChanged"; readonly pos: CellPos | null }
  | { readonly type: "fullCellRequested"; readonly requestId: number }
  | {
      readonly type: "fullCellLoaded";
      readonly requestId: number;
      readonly result: DbResult<{ readonly value: CellValue }>;
    };

// 昇順 → 降順 → なし。並べ替えは 1 列だけなので、別の列を押したらその列の昇順から始める。
export const nextSort = (current: Sort | null, column: ColumnName): Sort | null => {
  if (current?.column !== column) return { column, direction: "asc" };
  return current.direction === "asc" ? { column, direction: "desc" } : null;
};

export const rowsQueryOf = (
  table: TableRef,
  state: Pick<TableViewState, "filters" | "rawWhere" | "sort" | "page">,
): RowsQuery => ({
  table,
  filters: state.filters,
  rawWhere: state.rawWhere,
  sort: state.sort,
  limit: PAGE_SIZE,
  offset: state.page * PAGE_SIZE,
});

// 並べ替えとページ送りは、表示する行が変わるだけで件数は変わらない。
const backToFirstPage = (state: TableViewState): TableViewState => ({
  ...state,
  page: 0,
  active: null,
  fullCell: idle,
});

// フィルタと WHERE が変わると件数も変わる。
const conditionsChanged = (state: TableViewState): TableViewState => ({
  ...backToFirstPage(state),
  count: idle,
});

export const tableViewReducer = (
  state: TableViewState,
  action: TableViewAction,
): TableViewState => {
  switch (action.type) {
    case "tabChanged":
      return { ...state, tab: action.tab };
    case "filterAdded":
      return conditionsChanged({ ...state, filters: [...state.filters, action.filter] });
    case "filterRemoved":
      return conditionsChanged({
        ...state,
        filters: state.filters.filter((_, index) => index !== action.index),
      });
    case "rawWhereApplied": {
      const trimmed = action.text.trim();
      return conditionsChanged({ ...state, rawWhere: trimmed === "" ? null : trimmed });
    }
    case "sortToggled":
      return backToFirstPage({ ...state, sort: nextSort(state.sort, action.column) });
    case "pageMoved":
      return {
        ...state,
        page: Math.max(state.page + action.delta, 0),
        active: null,
        fullCell: idle,
      };
    case "rowsRequested":
      return { ...state, rows: request(state.rows, action.requestId) };
    case "rowsLoaded":
      return { ...state, rows: settle(state.rows, action.requestId, action.result) };
    case "countRequested":
      return { ...state, count: request(state.count, action.requestId) };
    case "countLoaded":
      return {
        ...state,
        count: settle(
          state.count,
          action.requestId,
          map(action.result, (r) => r.count),
        ),
      };
    case "detailRequested":
      return { ...state, detail: request(state.detail, action.requestId) };
    case "detailLoaded":
      return { ...state, detail: settle(state.detail, action.requestId, action.result) };
    case "activeCellChanged": {
      const same = state.active?.row === action.pos?.row && state.active?.col === action.pos?.col;
      return same ? state : { ...state, active: action.pos, fullCell: idle };
    }
    case "fullCellRequested":
      return { ...state, fullCell: request(state.fullCell, action.requestId) };
    case "fullCellLoaded":
      return {
        ...state,
        fullCell: settle(
          state.fullCell,
          action.requestId,
          map(action.result, (r) => r.value),
        ),
      };
  }
};
