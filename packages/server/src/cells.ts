import type { CellValue } from "@myaaaaa_chan/db-viewer-core";

export type TruncatedCell = { readonly text: string; readonly truncated: boolean };

// 文字数はコードポイントで数える。PostgreSQL の left() と SQLite の substr() が数える単位と同じにして、
// SQL の中で切った結果とこの関数で切った結果がずれないようにする。
export const truncateCell = (text: string, maxChars: number): TruncatedCell => {
  // UTF-16 の長さが上限以下なら、コードポイント数も上限以下
  if (text.length <= maxChars) return { text, truncated: false };

  let end = 0;
  for (let count = 0; count < maxChars && end < text.length; count++) {
    end += (text.codePointAt(end) ?? 0) > 0xffff ? 2 : 1;
  }
  return end >= text.length
    ? { text, truncated: false }
    : { text: text.slice(0, end), truncated: true };
};

export type CappedRows = {
  readonly rows: ReadonlyArray<ReadonlyArray<CellValue>>;
  readonly truncatedCells: ReadonlyArray<readonly [row: number, column: number]>;
};

// DB から受け取った後に切り詰める。fetchRows では SQL の中でも切るが、上限ちょうどの判定はここで行う。
export const capCells = (
  rows: ReadonlyArray<ReadonlyArray<CellValue>>,
  maxChars: number,
): CappedRows => {
  const truncatedCells: Array<readonly [number, number]> = [];
  const capped = rows.map((row, rowIndex) =>
    row.map((cell, columnIndex) => {
      if (cell === null) return null;
      const result = truncateCell(cell, maxChars);
      if (result.truncated) truncatedCells.push([rowIndex, columnIndex]);
      return result.text;
    }),
  );
  return { rows: capped, truncatedCells };
};

// PostgreSQL の bytea の表示（\x + 小文字の 16 進）にそろえる。02 §3
export const bytesToHex = (bytes: Uint8Array): string => {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return `\\x${hex}`;
};
