import {
  type ColumnName,
  columnName,
  type Filter,
  type RowsQuery,
  schemaName,
  tableName,
} from "@myaaaaa_chan/db-viewer-core";
import { describe, expect, it } from "vitest";
import { buildCountSql, buildFetchCellSql, buildRowsSql } from "./build";

const cols = (...names: ReadonlyArray<string>): ReadonlyArray<ColumnName> => names.map(columnName);

const query = (overrides: Partial<RowsQuery> = {}): RowsQuery => ({
  table: { schema: schemaName("main"), name: tableName("users") },
  filters: [],
  rawWhere: null,
  sort: null,
  limit: 100,
  offset: 0,
  ...overrides,
});

const filter = {
  eq: (column: string, value: string): Filter => ({ column: columnName(column), op: "eq", value }),
  isNull: (column: string): Filter => ({ column: columnName(column), op: "isNull" }),
};

describe("buildRowsSql / sqlite", () => {
  it("フィルタなしは SELECT ... LIMIT ? OFFSET ?。セルは SQL の中で切り詰める", () => {
    const built = buildRowsSql("sqlite", {
      query: query({ limit: 101, offset: 200 }),
      columns: cols("id", "name"),
      maxCellChars: 10,
    });
    expect(built.text).toBe(
      [
        "SELECT",
        `CASE typeof("id") WHEN 'text' THEN substr("id", 1, 11) WHEN 'blob' THEN '\\x' || lower(hex(substr("id", 1, 6))) ELSE "id" END AS "id",`,
        `CASE typeof("name") WHEN 'text' THEN substr("name", 1, 11) WHEN 'blob' THEN '\\x' || lower(hex(substr("name", 1, 6))) ELSE "name" END AS "name"`,
        `FROM "main"."users"`,
        "LIMIT ? OFFSET ?",
      ].join("\n"),
    );
    expect(built.params).toEqual([101, 200]);
  });

  it("構造化フィルタの値は SQL に埋め込まず、パラメータとして渡す", () => {
    const hostile = "x' OR '1'='1";
    const built = buildRowsSql("sqlite", {
      query: query({ filters: [filter.eq("name", hostile), filter.isNull("deleted_at")] }),
      columns: cols("id"),
      maxCellChars: 5,
    });
    expect(built.text).toContain(`WHERE "name" = ? AND "deleted_at" IS NULL`);
    expect(built.text).not.toContain(hostile);
    expect(built.params).toEqual([hostile, 100, 0]);
  });

  it("演算子ごとに比較の記号が決まる", () => {
    const ops = (["eq", "neq", "lt", "gt", "like"] as const).map(
      (op): Filter => ({ column: columnName("c"), op, value: "v" }),
    );
    const built = buildRowsSql("sqlite", {
      query: query({ filters: ops }),
      columns: cols("c"),
      maxCellChars: 5,
    });
    expect(built.text).toContain(
      `WHERE "c" = ? AND "c" <> ? AND "c" < ? AND "c" > ? AND "c" LIKE ?`,
    );
    expect(built.params).toEqual(["v", "v", "v", "v", "v", 100, 0]);
  });

  it("rawWhere は構造化フィルタの後ろに AND (...) で結合する", () => {
    const built = buildRowsSql("sqlite", {
      query: query({ filters: [filter.eq("a", "1")], rawWhere: "b > 2 OR c = 3" }),
      columns: cols("a"),
      maxCellChars: 5,
    });
    expect(built.text).toContain(`WHERE "a" = ? AND (b > 2 OR c = 3\n)`);
  });

  it("rawWhere だけでも WHERE (...) になる。行コメントで括弧を閉じ損ねない", () => {
    const built = buildRowsSql("sqlite", {
      query: query({ rawWhere: "id = 1 -- 後ろのコメント" }),
      columns: cols("id"),
      maxCellChars: 5,
    });
    expect(built.text).toContain(`WHERE (id = 1 -- 後ろのコメント\n)`);
    expect(built.text).toMatch(/\n\)\nLIMIT \? OFFSET \?$/);
  });

  it.each([null, "", "   \n\t"])("rawWhere が %j なら WHERE を付けない", (rawWhere) => {
    const built = buildRowsSql("sqlite", {
      query: query({ rawWhere }),
      columns: cols("id"),
      maxCellChars: 5,
    });
    expect(built.text).not.toContain("WHERE");
  });

  it("並べ替えは識別子をクォートし、方向は ASC / DESC の固定の語だけを使う", () => {
    const asc = buildRowsSql("sqlite", {
      query: query({ sort: { column: columnName('na"me'), direction: "asc" } }),
      columns: cols("id"),
      maxCellChars: 5,
    });
    expect(asc.text).toContain(`ORDER BY "na""me" ASC\nLIMIT ? OFFSET ?`);
    const desc = buildRowsSql("sqlite", {
      query: query({ sort: { column: columnName("id"), direction: "desc" } }),
      columns: cols("id"),
      maxCellChars: 5,
    });
    expect(desc.text).toContain(`ORDER BY "id" DESC`);
  });

  it("列名・スキーマ・テーブル名にある二重引用符はクォートされる", () => {
    const built = buildRowsSql("sqlite", {
      query: query({ table: { schema: schemaName("main"), name: tableName('t"; DROP') } }),
      columns: cols('c"1'),
      maxCellChars: 5,
    });
    expect(built.text).toContain(`FROM "main"."t""; DROP"`);
    expect(built.text).toContain(`AS "c""1"`);
  });
});

