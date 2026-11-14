import type { DbResult, DbViewerError } from "@myaaaaa_chan/db-viewer-core";

// 非同期の取得結果。読み込み中の値と失敗を同時には持てないよう、判別可能な union にする。
export type Remote<T> =
  | { readonly status: "idle" }
  // previous は直前に表示していた値。応答が届くまで表を空にしないために持つ。
  | { readonly status: "loading"; readonly requestId: number; readonly previous: T | null }
  | { readonly status: "ready"; readonly value: T }
  | { readonly status: "failed"; readonly error: DbViewerError };

export const idle: Remote<never> = { status: "idle" };

export const shownValue = <T>(remote: Remote<T>): T | null => {
  if (remote.status === "ready") return remote.value;
  if (remote.status === "loading") return remote.previous;
  return null;
};

export const request = <T>(current: Remote<T>, requestId: number): Remote<T> => ({
  status: "loading",
  requestId,
  previous: shownValue(current),
});

// 応答は、読み込み中の要求と番号が一致するときだけ反映する。古い応答は何も変えない。
export const settle = <T>(
  current: Remote<T>,
  requestId: number,
  result: DbResult<T>,
): Remote<T> => {
  if (current.status !== "loading" || current.requestId !== requestId) return current;
  return result.ok
    ? { status: "ready", value: result.value }
    : { status: "failed", error: result.error };
};
