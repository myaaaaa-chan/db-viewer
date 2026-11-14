import type { CellValue, ResultColumn } from "@myaaaaa_chan/db-viewer-core";

export const MIN_COLUMN_WIDTH = 90;
export const MAX_COLUMN_WIDTH = 360;
// 等幅 12.5px の半角 1 文字の幅（概算）と、セルの左右の余白
const CHAR_WIDTH = 7.8;
const CELL_PADDING = 24;
// 先頭の何行を見て幅を決めるか
const SAMPLE_ROWS = 50;

// 全角の文字は半角 2 つぶんの幅で数える。
export const displayLength = (text: string): number => {
  let length = 0;
  for (const ch of text) length += (ch.codePointAt(0) ?? 0) >= 0x2e80 ? 2 : 1;
  return length;
};

export const defaultColumnWidth = (
  column: ResultColumn,
  sample: ReadonlyArray<CellValue>,
): number => {
  const header = Math.max(displayLength(column.name), displayLength(column.dbType ?? ""));
  const body = sample
    .slice(0, SAMPLE_ROWS)
    .reduce((max, value) => Math.max(max, value === null ? 4 : displayLength(value)), 0);
  const width = Math.ceil(Math.max(header, body) * CHAR_WIDTH + CELL_PADDING);
  return Math.min(Math.max(width, MIN_COLUMN_WIDTH), MAX_COLUMN_WIDTH);
};
