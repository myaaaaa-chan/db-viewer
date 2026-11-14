import type { Dialect } from "./domain";

export type Statement = {
  // UTF-16 の位置（エディタの位置と同じ）。to は含まない。終端の ; は文に含めない。
  readonly from: number;
  readonly to: number;
  readonly text: string;
};

// 方言ごとの字句の違い。分岐を散らさず、この表に集める。
type LexRules = {
  readonly nestedBlockComments: boolean;
  readonly lineCommentEndsAtCarriageReturn: boolean;
  readonly dollarQuotes: boolean;
  readonly escapeStrings: boolean;
  readonly bracketIdentifiers: boolean;
  readonly backtickIdentifiers: boolean;
  readonly triggerBodies: boolean;
};

const LEX_RULES: Readonly<Record<Dialect, LexRules>> = {
  postgres: {
    nestedBlockComments: true,
    lineCommentEndsAtCarriageReturn: true,
    dollarQuotes: true,
    escapeStrings: true,
    bracketIdentifiers: false,
    backtickIdentifiers: false,
    triggerBodies: false,
  },
  sqlite: {
    nestedBlockComments: false,
    lineCommentEndsAtCarriageReturn: false,
    dollarQuotes: false,
    escapeStrings: false,
    bracketIdentifiers: true,
    backtickIdentifiers: true,
    triggerBodies: true,
  },
};

// SQLite の CREATE TRIGGER の本体は ; を含む。SQLite 自身が文の終わりを判定する
// sqlite3_complete() と同じ状態遷移で、本体の ; を文の区切りから外す。
type TokenKind = "semi" | "other" | "explain" | "create" | "temp" | "trigger" | "end";
type TriggerState =
  | "start"
  | "normal"
  | "explain"
  | "create"
  | "trigger"
  | "triggerSemi"
  | "triggerEnd";

const TRIGGER_TRANSITIONS: Readonly<
  Record<TriggerState, Readonly<Record<TokenKind, TriggerState>>>
> = {
  start: {
    semi: "start",
    other: "normal",
    explain: "explain",
    create: "create",
    temp: "normal",
    trigger: "normal",
    end: "normal",
  },
  normal: {
    semi: "start",
    other: "normal",
    explain: "normal",
    create: "normal",
    temp: "normal",
    trigger: "normal",
    end: "normal",
  },
  explain: {
    semi: "start",
    other: "explain",
    explain: "normal",
    create: "create",
    temp: "normal",
    trigger: "normal",
    end: "normal",
  },
  create: {
    semi: "start",
    other: "normal",
    explain: "normal",
    create: "normal",
    temp: "create",
    trigger: "trigger",
    end: "normal",
  },
  trigger: {
    semi: "triggerSemi",
    other: "trigger",
    explain: "trigger",
    create: "trigger",
    temp: "trigger",
    trigger: "trigger",
    end: "trigger",
  },
  triggerSemi: {
    semi: "triggerSemi",
    other: "trigger",
    explain: "trigger",
    create: "trigger",
    temp: "trigger",
    trigger: "trigger",
    end: "triggerEnd",
  },
  triggerEnd: {
    semi: "start",
    other: "trigger",
    explain: "trigger",
    create: "trigger",
    temp: "trigger",
    trigger: "trigger",
    end: "trigger",
  },
};

const KEYWORD_KINDS: Readonly<Record<string, TokenKind>> = {
  explain: "explain",
  create: "create",
  temp: "temp",
  temporary: "temp",
  trigger: "trigger",
  end: "end",
};

const keywordKind = (word: string): TokenKind => KEYWORD_KINDS[word.toLowerCase()] ?? "other";

const isWhitespace = (ch: string): boolean =>
  ch === " " || ch === "\n" || ch === "\t" || ch === "\r" || ch === "\f" || ch === "\v";

