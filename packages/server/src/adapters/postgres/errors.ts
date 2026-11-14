import type { DbViewerError } from "@myaaaaa_chan/db-viewer-core";

// ドライバに送った SQL。DB が返す位置は、この text の中の位置になる。
// offset は、text が利用者の入力の SQL の何文字目（UTF-16）から始まるか。
export type SentSql = { readonly text: string; readonly offset: number };

export type ErrorContext = {
  readonly timeoutMs: number;
  // こちらから pg_cancel_backend を依頼した。57014 を cancelled と timeout に分ける唯一の根拠
  readonly cancelRequested: boolean;
  // 位置を利用者の SQL に直すときだけ渡す（fetchRows などの組み立てた SQL では null）
  readonly sent: SentSql | null;
};

type DatabaseErrorLike = Error & {
  readonly code: string;
  readonly severity: string;
  readonly position?: unknown;
};

const SQLSTATE = /^[0-9A-Z]{5}$/;

// EPIPE のように SQLSTATE と同じ形のシステムエラーのコードがあるので、severity の有無でも見分ける。
// severity は DB が返したエラーにだけ付く。
export const isDatabaseError = (cause: unknown): cause is DatabaseErrorLike => {
  if (!(cause instanceof Error)) return false;
  const { code, severity } = cause as Error & { code?: unknown; severity?: unknown };
  return typeof code === "string" && SQLSTATE.test(code) && typeof severity === "string";
};

// 利用者にそのまま見せてよいメッセージを持つエラー。接続先やユーザー名などを含めないことは、作る側が守る
export class SafeMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class DriverNotInstalledError extends SafeMessageError {
  constructor(packageName: string) {
    super(`${packageName} is not installed. Run: npm install ${packageName}`);
  }
}

// 接続を取る・張る段階の失敗。DB が返した認証や接続のエラーは、ユーザー名・DB 名・クライアントの
// アドレスを含みうる（"pg_hba.conf rejects connection for host ..."）ので、コードだけを伝える。
export class ConnectionFailedError extends SafeMessageError {
  constructor(cause: unknown) {
    const code = (cause as { code?: unknown } | null)?.code;
    super(
      typeof code === "string"
        ? `Database connection error (${code}).`
        : "Database connection error.",
    );
  }
}

// 中断の依頼を DB に届ける接続が、時間内に使えなかった
export class CancelTimeoutError extends SafeMessageError {
  constructor() {
    super("Timed out sending the cancel request to the database.");
  }
}

// ドライバがこの形で受け付けない文（COPY ... FROM STDIN）。利用者に伝える内容で、秘密を含まない
export class UnsupportedStatementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedStatementError";
  }
}

// ERROR は文が失敗しただけで、接続は使える。FATAL と PANIC は DB 側が接続を閉じるので、
// その接続でカーソルを閉じたり ROLLBACK を待ったりしてはいけない（応答が来ない）。
export const connectionSurvives = (cause: unknown): boolean =>
  isDatabaseError(cause) && cause.severity === "ERROR";

// DB の position は文字（コードポイント）の数。JS の文字列の位置（UTF-16）に直す。
export const toUtf16Index = (text: string, codePointIndex: number): number => {
  let units = 0;
  let count = 0;
  for (const char of text) {
    if (count >= codePointIndex) break;
    units += char.length;
    count++;
  }
  return units;
};

// 1 始まりの position を、利用者が入力した SQL の中の 0 始まりの位置にする。
const positionOf = (cause: DatabaseErrorLike, sent: SentSql | null): number | null => {
  if (sent === null || typeof cause.position !== "string") return null;
  const oneBased = Number.parseInt(cause.position, 10);
  if (!Number.isSafeInteger(oneBased) || oneBased < 1) return null;
  return sent.offset + toUtf16Index(sent.text, oneBased - 1);
};

/**
 * ドライバが投げた例外を、利用者に見せてよいエラーにする（境界での変換）。
 * 接続先を含みうる接続エラーのメッセージは載せない（02 §7）。
 */
export const toDbError = (cause: unknown, context: ErrorContext): DbViewerError => {
  if (cause instanceof SafeMessageError) return { kind: "internal", message: cause.message };
  // 0A000 = feature_not_supported
  if (cause instanceof UnsupportedStatementError) {
    return { kind: "query", message: cause.message, sqlState: "0A000", position: null };
  }
  if (!isDatabaseError(cause)) {
    const code = (cause as { code?: unknown } | null)?.code;
    return {
      kind: "internal",
      message:
        cause instanceof Error && typeof code === "string"
          ? `Database connection error (${code}).`
          : "An unexpected database error occurred.",
    };
  }
  switch (cause.code) {
    case "25006":
      return { kind: "readOnlyViolation", message: cause.message };
    case "57014":
      return context.cancelRequested
        ? { kind: "cancelled" }
        : { kind: "timeout", timeoutMs: context.timeoutMs };
    default:
      return {
        kind: "query",
        message: cause.message,
        sqlState: cause.code,
        position: positionOf(cause, context.sent),
      };
  }
};
