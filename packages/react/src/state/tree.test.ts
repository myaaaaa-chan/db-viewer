import {
  schemaName,
  type TableKind,
  type TableSummary,
  tableName,
} from "@myaaaaa_chan/db-viewer-core";
import { describe, expect, it } from "vitest";
import type { Remote } from "./remote";
import {
  defaultSchema,
  flattenTree,
  initialTreeUi,
  matchParts,
  type TreeRow,
  type TreeUiState,
  treeKeyAction,
  treeUiReducer,
} from "./tree";

const publicSchema = schemaName("public");
const drizzle = schemaName("drizzle");
const summary = (schema: string, name: string, kind: TableKind = "table"): TableSummary => ({
  ref: { schema: schemaName(schema), name: tableName(name) },
  kind,
});
const ready = <T>(value: T): Remote<T> => ({ status: "ready", value });

const publicTables = [
  summary("public", "orders"),
  summary("public", "sessions"),
  summary("public", "users"),
  summary("public", "active_users", "view"),
  summary("public", "recent_orders", "view"),
];

const input = (ui: TreeUiState = initialTreeUi, selected = null as TableSummary["ref"] | null) => ({
  schemas: ready([publicSchema, drizzle]),
  tables: { [publicSchema]: ready(publicTables) },
  ui,
  selected,
});

const kinds = (rows: ReadonlyArray<TreeRow>) => rows.map((row) => row.kind);
const names = (rows: ReadonlyArray<TreeRow>) =>
  rows.flatMap((row) => (row.kind === "table" ? [row.ref.name as string] : []));

describe("defaultSchema", () => {
  it("public か main があればそれを、なければ先頭を選ぶ", () => {
    expect(defaultSchema([drizzle, publicSchema])).toBe("public");
    expect(defaultSchema([drizzle, schemaName("main")])).toBe("main");
    expect(defaultSchema([drizzle, schemaName("zeta")])).toBe("drizzle");
    expect(defaultSchema([])).toBeNull();
  });
});

describe("flattenTree（既定の開き方）", () => {
  const rows = flattenTree(input());

  it("既定のスキーマとテーブルの組を開き、ビューの組と他のスキーマは閉じておく", () => {
    expect(kinds(rows)).toEqual(["schema", "group", "table", "table", "table", "group", "schema"]);
    expect(names(rows)).toEqual(["orders", "sessions", "users"]);
  });

  it("組の見出しにはテーブルとビューの数を持たせる", () => {
    const groups = rows.flatMap((row) => (row.kind === "group" ? [row] : []));
    expect(groups.map((g) => [g.group, g.total, g.matched, g.expanded])).toEqual([
      ["table", 3, null, true],
      ["view", 2, null, false],
    ]);
  });

  it("ARIA のために、階層・何番目か・兄弟の数を持つ", () => {
    expect(rows[0]).toMatchObject({ level: 1, posInSet: 1, setSize: 2 });
    expect(rows[1]).toMatchObject({ level: 2, posInSet: 1, setSize: 2 });
    expect(rows[2]).toMatchObject({ level: 3, posInSet: 1, setSize: 3 });
  });

  it("選択中のテーブルの行に印を付ける", () => {
    const selected = flattenTree(input(initialTreeUi, summary("public", "sessions").ref));
    const flags = selected.flatMap((row) => (row.kind === "table" ? [row.selected] : []));
    expect(flags).toEqual([false, true, false]);
  });
});

describe("flattenTree（読み込みの状態）", () => {
  it("読み込み中のスキーマは、その下に読み込み中の行を出す", () => {
    const rows = flattenTree({
      ...input(),
      tables: { [publicSchema]: { status: "loading", requestId: 1, previous: null } },
    });
    expect(rows.map((r) => (r.kind === "status" ? r.status : r.kind))).toEqual([
      "schema",
      "loading",
      "schema",
    ]);
  });

  it("失敗したスキーマは、その下にエラーの行を出す", () => {
    const rows = flattenTree({
      ...input(),
      tables: {
        [publicSchema]: { status: "failed", error: { kind: "internal", message: "boom" } },
      },
    });
    const status = rows.find((r) => r.kind === "status");
    expect(status).toMatchObject({ status: "failed", error: { kind: "internal" } });
  });

  it("テーブルもビューもないスキーマは、空の行を出す", () => {
    const rows = flattenTree({ ...input(), tables: { [publicSchema]: ready([]) } });
    expect(rows.find((r) => r.kind === "status")).toMatchObject({ status: "empty" });
  });

  it("スキーマの一覧がまだなければ行はない", () => {
    expect(flattenTree({ ...input(), schemas: { status: "idle" } })).toEqual([]);
  });
});

describe("flattenTree（開閉の上書き）", () => {
  it("スキーマを閉じると、その下の行は出ない", () => {
    const ui = treeUiReducer(initialTreeUi, {
      type: "toggled",
      key: flattenTree(input())[0]?.key ?? "",
      expanded: false,
    });
    expect(kinds(flattenTree(input(ui)))).toEqual(["schema", "schema"]);
  });

  it("ビューの組を開くとビューが出る", () => {
    const viewGroup = flattenTree(input()).find((r) => r.kind === "group" && r.group === "view");
    const ui = treeUiReducer(initialTreeUi, {
      type: "toggled",
      key: viewGroup?.key ?? "",
      expanded: true,
    });
    expect(names(flattenTree(input(ui)))).toEqual([
      "orders",
      "sessions",
      "users",
      "active_users",
      "recent_orders",
    ]);
  });
});

