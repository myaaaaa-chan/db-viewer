import { describe, expect, it } from "vitest";
import { cellFromSqliteValue } from "./values";

describe("cellFromSqliteValue", () => {
  it("NULL は null、空文字は空文字のまま区別する", () => {
    expect(cellFromSqliteValue(null, true)).toBeNull();
    expect(cellFromSqliteValue(undefined, true)).toBeNull();
    expect(cellFromSqliteValue("", true)).toBe("");
  });

  it("文字列はそのまま", () => {
    expect(cellFromSqliteValue("あ'\"\n", true)).toBe("あ'\"\n");
  });

  it("INTEGER は BigInt 経由で、2^53 を超えても精度を落とさず 10 進の文字列にする", () => {
    expect(cellFromSqliteValue(9007199254740993n, true)).toBe("9007199254740993");
    expect(cellFromSqliteValue(9223372036854775807n, true)).toBe("9223372036854775807");
    expect(cellFromSqliteValue(-9223372036854775808n, true)).toBe("-9223372036854775808");
  });

  it("BigInt で受け取れている接続では、number は REAL。整数に見える値も REAL と分かる形にする", () => {
    expect(cellFromSqliteValue(3, true)).toBe("3.0");
    expect(cellFromSqliteValue(-2, true)).toBe("-2.0");
    expect(cellFromSqliteValue(0.1, true)).toBe("0.1");
    expect(cellFromSqliteValue(1e21, true)).toBe("1e+21");
  });

  it("BigInt で受け取れない接続では、number が INTEGER かもしれないので変えずに文字列にする", () => {
    expect(cellFromSqliteValue(3, false)).toBe("3");
    expect(cellFromSqliteValue(0.1, false)).toBe("0.1");
  });

  it("BLOB は \\x を先頭に付けた小文字の 16 進", () => {
    expect(cellFromSqliteValue(new Uint8Array([0x0a, 0xff]), true)).toBe("\\x0aff");
    expect(cellFromSqliteValue(new Uint8Array([]), true)).toBe("\\x");
    expect(cellFromSqliteValue(Buffer.from([1, 2]), true)).toBe("\\x0102");
  });
});
