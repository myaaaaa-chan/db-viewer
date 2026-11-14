import {
  columnName,
  err,
  type Filter,
  ok,
  type ResultSet,
  schemaName,
  tableName,
} from "@myaaaaa_chan/db-viewer-core";
import { describe, expect, it } from "vitest";
import {
  initialTableViewState,
  nextSort,
  PAGE_SIZE,
  rowsQueryOf,
  type TableViewAction,
  type TableViewState,
  tableViewReducer,
} from "./table-view";

const table = { schema: schemaName("public"), name: tableName("users") };
const col = columnName;
const eqRole: Filter = { column: col("role"), op: "eq", value: "member" };
const resultSet = (ids: ReadonlyArray<string>): ResultSet => ({
  columns: [{ name: "id", dbType: "int8" }],
  rows: ids.map((id) => [id]),
  truncated: false,
  truncatedCells: [],
});

const run = (actions: ReadonlyArray<TableViewAction>, from = initialTableViewState) =>
  actions.reduce(tableViewReducer, from);

const loaded = (): TableViewState =>
  run([
    { type: "rowsRequested", requestId: 1 },
    { type: "rowsLoaded", requestId: 1, result: ok(resultSet(["1", "2"])) },
  ]);

describe("nextSort", () => {
  it("同じ列を押すたびに 昇順 → 降順 → なし と切り替える", () => {
    const asc = nextSort(null, col("id"));
    expect(asc).toEqual({ column: "id", direction: "asc" });
    const desc = nextSort(asc, col("id"));
    expect(desc).toEqual({ column: "id", direction: "desc" });
    expect(nextSort(desc, col("id"))).toBeNull();
  });

  it("別の列を押したら、その列の昇順から始める（並べ替えは 1 列だけ）", () => {
    expect(nextSort({ column: col("id"), direction: "desc" }, col("email"))).toEqual({
      column: "email",
      direction: "asc",
    });
  });
});

describe("rowsQueryOf", () => {
  it("1 ページ 100 件で、ページ番号から offset を決める（U1）", () => {
    expect(PAGE_SIZE).toBe(100);
    const state = run([
      { type: "pageMoved", delta: 1 },
      { type: "pageMoved", delta: 1 },
    ]);
    expect(rowsQueryOf(table, state)).toEqual({
      table,
      filters: [],
      rawWhere: null,
      sort: null,
      limit: 100,
      offset: 200,
    });
  });

  it("適用中のフィルタ・WHERE・並べ替えを含める", () => {
    const state = run([
      { type: "filterAdded", filter: eqRole },
      { type: "rawWhereApplied", text: "id > 3" },
      { type: "sortToggled", column: col("id") },
    ]);
    expect(rowsQueryOf(table, state)).toMatchObject({
      filters: [eqRole],
      rawWhere: "id > 3",
      sort: { column: "id", direction: "asc" },
      offset: 0,
    });
  });
});

describe("フィルタと並べ替え", () => {
  it("条件を変えたら 1 ページ目に戻り、件数と選択中のセルを捨てる", () => {
    const base = run(
      [
        { type: "pageMoved", delta: 1 },
        { type: "countRequested", requestId: 1 },
        { type: "countLoaded", requestId: 1, result: ok({ count: "250" }) },
        { type: "activeCellChanged", pos: { row: 1, col: 0 } },
      ],
      loaded(),
    );
    expect(base.page).toBe(1);
    expect(base.count).toEqual({ status: "ready", value: "250" });

    const filtered = tableViewReducer(base, { type: "filterAdded", filter: eqRole });
    expect(filtered.page).toBe(0);
    expect(filtered.count).toEqual({ status: "idle" });
    expect(filtered.active).toBeNull();
    expect(filtered.filters).toEqual([eqRole]);
  });

  it("WHERE を適用・解除しても同じ扱いにする。空白だけなら解除する", () => {
    const applied = tableViewReducer(initialTableViewState, {
      type: "rawWhereApplied",
      text: "  id > 3  ",
    });
    expect(applied.rawWhere).toBe("id > 3");
    expect(tableViewReducer(applied, { type: "rawWhereApplied", text: "   " }).rawWhere).toBeNull();
  });

  it("条件を取り除くと、指定した位置の条件だけが消える", () => {
    const other: Filter = { column: col("deleted_at"), op: "isNull" };
    const state = run([
      { type: "filterAdded", filter: eqRole },
      { type: "filterAdded", filter: other },
      { type: "filterRemoved", index: 0 },
    ]);
    expect(state.filters).toEqual([other]);
  });

  it("並べ替えは件数を捨てない（件数は条件だけで決まる）", () => {
    const withCount = run(
      [
        { type: "countRequested", requestId: 1 },
        { type: "countLoaded", requestId: 1, result: ok({ count: "9" }) },
      ],
      loaded(),
    );
    const sorted = tableViewReducer(withCount, { type: "sortToggled", column: col("id") });
    expect(sorted.count).toEqual({ status: "ready", value: "9" });
    expect(sorted.page).toBe(0);
  });
});

