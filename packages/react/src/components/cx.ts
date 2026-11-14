// クラス名をつなぐ。偽の値は捨てる。
export const cx = (...names: ReadonlyArray<string | false | null | undefined>): string =>
  names.filter(Boolean).join(" ");
