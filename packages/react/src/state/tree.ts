import type {
  DbViewerError,
  SchemaName,
  TableKind,
  TableRef,
  TableSummary,
} from "@myaaaaa_chan/db-viewer-core";
import { idle, type Remote } from "./remote";

// ツリーの見た目に関する状態。読み込み結果（スキーマとテーブル）は ViewerState が持つ。
export type TreeUiState = {
  // 利用者が開閉した行だけを持つ。持っていない行は既定の開き方に従う
  readonly overrides: Readonly<Record<string, boolean>>;
  readonly query: string;
  readonly focusedKey: string | null;
};

export const initialTreeUi: TreeUiState = { overrides: {}, query: "", focusedKey: null };

export type TreeUiAction =
  | { readonly type: "toggled"; readonly key: string; readonly expanded: boolean }
  | { readonly type: "queryChanged"; readonly query: string }
  | { readonly type: "focused"; readonly key: string | null };

export const treeUiReducer = (state: TreeUiState, action: TreeUiAction): TreeUiState => {
  switch (action.type) {
    case "toggled":
      return { ...state, overrides: { ...state.overrides, [action.key]: action.expanded } };
    case "queryChanged":
      return { ...state, query: action.query };
    case "focused":
      return { ...state, focusedKey: action.key };
  }
};

export const schemaKey = (schema: SchemaName): string => JSON.stringify(["schema", schema]);
export const groupKey = (schema: SchemaName, group: TableKind): string =>
  JSON.stringify(["group", schema, group]);
export const tableKey = (ref: TableRef): string => JSON.stringify(["table", ref.schema, ref.name]);

// 最初から開いておくスキーマ。PostgreSQL の public と SQLite の main を優先する。
export const defaultSchema = (schemas: ReadonlyArray<SchemaName>): SchemaName | null =>
  schemas.find((s) => s === "public" || s === "main") ?? schemas[0] ?? null;

export type MatchParts = {
  readonly before: string;
  readonly match: string;
  readonly after: string;
};

// 検索語に最初に一致した部分で 3 つに分ける（大文字小文字は区別しない）。
export const matchParts = (name: string, query: string): MatchParts => {
  const needle = query.trim().toLowerCase();
  const index = needle === "" ? -1 : name.toLowerCase().indexOf(needle);
  if (index < 0) return { before: name, match: "", after: "" };
  return {
    before: name.slice(0, index),
    match: name.slice(index, index + needle.length),
    after: name.slice(index + needle.length),
  };
};

export type TreeStatus = "loading" | "failed" | "empty" | "noMatch";

export type TreeRow =
  | {
      readonly kind: "schema";
      readonly key: string;
      readonly level: 1;
      readonly schema: SchemaName;
      readonly expanded: boolean;
      readonly posInSet: number;
      readonly setSize: number;
    }
  | {
      readonly kind: "group";
      readonly key: string;
      readonly level: 2;
      readonly schema: SchemaName;
      readonly group: TableKind;
      readonly expanded: boolean;
      readonly total: number;
      // 検索中だけ、一致した数を持つ
      readonly matched: number | null;
      readonly posInSet: number;
      readonly setSize: number;
    }
  | {
      readonly kind: "table";
      readonly key: string;
      readonly level: 3;
      readonly ref: TableRef;
      readonly tableKind: TableKind;
      readonly selected: boolean;
      readonly match: MatchParts;
      readonly posInSet: number;
      readonly setSize: number;
    }
  | {
      readonly kind: "status";
      readonly key: string;
      readonly level: 2 | 3;
      readonly status: TreeStatus;
      readonly group?: TableKind;
      readonly error?: DbViewerError;
    };

export type TreeInput = {
  readonly schemas: Remote<ReadonlyArray<SchemaName>>;
  readonly tables: Readonly<Record<string, Remote<ReadonlyArray<TableSummary>>>>;
  readonly ui: TreeUiState;
  readonly selected: TableRef | null;
};

const GROUPS: ReadonlyArray<TableKind> = ["table", "view"];

const containsIgnoringCase = (name: string, query: string): boolean =>
  name.toLowerCase().includes(query.toLowerCase());

