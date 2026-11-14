import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS, resolveLimits } from "./limits";

describe("resolveLimits", () => {
  it("指定がなければ設計書の既定値になる", () => {
    expect(resolveLimits()).toEqual({
      maxRows: 1000,
      statementTimeoutMs: 30_000,
      maxCellChars: 10_000,
      maxConcurrentQueries: 2,
    });
    expect(resolveLimits({})).toEqual(DEFAULT_LIMITS);
  });

  it("指定した項目だけを上書きする", () => {
    expect(resolveLimits({ maxRows: 50, maxConcurrentQueries: 1 })).toEqual({
      ...DEFAULT_LIMITS,
      maxRows: 50,
      maxConcurrentQueries: 1,
    });
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "正の整数でない値 %s は設定の誤りとして投げる",
    (value) => {
      expect(() => resolveLimits({ maxRows: value })).toThrow(/maxRows/);
      expect(() => resolveLimits({ statementTimeoutMs: value })).toThrow(/statementTimeoutMs/);
      expect(() => resolveLimits({ maxCellChars: value })).toThrow(/maxCellChars/);
      expect(() => resolveLimits({ maxConcurrentQueries: value })).toThrow(/maxConcurrentQueries/);
    },
  );
});
