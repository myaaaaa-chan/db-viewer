const NUMERIC_TYPE =
  /^(int\d*|integer|bigint|smallint|tinyint|mediumint|serial\d*|bigserial|smallserial|numeric|decimal|real|double|float\d*|money|oid)\b/i;

// 右寄せにする列の型。PostgreSQL（int8、numeric(10,2)）と SQLite（INTEGER、REAL）の型名を見る。
export const isNumericType = (dbType: string | null): boolean =>
  dbType !== null && NUMERIC_TYPE.test(dbType.trim());
