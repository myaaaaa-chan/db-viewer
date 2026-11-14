import { useId, useRef } from "react";
import { useDbViewer } from "../context";
import { useErrorString } from "../hooks/useErrorString";
import { TREE_ROW_HEIGHT, useSchemaTree } from "../hooks/useSchemaTree";
import { useT } from "../i18n/useT";
import type { TreeRow } from "../state/tree";
import { ConnectionSelect } from "./ConnectionSelect";
import { cx } from "./cx";
import { Icon } from "./Icon";

export type SchemaTreeProps = { readonly className?: string };

// 接続の選択・テーブル名の検索・スキーマ／テーブル／ビューのツリー。
// ツリーは仮想スクロールで描き、スキーマを開いたときにテーブルの一覧を読み込む。
export function SchemaTree(props: SchemaTreeProps) {
  const { t } = useT();
  const errorString = useErrorString();
  const viewer = useDbViewer();
  const scrollRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const tree = useSchemaTree(scrollRef);
  const { connections, schemas } = tree.state;
  const rowId = (index: number) => `${id}-row-${index}`;

  const connectionList = connections.status === "ready" ? connections.value : [];

  const rowLabel = (row: Exclude<TreeRow, { kind: "status" }>) => {
    if (row.kind === "schema") return <span className="dbv-tree-schema">{row.schema}</span>;
    if (row.kind === "group") {
      return (
        <>
          <span className="dbv-tree-group">
            {row.group === "table" ? t("tree.tables") : t("tree.views")}
          </span>
          <span className="dbv-tree-count">
            {row.matched === null
              ? t("tree.groupCount", { count: row.total })
              : t("tree.groupMatch", { matched: row.matched, total: row.total })}
          </span>
        </>
      );
    }
    return (
      <>
        <Icon name={row.tableKind === "view" ? "view" : "table"} size={14} />
        <span>
          {row.match.before}
          {row.match.match ? <mark className="dbv-mark">{row.match.match}</mark> : null}
          {row.match.after}
        </span>
      </>
    );
  };

  const statusText = (row: Extract<TreeRow, { kind: "status" }>) => {
    switch (row.status) {
      case "loading":
        return t("common.loading");
      case "empty":
        return t("tree.emptySchema");
      case "noMatch":
        return row.group === "view" ? t("tree.noMatchViews") : t("tree.noMatchTables");
      case "failed":
        return `${t("tree.loadFailed")}${row.error ? `: ${errorString(row.error)}` : ""}`;
    }
  };

  return (
    <aside className={cx("dbv-side", props.className)}>
      <div className="dbv-side-head">
        {connectionList.length > 1 ? (
          <ConnectionSelect
            connections={connectionList}
            selected={tree.state.connection}
            onSelect={viewer.selectConnection}
          />
        ) : null}
        <div className="dbv-search">
          <label className="dbv-sr-only" htmlFor={`${id}-search`}>
            {t("tree.search")}
          </label>
          <Icon name="search" size={14} className="dbv-search-icon" />
          <input
            id={`${id}-search`}
            type="search"
            className={cx(
              "dbv-search-input",
              tree.query.trim() !== "" && "dbv-search-input--active",
            )}
            placeholder={t("tree.search")}
            value={tree.query}
            onChange={(event) => tree.setQuery(event.target.value)}
          />
        </div>
      </div>

      {connections.status === "failed" ? (
        <p className="dbv-side-message">
          {t("tree.connectionsFailed")}: {errorString(connections.error)}
        </p>
      ) : connections.status === "ready" && connections.value.length === 0 ? (
        <p className="dbv-side-message">{t("tree.noConnections")}</p>
      ) : schemas.status === "failed" ? (
        <p className="dbv-side-message">
          {t("tree.schemasFailed")}: {errorString(schemas.error)}
        </p>
      ) : (
        <div className="dbv-tree-scroll" ref={scrollRef}>
          <div
            className="dbv-tree"
            role="tree"
            tabIndex={0}
            aria-label={t("tree.schemas")}
            aria-activedescendant={tree.focusedIndex >= 0 ? rowId(tree.focusedIndex) : undefined}
            style={{ height: tree.totalSize }}
            onKeyDown={tree.onKeyDown}
            onFocus={tree.onFocus}
          >
            {tree.virtualItems.map((item) => {
              const row = tree.rows[item.index];
              if (!row) return null;
              const style = { top: item.start, height: TREE_ROW_HEIGHT };
              if (row.kind === "status") {
                return (
                  <div
                    key={row.key}
                    id={rowId(item.index)}
                    className={cx("dbv-tree-status", `dbv-tree-status--level${row.level}`)}
                    role="treeitem"
                    aria-level={row.level}
                    aria-disabled="true"
                    style={style}
                  >
                    {statusText(row)}
                  </div>
                );
              }
              return (
                <div
                  key={row.key}
                  id={rowId(item.index)}
                  className={cx(
                    "dbv-tree-row",
                    `dbv-tree-row--${row.kind}`,
                    row.kind === "table" && row.selected && "dbv-tree-row--selected",
                    item.index === tree.focusedIndex && "dbv-tree-row--focused",
                  )}
                  role="treeitem"
                  aria-level={row.level}
                  aria-posinset={row.posInSet}
                  aria-setsize={row.setSize}
                  aria-expanded={row.kind === "table" ? undefined : row.expanded}
                  aria-selected={row.kind === "table" ? row.selected : undefined}
                  style={style}
                  onClick={() => tree.activate(row)}
                >
                  {row.kind === "table" ? null : (
                    <Icon
                      name={row.expanded ? "chevronDown" : "chevronRight"}
                      size={12}
                      className="dbv-muted-icon"
                    />
                  )}
                  {rowLabel(row)}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
}
