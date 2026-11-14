import { describe, expect, it } from "vitest";
import { bytesToHex, capCells, truncateCell } from "./cells";

describe("truncateCell", () => {
  it("上限ちょうどの長さは切り詰めない", () => {
    expect(truncateCell("abcde", 5)).toEqual({ text: "abcde", truncated: false });
  });

  it("上限を 1 文字でも超えたら先頭から上限の文字数までにする", () => {
    expect(truncateCell("abcdef", 5)).toEqual({ text: "abcde", truncated: true });
  });

  it("文字数は UTF-16 の長さではなくコードポイントで数える（DB の left / substr と同じ）", () => {
    const text = "😀😀😀😀😀😀";
    expect(truncateCell(text, 6)).toEqual({ text, truncated: false });
    expect(truncateCell(text, 4)).toEqual({ text: "😀😀😀😀", truncated: true });
  });

  it("サロゲートペアの途中では切らない", () => {
    expect(truncateCell("a😀b", 2)).toEqual({ text: "a😀", truncated: true });
  });

  it("空文字はそのまま", () => {
    expect(truncateCell("", 3)).toEqual({ text: "", truncated: false });
  });
});

describe("capCells", () => {
  it("切り詰めたセルの位置を [行, 列] で返す", () => {
    const result = capCells(
      [
        ["short", "ab", null],
        ["abcdef", "", "xyz"],
      ],
      3,
    );
    expect(result.rows).toEqual([
      ["sho", "ab", null],
      ["abc", "", "xyz"],
    ]);
    expect(result.truncatedCells).toEqual([
      [0, 0],
      [1, 0],
    ]);
  });

  it("NULL と空文字は切り詰めの対象にならず、区別されたまま残る", () => {
    const result = capCells([[null, ""]], 1);
    expect(result.rows).toEqual([[null, ""]]);
    expect(result.truncatedCells).toEqual([]);
  });
});

describe("bytesToHex", () => {
  it("先頭に \\x を付けた小文字の 16 進にする（PostgreSQL の bytea と同じ形）", () => {
    expect(bytesToHex(new Uint8Array([0x0a, 0xff, 0x00]))).toBe("\\x0aff00");
  });

  it("空のバイト列は \\x だけになる", () => {
    expect(bytesToHex(new Uint8Array([]))).toBe("\\x");
  });
});
