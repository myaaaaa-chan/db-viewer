import {
  type ColumnInfo,
  columnName,
  type ResultSet,
  schemaName,
  type TableDetail,
  tableName,
} from "@myaaaaa_chan/db-viewer-core";
import { describe, expect, it } from "vitest";
import { describeActiveCell, describePrimaryKey } from "./active-cell";

const column = (name: string, primaryKeyPosition: number | null): ColumnInfo => ({
  name: columnName(name),
  dbType: "text",
  nullable: true,
  defaultValue: null,
  primaryKeyPosition,
});

const detail: TableDetail = {
  summary: { ref: { schema: schemaName("public"), name: tableName("users") }, kind: "table" },
  columns: [column("id", 1), column("profile", null)],
  indexes: [],
  foreignKeys: [],
  ddl: { text: "", approximate: false },
};

const result: ResultSet = {
  columns: [
    { name: "id", dbType: "int8" },
    { name: "profile", dbType: "jsonb" },
  ],
  rows: [
    ["1", "{}"],
    ["4", '{"bio": "long…'],
  ],
  truncated: false,
  truncatedCells: [[1, 1]],
};

describe("describeActiveCell", () => {
  it("列名・型・値・切り詰めの有無を返す", () => {
    expect(describeActiveCell(result, { row: 1, col: 1 }, detail)).toEqual({
      columnName: "profile",
      dbType: "jsonb",
      value: '{"bio": "long…',
      truncated: true,
      primaryKey: { id: "4" },
    });
  });

  it("切り詰めていないセルは truncated を false にする", () => {
    expect(describeActiveCell(result, { row: 0, col: 1 }, detail)).toMatchObject({
      value: "{}",
      truncated: false,
    });
  });

  it("テーブルの詳細がまだなければ、主キーは分からないので null にする", () => {
    expect(describeActiveCell(result, { row: 1, col: 1 }, null)?.primaryKey).toBeNull();
  });

  it("範囲外のセルは null を返す", () => {
    expect(describeActiveCell(result, { row: 9, col: 0 }, detail)).toBeNull();
    expect(describeActiveCell(result, { row: 0, col: 9 }, detail)).toBeNull();
  });
});

describe("describePrimaryKey", () => {
  it("列名と値を「id = 4」の形で並べる", () => {
    expect(describePrimaryKey({ id: "4" })).toBe("id = 4");
    expect(describePrimaryKey({ a: "1", b: "x" })).toBe("a = 1, b = x");
  });

  it("主キーがなければ null を返す", () => {
    expect(describePrimaryKey(null)).toBeNull();
  });
});
