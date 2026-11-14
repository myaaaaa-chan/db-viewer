import type { TableRef } from "@myaaaaa_chan/db-viewer-core";

export const columnCacheKey = (ref: TableRef): string => JSON.stringify([ref.schema, ref.name]);

export type SqlNamespace = { [schema: string]: { [table: string]: ReadonlyArray<string> } };

// @codemirror/lang-sql の schema に渡す、スキーマ → テーブル → カラム名の入れ子。
// カラムは getTableDetail で取得できたテーブルだけに入り、未取得のテーブルは空の配列になる。
export const buildSqlSchema = (
  tables: ReadonlyArray<TableRef>,
  columnsByTable: Readonly<Record<string, ReadonlyArray<string>>>,
): SqlNamespace => {
  const namespace: SqlNamespace = {};
  for (const ref of tables) {
    const tables = namespace[ref.schema] ?? {};
    tables[ref.name] = columnsByTable[columnCacheKey(ref)] ?? [];
    namespace[ref.schema] = tables;
  }
  return namespace;
};

// SQL に書かれた語に名前が一致するテーブル。カラムの補完のために、この表のカラムだけを取りに行く。
export const referencedTables = (
  sql: string,
  tables: ReadonlyArray<TableRef>,
): ReadonlyArray<TableRef> => {
  const words = new Set(sql.toLowerCase().split(/[^\p{L}\p{N}_$]+/u));
  return tables.filter((ref) => words.has(ref.name.toLowerCase()));
};
