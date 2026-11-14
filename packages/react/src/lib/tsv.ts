import type { CellValue } from "@myaaaaa_chan/db-viewer-core";

const NEEDS_QUOTE = /[\t\r\n"]/;

// 列名は含めず、NULL は空文字にする。スプレッドシートへの貼り付けを優先した形式。
const field = (value: CellValue): string => {
  if (value === null) return "";
  return NEEDS_QUOTE.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
};

export const toTsv = (rows: ReadonlyArray<ReadonlyArray<CellValue>>): string =>
  rows.map((row) => row.map(field).join("\t")).join("\n");
