import { describe, expect, it } from "vitest";
import { formatInteger } from "./format";

describe("formatInteger", () => {
  it("言語に合わせて桁を区切る", () => {
    expect(formatInteger(1000, "en")).toBe("1,000");
    expect(formatInteger("1234567", "ja")).toBe("1,234,567");
  });

  it("number に収まらない件数も、精度を落とさずに表示する", () => {
    expect(formatInteger("9007199254740993", "en")).toBe("9,007,199,254,740,993");
  });

  it("整数として読めない文字列はそのまま返す", () => {
    expect(formatInteger("many", "en")).toBe("many");
  });
});
