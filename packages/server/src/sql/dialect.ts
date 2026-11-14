import type { Dialect, TableRef } from "@myaaaaa_chan/db-viewer-core";

// 方言ごとの SQL の違いは、分岐を散らさずこの表に集める（03_サーバー §3）。
type DialectSyntax = {
  readonly placeholder: (position: number) => string;
  // LIKE の左辺。PostgreSQL は数値などの列にも使えるよう text にキャストする
  readonly likeOperand: (columnSql: string) => string;
  // 1 セルを maxCellChars + 1 文字までに切って取る式。超えたかどうかの判定は呼び出し側が行う
  readonly truncatedCell: (columnSql: string, maxCellChars: number) => string;
  // 切り詰めずに値全体を取る式
  readonly fullCell: (columnSql: string) => string;
};

const DIALECT_SYNTAX: Readonly<Record<Dialect, DialectSyntax>> = {
  postgres: {
    placeholder: (position) => `$${position}`,
    likeOperand: (columnSql) => `${columnSql}::text`,
    truncatedCell: (columnSql, maxCellChars) =>
      `left(${columnSql}::text, ${integerLiteral(maxCellChars + 1)})`,
    fullCell: (columnSql) => `${columnSql}::text`,
  },
  sqlite: {
    placeholder: () => "?",
    likeOperand: (columnSql) => columnSql,
    // 文字列は文字数、BLOB は 16 進にしたときの文字数で n + 1 を超える分だけ取る。
    // BLOB は \x の 2 文字と 1 バイトあたり 2 文字になるので、ceil(n / 2) + 1 バイトで足りる。
    // 整数と実数は型を保ったまま返し、文字列への変換はドライバの後ろ（アダプター）で行う。
    truncatedCell: (columnSql, maxCellChars) =>
      `CASE typeof(${columnSql}) ` +
      `WHEN 'text' THEN substr(${columnSql}, 1, ${integerLiteral(maxCellChars + 1)}) ` +
      `WHEN 'blob' THEN '\\x' || lower(hex(substr(${columnSql}, 1, ${integerLiteral(Math.ceil(maxCellChars / 2) + 1)}))) ` +
      `ELSE ${columnSql} END`,
    fullCell: (columnSql) => columnSql,
  },
};

// SQL に直接書く数値は、設定から来る正の整数だけに限る。
const integerLiteral = (value: number): string => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`expected a positive integer (received ${value})`);
  }
  return String(value);
};

export const syntaxOf = (dialect: Dialect): DialectSyntax => DIALECT_SYNTAX[dialect];

export const placeholder = (dialect: Dialect, position: number): string =>
  DIALECT_SYNTAX[dialect].placeholder(position);

// どちらの方言も二重引用符で囲み、中の二重引用符を 2 つ重ねる。識別子はこの関数を通してからでないと SQL に入れない。
export const quoteIdentifier = (_dialect: Dialect, name: string): string => {
  if (name.includes("\0")) throw new RangeError("identifier must not contain a NUL character");
  return `"${name.replaceAll('"', '""')}"`;
};

export const quoteTable = (dialect: Dialect, table: TableRef): string =>
  `${quoteIdentifier(dialect, table.schema)}.${quoteIdentifier(dialect, table.name)}`;
