export type Span = { readonly from: number; readonly to: number };

const isWordChar = (ch: string): boolean => /[\p{L}\p{N}_$]/u.test(ch);

const closingQuote = (sql: string, start: number): number => {
  const quote = sql.charAt(start);
  let i = start + 1;
  while (i < sql.length) {
    if (sql.charAt(i) === quote) {
      if (sql.charAt(i + 1) !== quote) return i + 1;
      i += 2;
    } else {
      i++;
    }
  }
  return sql.length;
};

// エラーの位置から、下線を引く範囲を決める。識別子・語・引用符付きの部分は、その終わりまで。
// 入力の終わりでのエラー（position が sql の長さ）は、最後の 1 文字に引く。
export const errorSpan = (sql: string, position: number): Span | null => {
  if (position < 0 || position > sql.length || sql.length === 0) return null;
  if (position === sql.length) return { from: position - 1, to: position };

  const ch = sql.charAt(position);
  if (ch === '"' || ch === "'" || ch === "`")
    return { from: position, to: closingQuote(sql, position) };
  if (isWordChar(ch)) {
    let end = position + 1;
    while (end < sql.length && isWordChar(sql.charAt(end))) end++;
    return { from: position, to: end };
  }
  return { from: position, to: position + 1 };
};

// 1 始まりの行と桁。桁は UTF-16 の単位で数える（エディタの位置と同じ）。
export const lineColumn = (text: string, offset: number): { line: number; column: number } => {
  const before = text.slice(0, offset);
  const lineStart = before.lastIndexOf("\n") + 1;
  const line = before.split("\n").length;
  return { line, column: offset - lineStart + 1 };
};