describe("ページ送り", () => {
  it("前へは 1 ページ目より前には戻らない", () => {
    expect(tableViewReducer(initialTableViewState, { type: "pageMoved", delta: -1 }).page).toBe(0);
  });

  it("ページを移ると選択中のセルを捨てる", () => {
    const state = run(
      [
        { type: "activeCellChanged", pos: { row: 0, col: 0 } },
        { type: "pageMoved", delta: 1 },
      ],
      loaded(),
    );
    expect(state.active).toBeNull();
  });
});

describe("行の取得", () => {
  it("応答が届くまでは、直前の行を持ち続ける", () => {
    const next = tableViewReducer(loaded(), { type: "rowsRequested", requestId: 2 });
    expect(next.rows).toEqual({
      status: "loading",
      requestId: 2,
      previous: resultSet(["1", "2"]),
    });
  });

  it("古い応答は捨てる", () => {
    const state = run(
      [
        { type: "rowsRequested", requestId: 2 },
        { type: "rowsLoaded", requestId: 1, result: ok(resultSet(["old"])) },
      ],
      loaded(),
    );
    expect(state.rows.status).toBe("loading");
  });

  it("失敗はエラーとして持つ", () => {
    const state = run([
      { type: "rowsRequested", requestId: 1 },
      { type: "rowsLoaded", requestId: 1, result: err({ kind: "unauthorized" }) },
    ]);
    expect(state.rows).toEqual({ status: "failed", error: { kind: "unauthorized" } });
  });
});

describe("件数", () => {
  it("取得を要求した後に、応答の件数を持つ", () => {
    const state = run([
      { type: "countRequested", requestId: 1 },
      { type: "countLoaded", requestId: 1, result: ok({ count: "1234" }) },
    ]);
    expect(state.count).toEqual({ status: "ready", value: "1234" });
  });

  it("条件を変えた後に届いた古い件数は捨てる", () => {
    const state = run([
      { type: "countRequested", requestId: 1 },
      { type: "filterAdded", filter: eqRole },
      { type: "countLoaded", requestId: 1, result: ok({ count: "1234" }) },
    ]);
    expect(state.count).toEqual({ status: "idle" });
  });
});

describe("セルの詳細と全体の取得", () => {
  it("選択中のセルを変えたら、取得済みの全体の値を捨てる", () => {
    const state = run(
      [
        { type: "activeCellChanged", pos: { row: 0, col: 0 } },
        { type: "fullCellRequested", requestId: 1 },
        { type: "fullCellLoaded", requestId: 1, result: ok({ value: "full" }) },
        { type: "activeCellChanged", pos: { row: 1, col: 0 } },
      ],
      loaded(),
    );
    expect(state.fullCell).toEqual({ status: "idle" });
  });

  it("全体の値を取得できたら持つ", () => {
    const state = run(
      [
        { type: "activeCellChanged", pos: { row: 0, col: 0 } },
        { type: "fullCellRequested", requestId: 1 },
        { type: "fullCellLoaded", requestId: 1, result: ok({ value: "full text" }) },
      ],
      loaded(),
    );
    expect(state.fullCell).toEqual({ status: "ready", value: "full text" });
  });

  it("別のセルを選んだ後に届いた応答は捨てる", () => {
    const state = run(
      [
        { type: "activeCellChanged", pos: { row: 0, col: 0 } },
        { type: "fullCellRequested", requestId: 1 },
        { type: "activeCellChanged", pos: { row: 1, col: 0 } },
        { type: "fullCellLoaded", requestId: 1, result: ok({ value: "stale" }) },
      ],
      loaded(),
    );
    expect(state.fullCell).toEqual({ status: "idle" });
  });

  it("同じセルを選び直しても、取得済みの値は捨てない", () => {
    const state = run(
      [
        { type: "activeCellChanged", pos: { row: 0, col: 0 } },
        { type: "fullCellRequested", requestId: 1 },
        { type: "fullCellLoaded", requestId: 1, result: ok({ value: "full" }) },
        { type: "activeCellChanged", pos: { row: 0, col: 0 } },
      ],
      loaded(),
    );
    expect(state.fullCell.status).toBe("ready");
  });
});

describe("テーブルの詳細と表示タブ", () => {
  it("最初は「データ表」のタブを開く", () => {
    expect(initialTableViewState.tab).toBe("rows");
  });

  it("タブを切り替えても、フィルタとページは保つ", () => {
    const state = run([
      { type: "filterAdded", filter: eqRole },
      { type: "tabChanged", tab: "ddl" },
      { type: "tabChanged", tab: "rows" },
    ]);
    expect(state.filters).toEqual([eqRole]);
    expect(state.tab).toBe("rows");
  });
});
