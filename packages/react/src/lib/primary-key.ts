import type { ResultSet, TableDetail } from "@myaaaaa_chan/db-viewer-core";

// fetchCell に渡す主キー。主キーがない・結果に列がない・主キーの値が切り詰められている場合は
// 行を 1 つに決められないので null を返す。
export const primaryKeyOf = (
  detail: TableDetail,
  result: ResultSet,
  rowIndex: number,
): Record<string, string> | null => {
  const row = result.rows[rowIndex];
  if (!row) return null;
  const keyColumns = detail.columns
    .filter((c) => c.primaryKeyPosition !== null)
    .sort((a, b) => (a.primaryKeyPosition ?? 0) - (b.primaryKeyPosition ?? 0));
  if (keyColumns.length === 0) return null;

  const key: Record<string, string> = {};
  for (const keyColumn of keyColumns) {
    const index = result.columns.findIndex((c) => c.name === keyColumn.name);
    const value = index < 0 ? null : (row[index] ?? null);
    const truncated = result.truncatedCells.some(([r, c]) => r === rowIndex && c === index);
    if (value === null || truncated) return null;
    key[keyColumn.name] = value;
  }
  return key;
};