describe("flattenTree（検索）", () => {
  const searched = (query: string) =>
    flattenTree(input(treeUiReducer(initialTreeUi, { type: "queryChanged", query })));

  it("名前の一部が一致するテーブルとビューだけに絞り、大文字小文字は区別しない", () => {
    expect(names(searched("SESS"))).toEqual(["sessions"]);
    expect(names(searched("order"))).toEqual(["orders", "recent_orders"]);
  });

  it("検索中は、ビューの組も一致があれば開く", () => {
    expect(names(searched("user"))).toEqual(["users", "active_users"]);
  });

  it("組の見出しには、一致した数と全体の数を持たせる", () => {
    const groups = searched("sess").flatMap((row) => (row.kind === "group" ? [row] : []));
    expect(groups.map((g) => [g.group, g.matched, g.total])).toEqual([["table", 1, 3]]);
  });

  it("一致がなかった組は、見出しの代わりに「一致なし」の行を出す", () => {
    const rows = searched("sess");
    expect(rows.find((r) => r.kind === "status")).toMatchObject({
      status: "noMatch",
      group: "view",
    });
  });

  it("一致した文字の範囲を行に持たせる", () => {
    const row = searched("sess").find((r) => r.kind === "table");
    expect(row).toMatchObject({ match: { before: "", match: "sess", after: "ions" } });
  });
});

describe("matchParts", () => {
  it("最初に一致した部分で 3 つに分ける", () => {
    expect(matchParts("user_sessions", "SESS")).toEqual({
      before: "user_",
      match: "sess",
      after: "ions",
    });
  });

  it("検索語が空か一致しなければ、全体を前の部分にする", () => {
    expect(matchParts("users", "")).toEqual({ before: "users", match: "", after: "" });
    expect(matchParts("users", "zzz")).toEqual({ before: "users", match: "", after: "" });
  });
});

describe("treeKeyAction", () => {
  const rows = flattenTree(input());
  const [schemaRow, groupRow, firstTable, secondTable, , viewGroup, otherSchema] = rows;

  it("上下の矢印キーで隣の行に移る", () => {
    expect(treeKeyAction(rows, firstTable?.key ?? null, "ArrowDown")).toEqual({
      focus: secondTable?.key,
    });
    expect(treeKeyAction(rows, firstTable?.key ?? null, "ArrowUp")).toEqual({
      focus: groupRow?.key,
    });
  });

  it("端では動かない", () => {
    expect(treeKeyAction(rows, schemaRow?.key ?? null, "ArrowUp")).toEqual({
      focus: schemaRow?.key,
    });
    expect(treeKeyAction(rows, otherSchema?.key ?? null, "ArrowDown")).toEqual({
      focus: otherSchema?.key,
    });
  });

  it("Home と End で先頭と末尾に移る", () => {
    expect(treeKeyAction(rows, firstTable?.key ?? null, "Home")).toEqual({
      focus: schemaRow?.key,
    });
    expect(treeKeyAction(rows, firstTable?.key ?? null, "End")).toEqual({
      focus: otherSchema?.key,
    });
  });

  it("フォーカスがまだないときは、先頭の行に移る", () => {
    expect(treeKeyAction(rows, null, "ArrowDown")).toEqual({ focus: schemaRow?.key });
  });

  it("右キーは、閉じていれば開き、開いていれば最初の子に移る", () => {
    expect(treeKeyAction(rows, viewGroup?.key ?? null, "ArrowRight")).toEqual({
      toggle: { key: viewGroup?.key, expanded: true },
    });
    expect(treeKeyAction(rows, groupRow?.key ?? null, "ArrowRight")).toEqual({
      focus: firstTable?.key,
    });
  });

  it("左キーは、開いていれば閉じ、閉じていれば（または葉なら）親に移る", () => {
    expect(treeKeyAction(rows, groupRow?.key ?? null, "ArrowLeft")).toEqual({
      toggle: { key: groupRow?.key, expanded: false },
    });
    expect(treeKeyAction(rows, firstTable?.key ?? null, "ArrowLeft")).toEqual({
      focus: groupRow?.key,
    });
    expect(treeKeyAction(rows, viewGroup?.key ?? null, "ArrowLeft")).toEqual({
      focus: schemaRow?.key,
    });
  });

  it("Enter は、テーブルなら選択し、スキーマと組なら開閉する", () => {
    expect(treeKeyAction(rows, firstTable?.key ?? null, "Enter")).toEqual({
      activate: firstTable?.kind === "table" ? firstTable.ref : null,
    });
    expect(treeKeyAction(rows, groupRow?.key ?? null, "Enter")).toEqual({
      toggle: { key: groupRow?.key, expanded: false },
    });
  });

  it("対応しないキーは何もしない", () => {
    expect(treeKeyAction(rows, firstTable?.key ?? null, "x")).toBeNull();
  });
});