describe("buildRowsSql / postgres", () => {
  it("プレースホルダは $1 からの連番で、SELECT 句の切り詰めは left(col::text, n + 1)", () => {
    const built = buildRowsSql("postgres", {
      query: query({
        table: { schema: schemaName("public"), name: tableName("users") },
        filters: [filter.eq("name", "a"), filter.eq("age", "30")],
        limit: 51,
        offset: 100,
      }),
      columns: cols("id", "name"),
      maxCellChars: 10,
    });
    expect(built.text).toBe(
      [
        "SELECT",
        `left("id"::text, 11) AS "id",`,
        `left("name"::text, 11) AS "name"`,
        `FROM "public"."users"`,
        `WHERE "name" = $1 AND "age" = $2`,
        "LIMIT $3 OFFSET $4",
      ].join("\n"),
    );
    expect(built.params).toEqual(["a", "30", 51, 100]);
  });

  it("LIKE は列を text にキャストする（数値の列にも使えるように）", () => {
    const built = buildRowsSql("postgres", {
      query: query({ filters: [{ column: columnName("age"), op: "like", value: "3%" }] }),
      columns: cols("age"),
      maxCellChars: 5,
    });
    expect(built.text).toContain(`WHERE "age"::text LIKE $1`);
  });

  it("rawWhere と並べ替えがあっても番号は文面の順に振られる", () => {
    const built = buildRowsSql("postgres", {
      query: query({
        filters: [filter.eq("a", "1")],
        rawWhere: "b > 2",
        sort: { column: columnName("a"), direction: "desc" },
        limit: 10,
        offset: 20,
      }),
      columns: cols("a"),
      maxCellChars: 5,
    });
    expect(built.text).toContain(
      `WHERE "a" = $1 AND (b > 2\n)\nORDER BY "a" DESC\nLIMIT $2 OFFSET $3`,
    );
    expect(built.params).toEqual(["1", 10, 20]);
  });
});

describe("buildCountSql", () => {
  it("件数は同じ WHERE を使い、LIMIT・並べ替え・セルの切り詰めは付けない", () => {
    const q = query({ filters: [filter.eq("a", "1")], rawWhere: "b > 2" });
    const sqlite = buildCountSql("sqlite", {
      table: q.table,
      filters: q.filters,
      rawWhere: q.rawWhere,
    });
    expect(sqlite.text).toBe(
      [`SELECT COUNT(*) AS "count"`, `FROM "main"."users"`, `WHERE "a" = ? AND (b > 2\n)`].join(
        "\n",
      ),
    );
    expect(sqlite.params).toEqual(["1"]);
    const pg = buildCountSql("postgres", { table: q.table, filters: q.filters, rawWhere: null });
    expect(pg.text).toBe(
      [`SELECT COUNT(*) AS "count"`, `FROM "main"."users"`, `WHERE "a" = $1`].join("\n"),
    );
  });

  it("条件がなければ WHERE を付けない", () => {
    const sql = buildCountSql("sqlite", { table: query().table, filters: [], rawWhere: null });
    expect(sql.text).toBe([`SELECT COUNT(*) AS "count"`, `FROM "main"."users"`].join("\n"));
    expect(sql.params).toEqual([]);
  });
});

describe("buildFetchCellSql", () => {
  it("主キーの値はパラメータで、1 行に決まらないことを検出できるよう LIMIT 2 を付ける", () => {
    const built = buildFetchCellSql("sqlite", {
      table: query().table,
      primaryKey: { id: "7", tenant: "a" },
      column: columnName("body"),
    });
    expect(built.text).toBe(
      [
        `SELECT "body" AS "body"`,
        `FROM "main"."users"`,
        `WHERE "id" = ? AND "tenant" = ?`,
        "LIMIT 2",
      ].join("\n"),
    );
    expect(built.params).toEqual(["7", "a"]);
  });

  it("PostgreSQL は値全体を text にして取る（切り詰めない）", () => {
    const built = buildFetchCellSql("postgres", {
      table: { schema: schemaName("public"), name: tableName("docs") },
      primaryKey: { id: "7" },
      column: columnName("body"),
    });
    expect(built.text).toBe(
      [`SELECT "body"::text AS "body"`, `FROM "public"."docs"`, `WHERE "id" = $1`, "LIMIT 2"].join(
        "\n",
      ),
    );
    expect(built.text).not.toContain("left(");
  });

  it("主キーの列名にあるクォートは閉じさせない", () => {
    const built = buildFetchCellSql("sqlite", {
      table: query().table,
      primaryKey: { 'id" OR "1"="1': "7" },
      column: columnName("body"),
    });
    expect(built.text).toContain(`WHERE "id"" OR ""1""=""1" = ?`);
  });
});
