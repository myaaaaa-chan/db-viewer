import { describe, expect, it } from "vitest";
import { toTsv } from "./tsv";

describe("toTsv", () => {
  it("タブで列を、改行で行を区切る", () => {
    expect(
      toTsv([
        ["1", "a"],
        ["2", "b"],
      ]),
    ).toBe("1\ta\n2\tb");
  });

  it("NULL は空文字にし、列名は含めない（U5）", () => {
    expect(toTsv([["1", null, "x"]])).toBe("1\t\tx");
  });

  it("タブ・改行・引用符を含む値は引用符で囲み、中の引用符は 2 つ重ねる", () => {
    expect(toTsv([["a\tb"]])).toBe('"a\tb"');
    expect(toTsv([["a\nb"]])).toBe('"a\nb"');
    expect(toTsv([["a\rb"]])).toBe('"a\rb"');
    expect(toTsv([['say "hi"']])).toBe('"say ""hi"""');
  });

  it("引用符で囲むのは必要な値だけにする", () => {
    expect(toTsv([["plain", "with space", "日本語"]])).toBe("plain\twith space\t日本語");
  });

  it("行がなければ空文字を返す", () => {
    expect(toTsv([])).toBe("");
  });
});
