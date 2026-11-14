export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const map = <T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> =>
  result.ok ? ok(fn(result.value)) : result;

export const mapErr = <T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> =>
  result.ok ? result : err(fn(result.error));

export const andThen = <T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> => (result.ok ? fn(result.value) : result);

export const unwrapOr = <T, E>(result: Result<T, E>, fallback: T): T =>
  result.ok ? result.value : fallback;

export const match = <T, E, R>(
  result: Result<T, E>,
  handlers: { readonly ok: (value: T) => R; readonly err: (error: E) => R },
): R => (result.ok ? handlers.ok(result.value) : handlers.err(result.error));

// 例外を投げうる非同期処理を、境界で Result に変換する。同期的な throw も拾う。
export const tryAsync = async <T, E>(
  fn: () => Promise<T>,
  toError: (cause: unknown) => E,
): Promise<Result<T, E>> => {
  try {
    return ok(await fn());
  } catch (cause) {
    return err(toError(cause));
  }
};
