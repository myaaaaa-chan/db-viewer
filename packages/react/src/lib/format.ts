// 件数などの整数を、言語に合わせた桁区切りで表示する。bigint の件数は文字列で届くので、精度を落とさない。
export const formatInteger = (value: number | string | bigint, language: string): string => {
  try {
    return new Intl.NumberFormat(language).format(
      typeof value === "string" ? BigInt(value) : value,
    );
  } catch {
    return String(value);
  }
};
