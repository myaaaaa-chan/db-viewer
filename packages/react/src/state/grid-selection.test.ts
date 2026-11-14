import { describe, expect, it } from "vitest";
import {
  type CellPos,
  type GridBounds,
  type GridSelection,
  gridSelectionReducer,
  isInRange,
  rangeOf,
  rangeSize,
  sliceRange,
} from "./grid-selection";

const bounds: GridBounds = { rows: 5, cols: 4 };
const at = (row: number, col: number): CellPos => ({ row, col });
const sel = (anchor: CellPos, focus: CellPos = anchor): GridSelection => ({ anchor, focus });

describe("rangeOf", () => {
  it("anchor と focus がどの向きでも、左上と右下を持つ矩形にする", () => {
    expect(rangeOf(sel(at(3, 2), at(1, 0)))).toEqual({ top: 1, left: 0, bottom: 3, right: 2 });
    expect(rangeOf(sel(at(1, 0), at(3, 2)))).toEqual({ top: 1, left: 0, bottom: 3, right: 2 });
  });

  it("範囲の大きさを数える", () => {
    expect(rangeSize(rangeOf(sel(at(1, 3), at(3, 1))))).toEqual({ rows: 3, cols: 3 });
    expect(rangeSize(rangeOf(sel(at(2, 2))))).toEqual({ rows: 1, cols: 1 });
  });

  it("矩形に入るセルだけを true にする", () => {
    const range = rangeOf(sel(at(1, 1), at(2, 2)));
    expect(isInRange(range, 1, 1)).toBe(true);
    expect(isInRange(range, 2, 2)).toBe(true);
    expect(isInRange(range, 0, 1)).toBe(false);
    expect(isInRange(range, 1, 3)).toBe(false);
  });
});

describe("sliceRange", () => {
  it("矩形に入る値だけを行ごとに取り出す", () => {
    const rows = [
      ["a", "b", "c"],
      ["d", null, "f"],
      ["g", "h", "i"],
    ];
    expect(sliceRange(rows, { top: 0, left: 1, bottom: 1, right: 2 })).toEqual([
      ["b", "c"],
      [null, "f"],
    ]);
  });
});

describe("gridSelectionReducer", () => {
  it("クリックで 1 セルを選ぶ", () => {
    expect(gridSelectionReducer(null, { type: "pressed", pos: at(2, 1), extend: false })).toEqual(
      sel(at(2, 1)),
    );
  });

  it("Shift+クリックは anchor を残して focus だけを動かす", () => {
    const next = gridSelectionReducer(sel(at(1, 1)), {
      type: "pressed",
      pos: at(3, 3),
      extend: true,
    });
    expect(next).toEqual(sel(at(1, 1), at(3, 3)));
  });

  it("選択がないときの Shift+クリックは、そのセルだけを選ぶ", () => {
    expect(gridSelectionReducer(null, { type: "pressed", pos: at(2, 2), extend: true })).toEqual(
      sel(at(2, 2)),
    );
  });

  it("ドラッグで focus だけを動かす", () => {
    expect(gridSelectionReducer(sel(at(0, 0)), { type: "dragged", pos: at(2, 3) })).toEqual(
      sel(at(0, 0), at(2, 3)),
    );
  });

  it("矢印キーで anchor ごと動かし、範囲を 1 セルに戻す", () => {
    const next = gridSelectionReducer(sel(at(1, 1), at(3, 3)), {
      type: "moved",
      dRow: 1,
      dCol: 0,
      extend: false,
      bounds,
    });
    expect(next).toEqual(sel(at(4, 3)));
  });

  it("Shift+矢印キーで focus だけを動かす", () => {
    const next = gridSelectionReducer(sel(at(1, 1)), {
      type: "moved",
      dRow: 0,
      dCol: 1,
      extend: true,
      bounds,
    });
    expect(next).toEqual(sel(at(1, 1), at(1, 2)));
  });

  it("端を越えては動かない", () => {
    const next = gridSelectionReducer(sel(at(0, 0)), {
      type: "moved",
      dRow: -1,
      dCol: -1,
      extend: false,
      bounds,
    });
    expect(next).toEqual(sel(at(0, 0)));
    const last = gridSelectionReducer(sel(at(4, 3)), {
      type: "moved",
      dRow: Number.POSITIVE_INFINITY,
      dCol: Number.POSITIVE_INFINITY,
      extend: false,
      bounds,
    });
    expect(last).toEqual(sel(at(4, 3)));
  });

  it("選択がないときの矢印キーは先頭のセルを選ぶ", () => {
    const next = gridSelectionReducer(null, {
      type: "moved",
      dRow: 1,
      dCol: 0,
      extend: false,
      bounds,
    });
    expect(next).toEqual(sel(at(0, 0)));
  });

  it("行も列もない表では選択しない", () => {
    expect(
      gridSelectionReducer(null, {
        type: "moved",
        dRow: 1,
        dCol: 0,
        extend: false,
        bounds: { rows: 0, cols: 3 },
      }),
    ).toBeNull();
  });

  it("全選択は先頭から末尾までの矩形にし、active は先頭に置く", () => {
    expect(gridSelectionReducer(null, { type: "allSelected", bounds })).toEqual(
      sel(at(0, 0), at(4, 3)),
    );
  });

  it("解除すると null に戻る", () => {
    expect(gridSelectionReducer(sel(at(1, 1)), { type: "cleared" })).toBeNull();
  });
});
