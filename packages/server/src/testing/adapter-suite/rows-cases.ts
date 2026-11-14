import { columnName, type Filter } from "@myaaaaa_chan/db-viewer-core";
import { describe, expect, it } from "vitest";
import { errorOf, refOf, rowsQuery, type SuiteContext, valueOf } from "./context";

const eq = (column: string, value: string): Filter => ({
  column: columnName(column),
  op: "eq",
  value,
});
const idsOf = (rows: ReadonlyArray<ReadonlyArray<string | null>>) => rows.map((row) => row[0]);
const byId = { column: columnName("id"), direction: "asc" } as const;

export const fetchRowsCases = ({ open, limits }: SuiteContext) =>
  describe("fetchRows", () => {
    it("列の名前と型、行は列の並びの配列、値は文字列。NULL と空文字を区別する", async () => {
      const env = await open();
      const result = valueOf(
        await env.adapter.fetchRows(rowsQuery(env, "users", { sort: byId }), limits()),
      );
      expect(result.columns.map((c) => c.name)).toEqual(["id", "name", "email", "age", "status"]);
      expect(result.columns[0]?.dbType?.toLowerCase()).toBe("integer");
      expect(result.rows).toEqual([
        ["1", "alice", "alice@example.com", "30", "active"],
        ["2", "bob", null, null, "inactive"],
        ["3", "carol", "", "41", "active"],
      ]);
      expect(result.truncated).toBe(false);
      expect(result.truncatedCells).toEqual([]);
    });

    it.each([
      ["eq", [eq("status", "active")], ["1", "3"]],
      ["neq", [{ column: columnName("status"), op: "neq", value: "active" }], ["2"]],
      ["lt（NULL は含まれない）", [{ column: columnName("age"), op: "lt", value: "35" }], ["1"]],
      ["gt", [{ column: columnName("age"), op: "gt", value: "30" }], ["3"]],
      ["like", [{ column: columnName("name"), op: "like", value: "a%" }], ["1"]],
      [
        "like（数値の列にも使える）",
        [{ column: columnName("age"), op: "like", value: "3%" }],
        ["1"],
      ],
      ["isNull", [{ column: columnName("email"), op: "isNull" }], ["2"]],
      [
        "複数は AND",
        [eq("status", "active"), { column: columnName("age"), op: "gt", value: "30" }],
        ["3"],
      ],
    ] as const)("構造化フィルタ %s", async (_name, filters, expectedIds) => {
      const env = await open();
      const result = valueOf(
        await env.adapter.fetchRows(
          rowsQuery(env, "users", { filters: [...filters], sort: byId }),
          limits(),
        ),
      );
      expect(idsOf(result.rows)).toEqual(expectedIds);
    });

    it("フィルタの値は SQL として解釈されない", async () => {
      const env = await open();
      const hostile = eq("name", "x' OR '1'='1");
      const result = valueOf(
        await env.adapter.fetchRows(rowsQuery(env, "users", { filters: [hostile] }), limits()),
      );
      expect(result.rows).toEqual([]);
    });

    it("rawWhere は構造化フィルタと AND で結合される。行コメントで終わっても動く", async () => {
      const env = await open();
      const both = valueOf(
        await env.adapter.fetchRows(
          rowsQuery(env, "users", {
            filters: [eq("status", "active")],
            rawWhere: "age > 30 -- 40 以上ではなく 30 より大きい",
            sort: byId,
          }),
          limits(),
        ),
      );
      expect(idsOf(both.rows)).toEqual(["3"]);
      const rawOnly = valueOf(
        await env.adapter.fetchRows(
          rowsQuery(env, "users", { rawWhere: "id = 1 OR id = 2", sort: byId }),
          limits(),
        ),
      );
      expect(idsOf(rawOnly.rows)).toEqual(["1", "2"]);
    });

    it("rawWhere に文を足して書き込ませようとしても、複数の文として拒否される", async () => {
      const env = await open({ readOnly: false });
      const result = await env.adapter.fetchRows(
        rowsQuery(env, "users", { rawWhere: "1 = 1); DELETE FROM users; --" }),
        limits(),
      );
      expect(errorOf(result)).toEqual({ kind: "multipleStatements" });
      const after = valueOf(await env.adapter.fetchRows(rowsQuery(env, "users"), limits()));
      expect(after.rows).toHaveLength(3);
    });

    it("rawWhere の構文エラーは query エラー", async () => {
      const env = await open();
      const result = await env.adapter.fetchRows(
        rowsQuery(env, "users", { rawWhere: "age >>> 1" }),
        limits(),
      );
      expect(errorOf(result).kind).toBe("query");
    });

    it("並べ替えとページング", async () => {
      const env = await open();
      const desc = valueOf(
        await env.adapter.fetchRows(
          rowsQuery(env, "users", { sort: { column: columnName("id"), direction: "desc" } }),
          limits(),
        ),
      );
      expect(idsOf(desc.rows)).toEqual(["3", "2", "1"]);
      const page = valueOf(
        await env.adapter.fetchRows(
          rowsQuery(env, "users", { sort: byId, limit: 2, offset: 1 }),
          limits(),
        ),
      );
      expect(idsOf(page.rows)).toEqual(["2", "3"]);
      expect(page.truncated).toBe(false);
    });

    it("truncated は、返さなかった行がまだある場合だけ true。上限は min(limit, maxRows)", async () => {
      const env = await open();
      const fetch = async (limit: number, maxRows: number) =>
        valueOf(
          await env.adapter.fetchRows(
            rowsQuery(env, "many", { sort: byId, limit }),
            limits({ maxRows }),
          ),
        );

      const clamped = await fetch(100, 10);
      expect(clamped.rows).toHaveLength(10);
      expect(clamped.truncated).toBe(true);

      const exactlyAll = await fetch(25, 25);
      expect(exactlyAll.rows).toHaveLength(25);
      expect(exactlyAll.truncated).toBe(false);

      const justShort = await fetch(25, 24);
      expect(justShort.rows).toHaveLength(24);
      expect(justShort.truncated).toBe(true);

      const smallPage = await fetch(5, 100);
      expect(smallPage.rows).toHaveLength(5);
      expect(smallPage.truncated).toBe(true);
    });

    it("maxCellChars を超えたセルを切り詰め、位置を truncatedCells に入れる（コードポイントで数える）", async () => {
      const env = await open();
      const result = valueOf(
        await env.adapter.fetchRows(
          rowsQuery(env, "docs", { sort: byId }),
          limits({ maxCellChars: 10 }),
        ),
      );
      expect(result.rows.map((row) => row[1])).toEqual([
        "abcdefghij",
        "abcdefghij",
        "あいうえおかきくけこ",
        "😀😀😀😀😀😀",
        "",
        null,
      ]);
      expect(result.truncatedCells).toEqual([
        [0, 1],
        [2, 1],
      ]);

      const emoji = valueOf(
        await env.adapter.fetchRows(
          rowsQuery(env, "docs", { filters: [eq("id", "4")] }),
          limits({ maxCellChars: 3 }),
        ),
      );
      expect(emoji.rows).toEqual([["4", "😀😀😀"]]);
      expect(emoji.truncatedCells).toEqual([[0, 1]]);
    });

    it("bigint は精度を落とさず 10 進の文字列で返す", async () => {
      const env = await open();
      const result = valueOf(
        await env.adapter.fetchRows(rowsQuery(env, "numbers", { sort: byId }), limits()),
      );
      expect(result.rows).toEqual([
        ["1", "9007199254740993"],
        ["2", "9223372036854775807"],
        ["3", "-9007199254740993"],
      ]);
    });

    it("バイナリは \\x の 16 進。切り詰めの規則は文字列と同じ", async () => {
      const env = await open();
      const full = valueOf(
        await env.adapter.fetchRows(rowsQuery(env, "blobs", { sort: byId }), limits()),
      );
      expect(full.rows.map((row) => row[1])).toEqual(["\\x0aff112233", "\\x", null]);

      const cut = valueOf(
        await env.adapter.fetchRows(
          rowsQuery(env, "blobs", { sort: byId }),
          limits({ maxCellChars: 6 }),
        ),
      );
      expect(cut.rows.map((row) => row[1])).toEqual(["\\x0aff", "\\x", null]);
      expect(cut.truncatedCells).toEqual([[0, 1]]);
    });

    it("引用符を含むテーブル名・列名でも動く（識別子は必ずクォートされる）", async () => {
      const env = await open();
      const result = valueOf(
        await env.adapter.fetchRows(
          rowsQuery(env, 'odd"table', {
            filters: [{ column: columnName('col"x'), op: "eq", value: "1" }],
            sort: { column: columnName("select"), direction: "asc" },
          }),
          limits(),
        ),
      );
      expect(result.columns.map((c) => c.name)).toEqual(['col"x', "select"]);
      expect(result.rows).toEqual([["1", "v"]]);
    });

    it("存在しないテーブルは tableNotFound", async () => {
      const env = await open();
      const result = await env.adapter.fetchRows(rowsQuery(env, "no_such_table"), limits());
      expect(errorOf(result)).toEqual({
        kind: "tableNotFound",
        table: refOf(env, "no_such_table"),
      });
    });

    it("存在しない列を、フィルタや並べ替えに使うと query エラー（列がなければ文字列として扱う DB でも）", async () => {
      const env = await open();
      const badFilter = await env.adapter.fetchRows(
        rowsQuery(env, "users", { filters: [eq("no_such_column", "x")] }),
        limits(),
      );
      expect(errorOf(badFilter).kind).toBe("query");
      const badSort = await env.adapter.fetchRows(
        rowsQuery(env, "users", {
          sort: { column: columnName("no_such_column"), direction: "asc" },
        }),
        limits(),
      );
      expect(errorOf(badSort).kind).toBe("query");
    });
  });

