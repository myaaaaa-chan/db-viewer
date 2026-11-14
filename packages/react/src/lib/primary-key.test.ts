import {
  type ColumnInfo,
  columnName,
  type ResultSet,
  schemaName,
  type TableDetail,
  tableName,
} from "@myaaaaa_chan/db-viewer-core";
import { describe, expect, it } from "vitest";
import { primaryKeyOf } from "./primary-key";

const column = (name: string, primaryKeyPosition: number | null): ColumnInfo => ({
  name: columnName(name),
  dbType: "text",
  nullable: primaryKeyPosition === null,
  defaultValue: null,
  primaryKeyPosition,
});

const detail = (columns: ReadonlyArray<ColumnInfo>): TableDetail => ({
  summary: { ref: { schema: schemaName("public"), name: tableName("t") }, kind: "table" },
  columns,
  indexes: [],
  foreignKeys: [],
  ddl: { text: "", approximate: false },
});

const result = (
  names: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string | null>>,
  truncatedCells: ResultSet["truncatedCells"] = [],
): ResultSet => ({
  columns: names.map((name) => ({ name, dbType: null })),
  rows,
  truncated: false,
  truncatedCells,
});

describe("primaryKeyOf", () => {
  it("主キーの列の値を、列名をキーにして返す", () => {
    const d = detail([column("id", 1), column("name", null)]);
    expect(primaryKeyOf(d, result(["name", "id"], [["a", "7"]]), 0)).toEqual({ id: "7" });
  });

  it("複合主キーはすべての列を返す", () => {
    const d = detail([column("a", 2), column("b", 1), column("c", null)]);
    expect(primaryKeyOf(d, result(["a", "b", "c"], [["1", "2", "3"]]), 0)).toEqual({
      a: "1",
      b: "2",
    });
  });

  it("主キーがなければ null を返す", () => {
    const d = detail([column("a", null)]);
    expect(primaryKeyOf(d, result(["a"], [["1"]]), 0)).toBeNull();
  });

  it("結果に主キーの列がなければ null を返す", () => {
    const d = detail([column("id", 1), column("name", null)]);
    expect(primaryKeyOf(d, result(["name"], [["a"]]), 0)).toBeNull();
  });

  it("主キーの値が切り詰められているときは、行を特定できないので null を返す", () => {
    const d = detail([column("id", 1)]);
    expect(primaryKeyOf(d, result(["id"], [["abc"]], [[0, 0]]), 0)).toBeNull();
  });

  it("存在しない行では null を返す", () => {
    const d = detail([column("id", 1)]);
    expect(primaryKeyOf(d, result(["id"], [["1"]]), 3)).toBeNull();
  });
});
