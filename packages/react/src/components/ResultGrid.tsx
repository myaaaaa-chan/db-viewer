import type { ColumnName, ResultSet, Sort } from "@myaaaaa_chan/db-viewer-core";
import { useId, useRef } from "react";
import { HEADER_HEIGHT, ROW_HEIGHT, useResultGrid } from "../hooks/useResultGrid";
import { useT } from "../i18n/useT";
import { isNumericType } from "../lib/numeric-type";
import { type GridSelection, isInRange } from "../state/grid-selection";
import { cx } from "./cx";

export type ResultGridProps = {
  readonly result: ResultSet;
  // 表のラベル（読み上げ用）。省略すると「SQL の実行結果」
  readonly label?: string;
  // 並べ替え中の列。onSortToggle を渡したときだけ、列ヘッダーを押して切り替えられる
  readonly sort?: Sort | null;
  readonly onSortToggle?: (column: ColumnName) => void;
  // 範囲選択が変わったときに呼ぶ。anchor が詳細パネルに出すセル
  readonly onSelectionChange?: (selection: GridSelection | null) => void;
  // 次の結果を読み込み中。表は直前の結果を出したまま、薄くする
  readonly busy?: boolean;
  readonly emptyMessage?: string;
  readonly className?: string;
};

const SORT_MARK = { asc: "↑", desc: "↓" } as const;
const ARIA_SORT = { asc: "ascending", desc: "descending" } as const;

// ResultSet を表示するだけの表。範囲選択・Cmd/Ctrl+C の TSV コピー・列幅の変更ができる。
// <DbViewerProvider> がなくても動く（文言は英語になる）。
export function ResultGrid(props: ResultGridProps) {
  const { result, sort = null, onSortToggle, onSelectionChange, busy = false, className } = props;
  const { t } = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridId = useId();
  const grid = useResultGrid({ result, scrollRef, sort, onSelectionChange });
  const columnCount = result.columns.length;
  const active = grid.selection?.anchor ?? null;
  const cellId = (row: number, col: number) => `${gridId}-r${row}c${col}`;

  return (
    <div
      ref={scrollRef}
      className={cx("dbv-grid", busy && "dbv-grid--busy", className)}
      role="grid"
      tabIndex={0}
      aria-label={props.label ?? t("grid.resultLabel")}
      aria-rowcount={result.rows.length + 1}
      aria-colcount={columnCount}
      aria-multiselectable="true"
      aria-busy={busy}
      aria-activedescendant={active ? cellId(active.row, active.col) : undefined}
      {...grid.handlers}
    >
      <div className="dbv-grid-canvas" style={{ width: grid.totalWidth, height: grid.totalHeight }}>
        <div
          className="dbv-grid-head"
          role="row"
          aria-rowindex={1}
          style={{ width: grid.totalWidth, height: HEADER_HEIGHT }}
        >
          {grid.virtualCols.map((virtualCol) => {
            const header = grid.headers[virtualCol.index];
            const column = result.columns[virtualCol.index];
            if (!header || !column) return null;
            const direction = header.column.getIsSorted();
            const content = (
              <>
                <span className="dbv-grid-colname">
                  {column.name}
                  {direction ? (
                    <span className="dbv-grid-sortmark">{SORT_MARK[direction]}</span>
                  ) : null}
                </span>
                <span className="dbv-grid-coltype">{column.dbType ?? ""}</span>
              </>
            );
            return (
              <div
                key={virtualCol.key}
                className="dbv-grid-th"
                role="columnheader"
                aria-colindex={virtualCol.index + 1}
                aria-sort={direction ? ARIA_SORT[direction] : "none"}
                style={{ left: virtualCol.start, width: virtualCol.size }}
              >
                {onSortToggle ? (
                  <button
                    type="button"
                    className="dbv-grid-thbutton"
                    onClick={() => onSortToggle(column.name as ColumnName)}
                  >
                    {content}
                  </button>
                ) : (
                  <div className="dbv-grid-thbutton">{content}</div>
                )}
                <div
                  className="dbv-grid-resizer"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={t("grid.resizeColumn", { column: column.name })}
                  onMouseDown={header.getResizeHandler()}
                  onTouchStart={header.getResizeHandler()}
                />
              </div>
            );
          })}
        </div>

        {grid.virtualRows.map((virtualRow) => {
          const row = result.rows[virtualRow.index];
          if (!row) return null;
          return (
            <div
              key={virtualRow.key}
              className="dbv-grid-row"
              role="row"
              aria-rowindex={virtualRow.index + 2}
              style={{
                top: virtualRow.start,
                height: ROW_HEIGHT,
                width: grid.totalWidth,
              }}
            >
              {grid.virtualCols.map((virtualCol) => {
                const value = row[virtualCol.index] ?? null;
                const selected =
                  grid.range !== null && isInRange(grid.range, virtualRow.index, virtualCol.index);
                const isActive =
                  active?.row === virtualRow.index && active.col === virtualCol.index;
                return (
                  <div
                    key={virtualCol.key}
                    id={cellId(virtualRow.index, virtualCol.index)}
                    className={cx(
                      "dbv-cell",
                      isNumericType(result.columns[virtualCol.index]?.dbType ?? null) &&
                        "dbv-cell--num",
                      value === null && "dbv-cell--null",
                      selected && "dbv-cell--sel",
                      isActive && "dbv-cell--act",
                      grid.truncated.has(`${virtualRow.index}:${virtualCol.index}`) &&
                        "dbv-cell--trunc",
                    )}
                    role="gridcell"
                    aria-colindex={virtualCol.index + 1}
                    aria-selected={selected}
                    data-dbv-row={virtualRow.index}
                    data-dbv-col={virtualCol.index}
                    style={{ left: virtualCol.start, width: virtualCol.size }}
                  >
                    {value === null ? "NULL" : value}
                  </div>
                );
              })}
            </div>
          );
        })}

        {result.rows.length === 0 ? (
          <div className="dbv-grid-empty" style={{ top: HEADER_HEIGHT }}>
            {props.emptyMessage ?? t("table.empty")}
          </div>
        ) : null}
      </div>
    </div>
  );
}