export const countRowsCases = ({ open, limits }: SuiteContext) =>
  describe("countRows", () => {
    it("件数を文字列で返す。構造化フィルタと rawWhere の両方を適用する", async () => {
      const env = await open();
      const count = async (
        filters: ReadonlyArray<Filter>,
        rawWhere: string | null,
        table = "users",
      ) => valueOf(await env.adapter.countRows(refOf(env, table), filters, rawWhere, limits()));

      expect(await count([], null)).toEqual({ count: "3" });
      expect(await count([eq("status", "active")], null)).toEqual({ count: "2" });
      expect(await count([], "age > 30")).toEqual({ count: "1" });
      expect(await count([eq("status", "active")], "age > 30")).toEqual({ count: "1" });
      expect(await count([], null, "many")).toEqual({ count: "25" });
    });

    it("存在しない列でフィルタすると query エラー", async () => {
      const env = await open();
      const result = await env.adapter.countRows(
        refOf(env, "users"),
        [eq("no_such_column", "x")],
        null,
        limits(),
      );
      expect(errorOf(result).kind).toBe("query");
    });

    it("存在しないテーブルは tableNotFound、複数の文は multipleStatements", async () => {
      const env = await open({ readOnly: false });
      const missing = await env.adapter.countRows(refOf(env, "no_such_table"), [], null, limits());
      expect(errorOf(missing).kind).toBe("tableNotFound");
      const injected = await env.adapter.countRows(
        refOf(env, "users"),
        [],
        "1 = 1); DELETE FROM users; --",
        limits(),
      );
      expect(errorOf(injected)).toEqual({ kind: "multipleStatements" });
    });
  });

