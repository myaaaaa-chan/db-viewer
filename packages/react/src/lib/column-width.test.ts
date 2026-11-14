import { describe, expect, it } from "vitest";
import {
  defaultColumnWidth,
  displayLength,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
} from "./column-width";

describe("displayLength", () => {
  it("全角の文字は半角の 2 つぶんに数える", () => {
    expect(displayLength("abc")).toBe(3);
    expect(displayLength("田中")).toBe(4);
  });
});

describe("defaultColumnWidth", () => {
  const column = { name: "id", dbType: "int8" };

  it("短い値の列は最小幅にする", () => {
    expect(defaultColumnWidth(column, ["1", "2"])).toBe(MIN_COLUMN_WIDTH);
  });

  it("長い値の列は幅を広げる", () => {
    const narrow = defaultColumnWidth(column, ["a".repeat(20)]);
    const wide = defaultColumnWidth(column, ["a".repeat(30)]);
    expect(wide).toBeGreaterThan(narrow);
  });

  it("上限を超えては広げない", () => {
    expect(defaultColumnWidth(column, ["a".repeat(500)])).toBe(MAX_COLUMN_WIDTH);
  });

  it("列名と型名が長ければ、値が短くても列名に合わせる", () => {
    const named = { name: "last_login_at_with_a_long_name", dbType: "timestamptz" };
    expect(defaultColumnWidth(named, ["1"])).toBeGreaterThan(MIN_COLUMN_WIDTH);
  });

  it("NULL は NULL という表示の長さで数える", () => {
    expect(defaultColumnWidth(column, [null])).toBe(MIN_COLUMN_WIDTH);
  });
});