const isLetterOrUnderscore = (ch: string): boolean =>
  (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch >= "\u0080";

const isDigit = (ch: string): boolean => ch >= "0" && ch <= "9";

// 識別子や数値を 1 語として読むときの文字。PostgreSQL では $ も識別子に使える。
const isWordChar = (ch: string): boolean => isLetterOrUnderscore(ch) || isDigit(ch) || ch === "$";

// 以下の skip 関数は、字句の先頭 i から、その字句の直後の位置を返す。閉じていなければ末尾を返す。

const skipLineComment = (sql: string, start: number, rules: LexRules): number => {
  for (let i = start + 2; i < sql.length; i++) {
    const ch = sql.charAt(i);
    if (ch === "\n" || (rules.lineCommentEndsAtCarriageReturn && ch === "\r")) return i;
  }
  return sql.length;
};

const skipBlockComment = (sql: string, start: number, rules: LexRules): number => {
  let depth = 1;
  let i = start + 2;
  while (i < sql.length) {
    if (rules.nestedBlockComments && sql.startsWith("/*", i)) {
      depth++;
      i += 2;
    } else if (sql.startsWith("*/", i)) {
      depth--;
      i += 2;
      if (depth === 0) return i;
    } else {
      i++;
    }
  }
  return sql.length;
};

// 引用符を 2 つ重ねたものを引用符そのものとして読む（'' / "" / ``）
const skipQuoted = (sql: string, start: number, quote: string): number => {
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

// PostgreSQL の E'...'。\ が直後の 1 文字をエスケープする。
const skipEscapeString = (sql: string, start: number): number => {
  let i = start + 1;
  while (i < sql.length) {
    const ch = sql.charAt(i);
    if (ch === "\\") {
      i += 2;
    } else if (ch === "'") {
      if (sql.charAt(i + 1) !== "'") return i + 1;
      i += 2;
    } else {
      i++;
    }
  }
  return sql.length;
};

const skipBracketIdentifier = (sql: string, start: number): number => {
  const close = sql.indexOf("]", start + 1);
  return close < 0 ? sql.length : close + 1;
};

// $tag$ ... $tag$ の全体の直後の位置。$ が開始の区切りになっていなければ null。
const skipDollarQuote = (sql: string, start: number): number | null => {
  let i = start + 1;
  if (isLetterOrUnderscore(sql.charAt(i))) {
    while (isLetterOrUnderscore(sql.charAt(i)) || isDigit(sql.charAt(i))) i++;
  }
  if (sql.charAt(i) !== "$") return null;
  const delimiter = sql.slice(start, i + 1);
  const close = sql.indexOf(delimiter, i + 1);
  return close < 0 ? sql.length : close + delimiter.length;
};

type Segment = {
  // 終端の ; の位置。終端がない最後の文では sql の長さ。
  readonly end: number;
  readonly terminated: boolean;
  // 空白とコメントだけなら null
  readonly statement: Statement | null;
};

// 先頭から 1 回の走査で、終端の ; ごとに区切った区間を返す。区間は終端の数 + 1 個あり、空の区間も含む。
const scan = (sql: string, dialect: Dialect): ReadonlyArray<Segment> => {
  const rules = LEX_RULES[dialect];
  const segments: Array<Segment> = [];
  let first = -1;
  let last = 0;
  let hasToken = false;
  let state: TriggerState = "start";

  const mark = (start: number, end: number, isToken: boolean) => {
    if (first < 0) first = start;
    last = end;
    if (isToken) hasToken = true;
  };
  const advance = (kind: TokenKind) => {
    if (rules.triggerBodies) state = TRIGGER_TRANSITIONS[state][kind];
  };
  const close = (end: number, terminated: boolean) => {
    // 閉じていない文字列やコメントは末尾まで続くので、後ろの空白を字句の一部として含んでしまう。
    let to = last;
    while (to > first && isWhitespace(sql.charAt(to - 1))) to--;
    const statement: Statement | null = hasToken
      ? { from: first, to, text: sql.slice(first, to) }
      : null;
    segments.push({ end, terminated, statement });
    first = -1;
    last = 0;
    hasToken = false;
    state = "start";
  };
  const token = (start: number, end: number, kind: TokenKind): number => {
    mark(start, end, true);
    advance(kind);
    return end;
  };

  let i = 0;
  while (i < sql.length) {
    const ch = sql.charAt(i);
    const next = sql.charAt(i + 1);

    if (isWhitespace(ch)) {
      i++;
    } else if (ch === "-" && next === "-") {
      const end = skipLineComment(sql, i, rules);
      mark(i, end, false);
      i = end;
    } else if (ch === "/" && next === "*") {
      const end = skipBlockComment(sql, i, rules);
      mark(i, end, false);
      i = end;
    } else if (ch === "'") {
      i = token(i, skipQuoted(sql, i, "'"), "other");
    } else if (ch === '"') {
      i = token(i, skipQuoted(sql, i, '"'), "other");
    } else if (ch === "`" && rules.backtickIdentifiers) {
      i = token(i, skipQuoted(sql, i, "`"), "other");
    } else if (ch === "[" && rules.bracketIdentifiers) {
      i = token(i, skipBracketIdentifier(sql, i), "other");
    } else if (ch === ";") {
      const after: TriggerState = TRIGGER_TRANSITIONS[state].semi;
      if (!rules.triggerBodies || after === "start") {
        close(i, true);
      } else {
        mark(i, i + 1, true);
        state = after;
      }
      i++;
    } else {
      const dollarEnd = ch === "$" && rules.dollarQuotes ? skipDollarQuote(sql, i) : null;
      if (dollarEnd !== null) {
        i = token(i, dollarEnd, "other");
      } else if (isWordChar(ch)) {
        let end = i + 1;
        while (isWordChar(sql.charAt(end))) end++;
        const isEscapeStringPrefix =
          rules.escapeStrings &&
          end === i + 1 &&
          (ch === "e" || ch === "E") &&
          sql.charAt(end) === "'";
        if (isEscapeStringPrefix) {
          i = token(i, skipEscapeString(sql, end), "other");
        } else {
          i = token(i, end, rules.triggerBodies ? keywordKind(sql.slice(i, end)) : "other");
        }
      } else {
        i = token(i, i + 1, "other");
      }
    }
  }
  close(sql.length, false);
  return segments;
};

/**
 * 終端の ; で区切った文を、空白とコメントだけの区間を除いて順に返す。
 * 文字列・引用符付きの識別子・コメント・PostgreSQL のドル引用と E'...'・SQLite のトリガー本体の中の ; では区切らない。
 * 文の先頭と末尾のコメントは文の一部として残し（pg_hint_plan のブロックコメントによる指示などを失わない）、前後の空白は含めない。
 */
export const splitStatements = (sql: string, dialect: Dialect): ReadonlyArray<Statement> =>
  scan(sql, dialect).flatMap((segment) => (segment.statement ? [segment.statement] : []));

/**
 * カーソル（UTF-16 の位置。範囲外は先頭と末尾に丸める）がある文を返す。
 * - `;` の直後までは、その `;` で終わる文のものとして扱う（`;` を打った直後にそのまま実行できるように）。
 * - 文と文の間の空行は次の文のもの。
 * - 文のない場所（最後の文の後ろの空行やコメントなど）では null を返す。前の文を黙って選ばないのは、
 *   書き込み可能な接続で、空行から直前の DELETE を再実行してしまうのを避けるため。
 */
export const statementAt = (sql: string, cursor: number, dialect: Dialect): Statement | null => {
  const position = Math.min(Math.max(cursor, 0), sql.length);
  const owner = scan(sql, dialect).find(
    (segment) => position <= segment.end + (segment.terminated ? 1 : 0),
  );
  return owner?.statement ?? null;
};

/** 2 文目以降があるか。サーバーが multipleStatements を返すかどうかの判定に使う。 */
export const hasMultipleStatements = (sql: string, dialect: Dialect): boolean =>
  splitStatements(sql, dialect).length > 1;
