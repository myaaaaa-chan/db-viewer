import type { CellValue } from "@myaaaaa_chan/db-viewer-core";
import { bytesToHex } from "../../cells";

// SQLite は整数と実数を区別する。整数を BigInt で受け取れている接続では、number は実数だと分かる。
// 3.0 を "3" と出すと整数に見えるので、整数に見える実数には小数点を付ける。
const formatReal = (value: number): string => {
  const text = String(value);
  return /^-?\d+$/.test(text) ? `${text}.0` : text;
};

// ドライバから受け取った値を、02 §3 の「DB の文字列表現」にする。型の判断はこの関数に集める。
export const cellFromSqliteValue = (value: unknown, integersAsBigInt: boolean): CellValue => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return integersAsBigInt ? formatReal(value) : String(value);
  if (value instanceof Uint8Array) return bytesToHex(value);
  return String(value);
};
