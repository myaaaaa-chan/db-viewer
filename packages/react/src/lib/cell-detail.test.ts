import { describe, expect, it } from "vitest";
import { formatCellDetail } from "./cell-detail";

describe("formatCellDetail", () => {
  it("NULL は null として区別する", () => {
    expect(formatCellDetail(null, "text")).toEqual({ kind: "null" });
  });

  it("空文字は NULL ではなく空の文字列にする", () => {
    expect(formatCellDetail("", "text")).toEqual({ kind: "text", text: "" });
  });

  it("json と jsonb は整形する", () => {
    expect(formatCellDetail('{"a":1,"b":[1,2]}', "jsonb")).toEqual({
      kind: "text",
      text: '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}',
    });
    expect(formatCellDetail("[1]", "JSON")).toEqual({ kind: "text", text: "[\n  1\n]" });
  });

  it("json として読めない値（切り詰めた値など）はそのまま表示する", () => {
    expect(formatCellDetail('{"bio": "abc', "jsonb")).toEqual({
      kind: "text",
      text: '{"bio": "abc',
    });
  });

  it("json 以外の型は整形しない", () => {
    expect(formatCellDetail('{"a":1}', "text")).toEqual({ kind: "text", text: '{"a":1}' });
    expect(formatCellDetail('{"a":1}', null)).toEqual({ kind: "text", text: '{"a":1}' });
  });
});
