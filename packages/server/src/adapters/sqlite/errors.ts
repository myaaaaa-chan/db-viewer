import type { DbViewerError } from "@myaaaaa_chan/db-viewer-core";

// SQLITE_READONLY の基本コード（拡張コードは下位 8 ビットがこの値）
const SQLITE_READONLY = 8;

const isReadOnlyViolation = (code: unknown, errcode: unknown): boolean =>
  (typeof code === "string" && code.startsWith("SQLITE_READONLY")) ||
  (typeof errcode === "number" && (errcode & 0xff) === SQLITE_READONLY);

// ドライバが投げた例外を、利用者に見せてよいエラーにする（境界での変換）。
// better-sqlite3 と bun:sqlite は code に SQLITE_* を、node:sqlite は errcode に数値を入れる。
export const toDbError = (cause: unknown): DbViewerError => {
  if (!(cause instanceof Error)) {
    return { kind: "internal", message: "An unexpected error occurred." };
  }
  const { code, errcode } = cause as { readonly code?: unknown; readonly errcode?: unknown };
  if (isReadOnlyViolation(code, errcode)) {
    return { kind: "readOnlyViolation", message: cause.message };
  }
  return {
    kind: "query",
    message: cause.message,
    sqlState: typeof code === "string" ? code : null,
    position: null,
  };
};
