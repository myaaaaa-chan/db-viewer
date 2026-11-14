import { describe, expect, it } from "vitest";
import { resolveRunTarget } from "./run-target";

const sql = "SELECT 1;\nSELECT 2;\n\n-- end";

describe("resolveRunTarget", () => {
  it("選択がなければカーソル位置の 1 文を返す", () => {
    expect(
      resolveRunTarget({ text: sql, selection: { anchor: 12, head: 12 }, dialect: "postgres" }),
    ).toEqual({ from: 10, to: 18, text: "SELECT 2" });
  });

  it("文のない場所では null を返す", () => {
    expect(
      resolveRunTarget({ text: sql, selection: { anchor: 24, head: 24 }, dialect: "postgres" }),
    ).toBeNull();
  });

  it("選択範囲が 1 文なら、その選択範囲を実行する（U6）", () => {
    expect(
      resolveRunTarget({ text: sql, selection: { anchor: 0, head: 9 }, dialect: "postgres" }),
    ).toEqual({ from: 0, to: 8, text: "SELECT 1" });
  });

  it("選択を後ろから前へ作っても同じ範囲になる", () => {
    expect(
      resolveRunTarget({ text: sql, selection: { anchor: 18, head: 10 }, dialect: "postgres" }),
    ).toEqual({ from: 10, to: 18, text: "SELECT 2" });
  });

  it("文の一部だけを選んだ場合は、選んだ部分を 1 文として実行する", () => {
    expect(
      resolveRunTarget({
        text: "SELECT a, b FROM t",
        selection: { anchor: 7, head: 11 },
        dialect: "postgres",
      }),
    ).toEqual({ from: 7, to: 11, text: "a, b" });
  });

  it("選択範囲に複数の文があるときは、選択をそのまま返してサーバーの判定に任せる", () => {
    expect(
      resolveRunTarget({ text: sql, selection: { anchor: 0, head: 19 }, dialect: "postgres" }),
    ).toEqual({ from: 0, to: 19, text: "SELECT 1;\nSELECT 2;" });
  });

  it("空白とコメントだけを選んだときは null を返す", () => {
    expect(
      resolveRunTarget({ text: sql, selection: { anchor: 20, head: 28 }, dialect: "postgres" }),
    ).toBeNull();
  });
});
