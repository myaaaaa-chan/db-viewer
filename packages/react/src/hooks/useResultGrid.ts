import type { CellValue, ResultSet, Sort } from "@myaaaaa_chan/db-viewer-core";
import {
  columnResizingFeature,
  columnSizingFeature,
  createColumnHelper,
  rowSortingFeature,
  type SortingState,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { copyText } from "../clipboard";
import { defaultColumnWidth } from "../lib/column-width";
import { toTsv } from "../lib/tsv";
import {
  type CellPos,
  type GridSelection,
  gridSelectionReducer,
  rangeOf,
  sliceRange,
} from "../state/grid-selection";

// 罫線の 1px を含めた高さ（デザインの 行 30px + 罫線 1px、ヘッダー 44px + 罫線 1px）
export const ROW_HEIGHT = 31;
export const HEADER_HEIGHT = 45;
const MIN_WIDTH = 60;
const MAX_WIDTH = 900;
const PAGE_ROWS = 10;

// TanStack Table は列・列幅・並べ替えの表示だけを持つ。行は結果の配列をそのまま仮想スクロールで描く。
const features = tableFeatures({ columnSizingFeature, columnResizingFeature, rowSortingFeature });
type GridRow = ReadonlyArray<CellValue>;
const columnHelper = createColumnHelper<typeof features, GridRow>();

const columnId = (index: number): string => `c${index}`;

const columnsKeyOf = (result: ResultSet): string =>
  JSON.stringify(result.columns.map((c) => [c.name, c.dbType]));

const initialSizing = (result: ResultSet) => ({
  key: columnsKeyOf(result),
  sizes: Object.fromEntries(
    result.columns.map((column, index) => [
      columnId(index),
      defaultColumnWidth(
        column,
        result.rows.slice(0, 50).map((row) => row[index] ?? null),
      ),
    ]),
  ),
});

const sortingOf = (result: ResultSet, sort: Sort | null): SortingState => {
  if (!sort) return [];
  const index = result.columns.findIndex((c) => c.name === sort.column);
  return index < 0 ? [] : [{ id: columnId(index), desc: sort.direction === "desc" }];
};

export type UseResultGridOptions = {
  readonly result: ResultSet;
  readonly scrollRef: RefObject<HTMLDivElement | null>;
  readonly sort: Sort | null;
  readonly onSelectionChange?: ((selection: GridSelection | null) => void) | undefined;
};

export const useResultGrid = ({
  result,
  scrollRef,
  sort,
  onSelectionChange,
}: UseResultGridOptions) => {
  const columnCount = result.columns.length;
  const rowCount = result.rows.length;

  // 列幅は、列が同じ間（ページ送りや並べ替え）は保ち、列が変わったら既定の幅から作り直す
  const [sizing, setSizing] = useState(() => initialSizing(result));
  const columnsKey = columnsKeyOf(result);
  if (sizing.key !== columnsKey) setSizing(initialSizing(result));

  const columns = useMemo(
    () =>
      columnHelper.columns(
        result.columns.map((column, index) =>
          columnHelper.accessor((row) => row[index] ?? null, {
            id: columnId(index),
            header: column.name,
            minSize: MIN_WIDTH,
            maxSize: MAX_WIDTH,
          }),
        ),
      ),
    [result.columns],
  );

  const table = useTable({
    features,
    columns,
    data: result.rows,
    state: { sorting: sortingOf(result, sort), columnSizing: sizing.sizes },
    manualSorting: true,
    enableSorting: true,
    enableColumnResizing: true,
    columnResizeMode: "onChange",
    onColumnSizingChange: (updater) =>
      setSizing((previous) => ({
        ...previous,
        sizes: typeof updater === "function" ? updater(previous.sizes) : updater,
      })),
  });

  const headers = table.getFlatHeaders();
  const widths = headers.map((header) => header.getSize());
  const widthsKey = widths.join(",");

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    paddingStart: HEADER_HEIGHT,
    scrollPaddingStart: HEADER_HEIGHT,
  });
  const colVirtualizer = useVirtualizer({
    horizontal: true,
    count: columnCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => widths[index] ?? MIN_WIDTH,
    overscan: 3,
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: 列幅が変わったときに、測り直すための合図
  useLayoutEffect(() => colVirtualizer.measure(), [colVirtualizer, widthsKey]);

  // 結果が入れ替わったら選択を捨てる（古い位置を新しい結果に残さない）
  const [selection, dispatch] = useReducer(gridSelectionReducer, null);
  const [shownResult, setShownResult] = useState(result);
  if (shownResult !== result) {
    setShownResult(result);
    dispatch({ type: "cleared" });
  }

  const latestOnChange = useRef(onSelectionChange);
  useEffect(() => {
    latestOnChange.current = onSelectionChange;
  });
  useEffect(() => {
    latestOnChange.current?.(selection);
  }, [selection]);

  // 見える位置まで動かすのは、キーボードで選択を動かしたときだけ。マウスで押したセルは動かさない
  const scrollToFocus = useRef(false);
  const focus = selection?.focus ?? null;
  const focusRow = focus?.row;
  const focusCol = focus?.col;
  useEffect(() => {
    if (!scrollToFocus.current) return;
    scrollToFocus.current = false;
    if (focusRow !== undefined) rowVirtualizer.scrollToIndex(focusRow, { align: "auto" });
    if (focusCol !== undefined) colVirtualizer.scrollToIndex(focusCol, { align: "auto" });
  }, [focusRow, focusCol, rowVirtualizer, colVirtualizer]);

  const dragging = useRef(false);
  useEffect(() => {
    const stop = () => {
      dragging.current = false;
    };
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, []);

  const cellAt = (target: EventTarget): CellPos | null => {
    const cell = target instanceof Element ? target.closest<HTMLElement>("[data-dbv-row]") : null;
    if (!cell) return null;
    return { row: Number(cell.dataset["dbvRow"]), col: Number(cell.dataset["dbvCol"]) };
  };

  const onMouseDown = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const pos = cellAt(event.target);
    if (!pos) return;
    dragging.current = true;
    dispatch({ type: "pressed", pos, extend: event.shiftKey });
  };

  const onMouseOver = (event: MouseEvent<HTMLElement>) => {
    if (!dragging.current) return;
    const pos = cellAt(event.target);
    if (pos) dispatch({ type: "dragged", pos });
  };

  const copySelection = useCallback(
    (current: GridSelection | null) => {
      if (!current) return;
      void copyText(toTsv(sliceRange(result.rows, rangeOf(current))));
    },
    [result.rows],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const bounds = { rows: rowCount, cols: columnCount };
    const modifier = event.metaKey || event.ctrlKey;
    const move = (dRow: number, dCol: number) => {
      event.preventDefault();
      scrollToFocus.current = true;
      dispatch({ type: "moved", dRow, dCol, extend: event.shiftKey, bounds });
    };
    const end = Number.POSITIVE_INFINITY;

    if (modifier && event.key.toLowerCase() === "c") {
      event.preventDefault();
      copySelection(selection);
      return;
    }
    if (modifier && event.key.toLowerCase() === "a") {
      event.preventDefault();
      scrollToFocus.current = false;
      dispatch({ type: "allSelected", bounds });
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        return move(modifier ? end : 1, 0);
      case "ArrowUp":
        return move(modifier ? -end : -1, 0);
      case "ArrowRight":
        return move(0, modifier ? end : 1);
      case "ArrowLeft":
        return move(0, modifier ? -end : -1);
      case "Home":
        return move(modifier ? -end : 0, -end);
      case "End":
        return move(modifier ? end : 0, end);
      case "PageDown":
        return move(PAGE_ROWS, 0);
      case "PageUp":
        return move(-PAGE_ROWS, 0);
      case "Escape":
        dispatch({ type: "cleared" });
        return;
    }
  };

  const truncated = useMemo(
    () => new Set(result.truncatedCells.map(([row, col]) => `${row}:${col}`)),
    [result.truncatedCells],
  );

  return {
    headers,
    widths,
    totalWidth: colVirtualizer.getTotalSize(),
    totalHeight: rowVirtualizer.getTotalSize(),
    virtualRows: rowVirtualizer.getVirtualItems(),
    virtualCols: colVirtualizer.getVirtualItems(),
    selection,
    range: selection ? rangeOf(selection) : null,
    truncated,
    handlers: { onMouseDown, onMouseOver, onKeyDown },
  };
};
