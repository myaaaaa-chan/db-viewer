import type { CellValue } from "@myaaaaa_chan/db-viewer-core";

export type CellPos = { readonly row: number; readonly col: number };
export type GridBounds = { readonly rows: number; readonly cols: number };

// anchor は選び始めたセル（詳細パネルに出す active なセル）、focus は範囲の反対側の端。
// 範囲は 2 つを対角とする矩形。選択がないときは null で表す。
export type GridSelection = { readonly anchor: CellPos; readonly focus: CellPos };

export type CellRange = {
  readonly top: number;
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
};

export const rangeOf = ({ anchor, focus }: GridSelection): CellRange => ({
  top: Math.min(anchor.row, focus.row),
  left: Math.min(anchor.col, focus.col),
  bottom: Math.max(anchor.row, focus.row),
  right: Math.max(anchor.col, focus.col),
});

export const rangeSize = (range: CellRange): GridBounds => ({
  rows: range.bottom - range.top + 1,
  cols: range.right - range.left + 1,
});

export const isInRange = (range: CellRange, row: number, col: number): boolean =>
  row >= range.top && row <= range.bottom && col >= range.left && col <= range.right;

export const sliceRange = (
  rows: ReadonlyArray<ReadonlyArray<CellValue>>,
  range: CellRange,
): ReadonlyArray<ReadonlyArray<CellValue>> =>
  rows.slice(range.top, range.bottom + 1).map((row) => row.slice(range.left, range.right + 1));

export type GridAction =
  | { readonly type: "pressed"; readonly pos: CellPos; readonly extend: boolean }
  | { readonly type: "dragged"; readonly pos: CellPos }
  | {
      readonly type: "moved";
      readonly dRow: number;
      readonly dCol: number;
      readonly extend: boolean;
      readonly bounds: GridBounds;
    }
  | { readonly type: "allSelected"; readonly bounds: GridBounds }
  | { readonly type: "cleared" };

const clamp = (value: number, max: number): number => Math.min(Math.max(value, 0), max);

const single = (pos: CellPos): GridSelection => ({ anchor: pos, focus: pos });

export const gridSelectionReducer = (
  state: GridSelection | null,
  action: GridAction,
): GridSelection | null => {
  switch (action.type) {
    case "pressed":
      return action.extend && state
        ? { anchor: state.anchor, focus: action.pos }
        : single(action.pos);
    case "dragged":
      return state ? { anchor: state.anchor, focus: action.pos } : single(action.pos);
    case "moved": {
      const { bounds } = action;
      if (bounds.rows === 0 || bounds.cols === 0) return null;
      if (!state) return single({ row: 0, col: 0 });
      // 範囲を広げるときに動かすのは focus。そうでなければ focus を基準に anchor ごと動かす。
      const from = state.focus;
      const moved: CellPos = {
        row: clamp(from.row + action.dRow, bounds.rows - 1),
        col: clamp(from.col + action.dCol, bounds.cols - 1),
      };
      return action.extend ? { anchor: state.anchor, focus: moved } : single(moved);
    }
    case "allSelected": {
      const { bounds } = action;
      if (bounds.rows === 0 || bounds.cols === 0) return null;
      return {
        anchor: { row: 0, col: 0 },
        focus: { row: bounds.rows - 1, col: bounds.cols - 1 },
      };
    }
    case "cleared":
      return null;
  }
};
