// 既定値はすべて設計上の値（未計測）。03_サーバー §1。
export type Limits = {
  readonly maxRows: number;
  readonly statementTimeoutMs: number;
  // 02 §3.1。1 セルあたりの最大文字数（コードポイント）
  readonly maxCellChars: number;
  // 接続ごと。超えた場合は待たせずに busy エラーを返す
  readonly maxConcurrentQueries: number;
};

export const DEFAULT_LIMITS: Limits = {
  maxRows: 1000,
  statementTimeoutMs: 30_000,
  maxCellChars: 10_000,
  maxConcurrentQueries: 2,
};

const LIMIT_KEYS = Object.keys(DEFAULT_LIMITS) as ReadonlyArray<keyof Limits>;

// 設定の誤りは起動時に気づけるよう、利用者のコードの中で投げる。リクエストの処理中には呼ばない。
export const resolveLimits = (overrides: Partial<Limits> = {}): Limits => {
  const resolved = { ...DEFAULT_LIMITS, ...overrides };
  for (const key of LIMIT_KEYS) {
    const value = resolved[key];
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`limits.${key} must be a positive integer (received ${value})`);
    }
  }
  return resolved;
};