export const fetchCellCases = ({ open, limits }: SuiteContext) =>
  describe("fetchCell", () => {
    const cell = async (
      env: Awaited<ReturnType<SuiteContext["open"]>>,
      table: string,
      primaryKey: Record<string, string>,
      column: string,
      overrides = {},
    ) =>
      env.adapter.fetchCell(refOf(env, table), primaryKey, columnName(column), limits(overrides));

    it("fetchRows で切り詰められる値も、全体を返す", async () => {
      const env = await open();
      const small = { maxCellChars: 10 };
      expect(valueOf(await cell(env, "docs", { id: "1" }, "body", small))).toEqual({
        value: "abcdefghijKLMNOP",
      });
      expect(valueOf(await cell(env, "blobs", { id: "1" }, "data", { maxCellChars: 6 }))).toEqual({
        value: "\\x0aff112233",
      });
    });

    it("NULL と空文字を区別し、bigint の精度を落とさない", async () => {
      const env = await open();
      expect(valueOf(await cell(env, "docs", { id: "6" }, "body"))).toEqual({ value: null });
      expect(valueOf(await cell(env, "docs", { id: "5" }, "body"))).toEqual({ value: "" });
      expect(valueOf(await cell(env, "numbers", { id: "2" }, "big"))).toEqual({
        value: "9223372036854775807",
      });
    });

    it("複合主キーで 1 行を決める", async () => {
      const env = await open();
      expect(valueOf(await cell(env, "composite", { a: "1", b: "y" }, "label"))).toEqual({
        value: "one-y",
      });
    });

    it("主キーで 1 行に決まらない（0 行・2 行以上・主キーが空）場合は query エラー", async () => {
      const env = await open();
      expect(errorOf(await cell(env, "docs", { id: "999" }, "body")).kind).toBe("query");
      expect(errorOf(await cell(env, "no_pk", { v: "a" }, "v")).kind).toBe("query");
      expect(errorOf(await cell(env, "docs", {}, "body")).kind).toBe("query");
    });

    it("主キーが空なら、表に 1 行しかなくても query エラー（条件なしで読まない）", async () => {
      const env = await open();
      await env.exec("CREATE TABLE one_row (v TEXT)");
      await env.exec("INSERT INTO one_row (v) VALUES ('only')");
      expect(errorOf(await cell(env, "one_row", {}, "v")).kind).toBe("query");
    });

    it("主キーの値は SQL として解釈されない。存在しない列・テーブルは失敗にする", async () => {
      const env = await open();
      expect(errorOf(await cell(env, "docs", { id: "1 OR 1 = 1" }, "body")).kind).toBe("query");
      expect(errorOf(await cell(env, "docs", { id: "1" }, "no_such_column")).kind).toBe("query");
      expect(errorOf(await cell(env, "docs", { no_such_column: "1" }, "body")).kind).toBe("query");
      expect(errorOf(await cell(env, "no_such_table", { id: "1" }, "body")).kind).toBe(
        "tableNotFound",
      );
    });
  });
