import type { CellValue } from "@myaaaaa_chan/db-viewer-core";

export type CellDetail =
  | { readonly kind: "null" }
  | { readonly kind: "text"; readonly text: string };

const isJsonType = (dbType: string | null): boolean =>
  dbType !== null && /^jsonb?$/i.test(dbType.trim());

// 詳細パネルに出す内容。json / jsonb は整形する。切り詰めた値など、json として読めなければそのまま出す。
export const formatCellDetail = (value: CellValue, dbType: string | null): CellDetail => {
  if (value === null) return { kind: "null" };
  if (!isJsonType(dbType)) return { kind: "text", text: value };
  try {
    return { kind: "text", text: JSON.stringify(JSON.parse(value), null, 2) };
  } catch {
    return { kind: "text", text: value };
  }
};
