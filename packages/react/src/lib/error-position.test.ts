import { describe, expect, it } from "vitest";
import { errorSpan, lineColumn } from "./error-position";

describe("errorSpan", () => {
  const sql = "SELECT id, emial, display_name\nFROM users";

  it("位置にある識別子の終わりまでを下線にする", () => {
    expect(errorSpan(sql, 11)).toEqual({ from: 11, to: 16 });
  });

  it("引用符付きの識別子や文字列は、閉じる引用符までを下線にする", () => {
    expect(errorSpan('SELECT "no such"', 7)).toEqual({ from: 7, to: 16 });
    expect(errorSpan("SELECT 'a b' x", 7)).toEqual({ from: 7, to: 12 });
  });

  it("語の途中の位置でも、その位置から語の終わりまでにする", () => {
    expect(errorSpan(sql, 13)).toEqual({ from: 13, to: 16 });
  });

  it("記号の位置は 1 文字だけにする", () => {
    expect(errorSpan("SELECT , FROM t", 7)).toEqual({ from: 7, to: 8 });
  });

  it("末尾の位置（入力の終わりでのエラー）は最後の 1 文字を下線にする", () => {
    expect(errorSpan("SELECT", 6)).toEqual({ from: 5, to: 6 });
  });

  it("範囲の外や空の SQL では null を返す", () => {
    expect(errorSpan("SELECT", 7)).toBeNull();
    expect(errorSpan("SELECT", -1)).toBeNull();
    expect(errorSpan("", 0)).toBeNull();
  });
});

describe("lineColumn", () => {
  const sql = "-- 管理者の一覧\nSELECT id, emial\nFROM users";

  it("1 始まりの行と桁を返す", () => {
    expect(lineColumn(sql, 0)).toEqual({ line: 1, column: 1 });
    expect(lineColumn(sql, 21)).toEqual({ line: 2, column: 12 });
    expect(lineColumn(sql, sql.length)).toEqual({ line: 3, column: 11 });
  });
});