// 仮想スクロールで描くために、開いている行だけを平らな配列にする。
export const flattenTree = (input: TreeInput): ReadonlyArray<TreeRow> => {
  const { schemas, tables, ui, selected } = input;
  if (schemas.status !== "ready") return [];

  const query = ui.query.trim();
  const opened = defaultSchema(schemas.value);
  const rows: Array<TreeRow> = [];

  schemas.value.forEach((schema, schemaIndex) => {
    const key = schemaKey(schema);
    const expanded = ui.overrides[key] ?? schema === opened;
    const remote = tables[schema] ?? idle;
    // 検索は読み込み済みのテーブルだけが対象。一致がないスキーマと、まだ読み込んでいないスキーマは出さない
    const hiddenBySearch =
      query !== "" &&
      (remote.status === "ready"
        ? !remote.value.some((t) => containsIgnoringCase(t.ref.name, query))
        : remote.status === "idle" && !expanded);
    if (hiddenBySearch) return;
    rows.push({
      kind: "schema",
      key,
      level: 1,
      schema,
      expanded,
      posInSet: schemaIndex + 1,
      setSize: schemas.value.length,
    });
    if (!expanded) return;

    if (remote.status === "idle" || remote.status === "loading") {
      rows.push({ kind: "status", key: `${key}:loading`, level: 2, status: "loading" });
      return;
    }
    if (remote.status === "failed") {
      rows.push({
        kind: "status",
        key: `${key}:failed`,
        level: 2,
        status: "failed",
        error: remote.error,
      });
      return;
    }

    const groups = GROUPS.map((group) => ({
      group,
      items: remote.value.filter((t) => t.kind === group),
    })).filter(({ items }) => items.length > 0);
    if (groups.length === 0) {
      rows.push({ kind: "status", key: `${key}:empty`, level: 2, status: "empty" });
      return;
    }

    groups.forEach(({ group, items }, groupIndex) => {
      const matches =
        query === "" ? items : items.filter((t) => containsIgnoringCase(t.ref.name, query));
      if (matches.length === 0) {
        rows.push({
          kind: "status",
          key: `${groupKey(schema, group)}:noMatch`,
          level: 2,
          status: "noMatch",
          group,
        });
        return;
      }
      const gKey = groupKey(schema, group);
      const groupExpanded = ui.overrides[gKey] ?? (query !== "" || group === "table");
      rows.push({
        kind: "group",
        key: gKey,
        level: 2,
        schema,
        group,
        expanded: groupExpanded,
        total: items.length,
        matched: query === "" ? null : matches.length,
        posInSet: groupIndex + 1,
        setSize: groups.length,
      });
      if (!groupExpanded) return;
      matches.forEach((item, itemIndex) => {
        rows.push({
          kind: "table",
          key: tableKey(item.ref),
          level: 3,
          ref: item.ref,
          tableKind: item.kind,
          selected: selected?.schema === item.ref.schema && selected.name === item.ref.name,
          match: matchParts(item.ref.name, query),
          posInSet: itemIndex + 1,
          setSize: matches.length,
        });
      });
    });
  });
  return rows;
};

export type TreeKeyResult =
  | { readonly focus: string }
  | { readonly toggle: { readonly key: string; readonly expanded: boolean } }
  | { readonly activate: TableRef };

type FocusableRow = Exclude<TreeRow, { kind: "status" }>;

const isFocusable = (row: TreeRow): row is FocusableRow => row.kind !== "status";

// キーボード操作の結果を、フォーカスの移動・開閉・テーブルの選択のどれかとして返す。
export const treeKeyAction = (
  rows: ReadonlyArray<TreeRow>,
  focusedKey: string | null,
  key: string,
): TreeKeyResult | null => {
  const items = rows.filter(isFocusable);
  const first = items[0];
  if (!first) return null;
  const index = items.findIndex((row) => row.key === focusedKey);
  const current = items[index];
  const focusAt = (i: number): TreeKeyResult => ({
    focus: (items[Math.min(Math.max(i, 0), items.length - 1)] ?? first).key,
  });

  if (!current) {
    return key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End"
      ? { focus: first.key }
      : null;
  }

  switch (key) {
    case "ArrowDown":
      return focusAt(index + 1);
    case "ArrowUp":
      return focusAt(index - 1);
    case "Home":
      return focusAt(0);
    case "End":
      return focusAt(items.length - 1);
    case "ArrowRight": {
      if (current.kind === "table") return null;
      if (!current.expanded) return { toggle: { key: current.key, expanded: true } };
      const child = items[index + 1];
      return child && child.level > current.level ? { focus: child.key } : null;
    }
    case "ArrowLeft": {
      if (current.kind !== "table" && current.expanded) {
        return { toggle: { key: current.key, expanded: false } };
      }
      const parent = items
        .slice(0, index)
        .reverse()
        .find((row) => row.level < current.level);
      return parent ? { focus: parent.key } : null;
    }
    case "Enter":
    case " ":
      return current.kind === "table"
        ? { activate: current.ref }
        : { toggle: { key: current.key, expanded: !current.expanded } };
    default:
      return null;
  }
};
