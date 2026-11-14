import { columnName, schemaName, tableName } from "@myaaaaa_chan/db-viewer-core";
import { describe, expect, it } from "vitest";
import {
  columnInfoFromRow,
  foreignKeysFromRows,
  indexColumnNames,
  parseIndexItems,
} from "./metadata";

describe("parseIndexItems", () => {
  it("括弧の中を最上位のカンマで区切る。入れ子の括弧と引用符の中のカンマでは区切らない", () => {
    expect(
      parseIndexItems(`CREATE INDEX idx ON t (lower(name), coalesce(a, b), "x,y", 'p,q')`),
    ).toEqual(["lower(name)", "coalesce(a, b)", `"x,y"`, `'p,q'`]);
  });

  it("ASC / DESC と COLLATE は式の一部として含めない", () => {
    expect(
      parseIndexItems(`CREATE UNIQUE INDEX i ON t (lower(a) COLLATE NOCASE DESC, b ASC, c)`),
    ).toEqual(["lower(a)", "b", "c"]);
  });

  it("部分インデックスの WHERE 以降は含めない", () => {
    expect(parseIndexItems(`CREATE INDEX i ON t (a + 1) WHERE b > (1 + 2)`)).toEqual(["a + 1"]);
  });

  it("テーブル名の引用符の中に括弧があっても、列の並びを取り違えない", () => {
    expect(parseIndexItems(`CREATE INDEX i ON "t(1)" (upper(a))`)).toEqual(["upper(a)"]);
  });

  it("SQL がない（自動で作られたインデックスなど）場合は空", () => {
    expect(parseIndexItems(null)).toEqual([]);
  });
});

describe("indexColumnNames", () => {
  it("列の名前があればそれを使い、式（名前が NULL）の位置だけ式の文字列にする", () => {
    expect(indexColumnNames([["id"], [null], ["name"]], ["id", "lower(name)", "name"])).toEqual([
      "id",
      "lower(name)",
      "name",
    ]);
  });

  it("式の文字列を取り出せなかったときは、位置が分かる印にする", () => {
    expect(indexColumnNames([[null]], [])).toEqual(["<expression>"]);
  });
});

describe("columnInfoFromRow", () => {
  it("宣言された型・NOT NULL・既定値・主キーの順番を ColumnInfo にする", () => {
    expect(columnInfoFromRow(["name", "VARCHAR(255)", 1n, "'x'", 0n])).toEqual({
      name: columnName("name"),
      dbType: "VARCHAR(255)",
      nullable: false,
      defaultValue: "'x'",
      primaryKeyPosition: null,
    });
  });

  it("主キーの列は NOT NULL を書いていなくても NULL を許さない扱いにし、複合主キーの順番を持つ", () => {
    expect(columnInfoFromRow(["b", "TEXT", 0n, null, 2n])).toMatchObject({
      nullable: false,
      primaryKeyPosition: 2,
    });
  });

  it("型の宣言がない列は空文字、NULL を許す列は nullable", () => {
    expect(columnInfoFromRow(["c", "", 0n, null, 0n])).toMatchObject({
      dbType: "",
      nullable: true,
    });
  });
});

describe("foreignKeysFromRows", () => {
  const main = schemaName("main");

  it("同じ id の行を 1 つの外部キーにまとめ、列の対応を順に持つ", () => {
    const keys = foreignKeysFromRows(
      "orders",
      [
        [0n, 0n, "customers", "customer_id", "id"],
        [1n, 0n, "items", "a", "x"],
        [1n, 1n, "items", "b", "y"],
      ],
      () => [],
    );
    expect(keys).toEqual([
      {
        name: "orders_customer_id_fkey",
        columns: [columnName("customer_id")],
        references: {
          table: { schema: main, name: tableName("customers") },
          columns: [columnName("id")],
        },
      },
      {
        name: "orders_a_b_fkey",
        columns: [columnName("a"), columnName("b")],
        references: {
          table: { schema: main, name: tableName("items") },
          columns: [columnName("x"), columnName("y")],
        },
      },
    ]);
  });

  it("参照先の列を省略した外部キー（REFERENCES parent）は、参照先の主キーの列にする", () => {
    const keys = foreignKeysFromRows("child", [[0n, 0n, "parent", "pid", null]], (table) =>
      table === "parent" ? ["id"] : [],
    );
    expect(keys[0]?.references.columns).toEqual([columnName("id")]);
  });
});
