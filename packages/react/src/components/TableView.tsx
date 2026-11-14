import { type ConnectionInfo, columnName, type TableRef } from "@myaaaaa_chan/db-viewer-core";
import { type ReactNode, useState } from "react";
import { useDbViewer } from "../context";
import { useErrorString } from "../hooks/useErrorString";
import { useTableView } from "../hooks/useTableView";
import type { MessageKey } from "../i18n/messages";
import { useT } from "../i18n/useT";
import { describeActiveCell } from "../lib/active-cell";
import { pageInfo } from "../lib/page-info";
import { type GridBounds, type GridSelection, rangeOf, rangeSize } from "../state/grid-selection";
import { shownValue } from "../state/remote";
import { type DetailTab, PAGE_SIZE } from "../state/table-view";
import { selectedConnection } from "../state/viewer";
import { CellDetailPanel } from "./CellDetailPanel";
import { cx } from "./cx";
import { ErrorCard } from "./ErrorCard";
import { FilterBar } from "./FilterBar";
import { ReadOnlyBadge } from "./ReadOnlyBadge";
import { ResultGrid } from "./ResultGrid";
import { TableFooter } from "./TableFooter";
import { TableInfo } from "./TableInfo";

export type TableViewProps = {
  // ツールバーの先頭に置くもの（<DbViewer> が「データ / SQL」の切り替えを置く）
  readonly toolbarStart?: ReactNode;
  readonly className?: string;
};

const TABS: ReadonlyArray<{
  readonly tab: DetailTab;
  readonly label: MessageKey;
}> = [
  { tab: "rows", label: "table.tabRows" },
  { tab: "columns", label: "table.tabColumns" },
  { tab: "indexes", label: "table.tabIndexes" },
  { tab: "foreignKeys", label: "table.tabForeignKeys" },
  { tab: "ddl", label: "table.tabDdl" },
];

// 選択中のテーブルのデータ表と、カラム・インデックス・外部キー・DDL。
export function TableView(props: TableViewProps) {
  const { state } = useDbViewer();
  const { t } = useT();
  const connection = selectedConnection(state);

  if (!connection || !state.table) {
    return (
      <div className={cx("dbv-table", props.className)}>
        <div className="dbv-toolbar">{props.toolbarStart}</div>
        <p className="dbv-table-empty">{t("viewer.selectTable")}</p>
      </div>
    );
  }
  // テーブルや接続を切り替えたら、フィルタ・並べ替え・ページを引き継がず作り直す
  const key = JSON.stringify([connection.name, state.table.schema, state.table.name]);
  return <TableViewBody key={key} connection={connection} table={state.table} {...props} />;
}

function TableViewBody(
  props: TableViewProps & { readonly connection: ConnectionInfo; readonly table: TableRef },
) {
  const { connection, table, toolbarStart, className } = props;
  const { t } = useT();
  const errorString = useErrorString();
  const view = useTableView(connection.name, table);
  const { state, dispatch, shownRows } = view;
  const [selectionSize, setSelectionSize] = useState<GridBounds | null>(null);

  const detail = shownValue(state.detail);
  const activeCell =
    shownRows && state.active ? describeActiveCell(shownRows, state.active, detail) : null;
  const columnNames = detail
    ? detail.columns.map((c) => c.name)
    : (shownRows?.columns.map((c) => columnName(c.name)) ?? []);

  const onSelectionChange = (selection: GridSelection | null) => {
    dispatch({ type: "activeCellChanged", pos: selection?.anchor ?? null });
    setSelectionSize(selection ? rangeSize(rangeOf(selection)) : null);
  };

  const page = pageInfo({
    page: state.page,
    limit: PAGE_SIZE,
    rowCount: shownRows?.rows.length ?? 0,
    truncated: shownRows?.truncated ?? false,
    total: state.count.status === "ready" ? Number(state.count.value) : null,
  });

  return (
    <div className={cx("dbv-table", className)}>
      <div className="dbv-toolbar">
        {toolbarStart}
        <div className="dbv-title">
          <span className="dbv-title-schema">{table.schema}</span>
          <span className="dbv-title-schema">.</span>
          <span className="dbv-title-name">{table.name}</span>
        </div>
        {connection.readOnly ? <ReadOnlyBadge /> : null}
      </div>

      <div className="dbv-tabs" role="tablist" aria-label={t("table.info")}>
        {TABS.map(({ tab, label }) => (
          <button
            key={tab}
            type="button"
            role="tab"
            className="dbv-tab"
            aria-selected={state.tab === tab}
            onClick={() => dispatch({ type: "tabChanged", tab })}
          >
            {t(label)}
          </button>
        ))}
      </div>

      {state.tab === "rows" ? (
        <>
          <FilterBar
            columns={columnNames}
            filters={state.filters}
            rawWhere={state.rawWhere}
            onAdd={(filter) => dispatch({ type: "filterAdded", filter })}
            onRemove={(index) => dispatch({ type: "filterRemoved", index })}
            onApplyWhere={(text) => dispatch({ type: "rawWhereApplied", text })}
          />
          <div className="dbv-table-body" role="tabpanel">
            {state.rows.status === "failed" ? (
              <div className="dbv-table-error">
                <ErrorCard title={t("table.loadFailed")} message={errorString(state.rows.error)} />
              </div>
            ) : shownRows ? (
              <ResultGrid
                result={shownRows}
                label={t("grid.dataLabel", { table: `${table.schema}.${table.name}` })}
                sort={state.sort}
                onSortToggle={(column) => dispatch({ type: "sortToggled", column })}
                onSelectionChange={onSelectionChange}
                busy={state.rows.status === "loading"}
              />
            ) : (
              <p className="dbv-table-loading">{t("common.loading")}</p>
            )}
            <CellDetailPanel
              cell={activeCell}
              full={state.fullCell}
              onLoadFull={() => activeCell && view.loadFullCell(activeCell)}
            />
          </div>
          <TableFooter
            selectionSize={selectionSize}
            page={page}
            count={state.count}
            onCount={view.loadCount}
            onPrev={() => dispatch({ type: "pageMoved", delta: -1 })}
            onNext={() => dispatch({ type: "pageMoved", delta: 1 })}
          />
        </>
      ) : state.detail.status === "failed" ? (
        <div className="dbv-table-error" role="tabpanel">
          <ErrorCard title={t("table.detailFailed")} message={errorString(state.detail.error)} />
        </div>
      ) : detail ? (
        <div className="dbv-table-body dbv-table-body--info" role="tabpanel">
          <TableInfo tab={state.tab} detail={detail} />
        </div>
      ) : (
        <p className="dbv-table-loading">{t("common.loading")}</p>
      )}
    </div>
  );
}
