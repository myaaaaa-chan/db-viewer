import { describe, expect, it } from "vitest";
import type { Dialect } from "./domain";
import { hasMultipleStatements, splitStatements, statementAt } from "./statements";

const dialects: ReadonlyArray<Dialect> = ["postgres", "sqlite"];

// どんな入力でも成り立つ性質（text は元の SQL の切り出しで、順序どおり重ならない）を毎回確かめる。
const split = (sql: string, dialect: Dialect) => {
  const statements = splitStatements(sql, dialect);
  let previousTo = 0;
  for (const s of statements) {
    expect(sql.slice(s.from, s.to)).toBe(s.text);
    expect(s.text).toBe(s.text.trim());
    expect(s.from).toBeGreaterThanOrEqual(previousTo);
    expect(s.to).toBeGreaterThan(s.from);
    previousTo = s.to;
  }
  return statements;
};
const texts = (sql: string, dialect: Dialect) => split(sql, dialect).map((s) => s.text);

describe.each(dialects)("splitStatements の共通の規則（%s）", (dialect) => {
  it("終端の ; がなくても 1 文として返す", () => {
    expect(texts("select 1", dialect)).toEqual(["select 1"]);
  });

  it("終端の ; は文に含めず、前後の空白も含めない", () => {
    expect(split("select 1;", dialect)).toEqual([{ from: 0, to: 8, text: "select 1" }]);
    const padded = "  \n select 1 \n ; \n select 2  ";
    const from1 = padded.indexOf("select 1");
    const from2 = padded.indexOf("select 2");
    expect(split(padded, dialect)).toEqual([
      { from: from1, to: from1 + 8, text: "select 1" },
      { from: from2, to: from2 + 8, text: "select 2" },
    ]);
  });

  it("; で区切って複数の文にする", () => {
    expect(texts("select 1; select 2;select 3", dialect)).toEqual([
      "select 1",
      "select 2",
      "select 3",
    ]);
  });

  it.each([
    ["空文字", ""],
    ["空白だけ", " \n\t "],
    ["; だけ", ";;;"],
    ["行コメントだけ", "-- nothing"],
    ["ブロックコメントだけ", "/* nothing; at all */"],
    ["コメントと ; と空白だけ", "-- a\n; /* b */ ;\n"],
  ])("%s なら文はない", (_label, sql) => {
    expect(texts(sql, dialect)).toEqual([]);
  });

  it("空の文や、コメントだけの文は数えない", () => {
    expect(texts("select 1;; ;select 2; -- done", dialect)).toEqual(["select 1", "select 2"]);
  });

  it("文字列リテラルの中の ; では区切らない（'' のエスケープも含む）", () => {
    expect(texts("select 'a;b'; select 2", dialect)).toEqual(["select 'a;b'", "select 2"]);
    expect(texts("select 'it''s; fine'; select 2", dialect)).toEqual([
      "select 'it''s; fine'",
      "select 2",
    ]);
  });

  it('引用符付きの識別子の中の ; では区切らない（"" のエスケープも含む）', () => {
    expect(texts('select "a;b" from t; select 2', dialect)).toEqual([
      'select "a;b" from t',
      "select 2",
    ]);
    expect(texts('select "a"";b" from t; select 2', dialect)).toEqual([
      'select "a"";b" from t',
      "select 2",
    ]);
  });

  it("行コメントの中の ; では区切らず、改行でコメントが終わる", () => {
    expect(texts("select 1 -- a; b\n; select 2", dialect)).toEqual([
      "select 1 -- a; b",
      "select 2",
    ]);
    expect(texts("-- x; y\nselect 1; select 2", dialect)).toEqual([
      "-- x; y\nselect 1",
      "select 2",
    ]);
  });

  it("ブロックコメントの中の ; では区切らない", () => {
    expect(texts("select /* ; */ 1; select 2", dialect)).toEqual(["select /* ; */ 1", "select 2"]);
    expect(texts("select 1 /* a;\nb; */; select 2", dialect)).toEqual([
      "select 1 /* a;\nb; */",
      "select 2",
    ]);
  });

  it("コメントの開始に見える文字列も、リテラルや識別子の中ではコメントにしない", () => {
    expect(texts("select '--'; select 2", dialect)).toEqual(["select '--'", "select 2"]);
    expect(texts("select '/*'; select '*/'", dialect)).toEqual(["select '/*'", "select '*/'"]);
    expect(texts('select "--" from t; select 2', dialect)).toEqual([
      'select "--" from t',
      "select 2",
    ]);
  });

  it("コメントの中の引用符は文字列を始めない", () => {
    expect(texts("select 1 -- it's\n; select 2", dialect)).toEqual([
      "select 1 -- it's",
      "select 2",
    ]);
    expect(texts('select 1 /* " */; select 2', dialect)).toEqual(['select 1 /* " */', "select 2"]);
  });

  it("文字列の中の別の種類の引用符は、そのまま文字として扱う", () => {
    expect(texts(`select '"'; select "'" from t`, dialect)).toEqual([
      `select '"'`,
      `select "'" from t`,
    ]);
  });

  it("閉じていない文字列・識別子・コメントは、末尾まで 1 つの文にする", () => {
    expect(texts("select 'abc; select 2", dialect)).toEqual(["select 'abc; select 2"]);
    expect(texts('select "abc; select 2', dialect)).toEqual(['select "abc; select 2']);
    expect(texts("select 1 /* ; select 2", dialect)).toEqual(["select 1 /* ; select 2"]);
  });

  it("閉じていない文字列やコメントが末尾まで続いても、text の末尾の空白は含めない", () => {
    expect(texts("select 'abc  \n", dialect)).toEqual(["select 'abc"]);
    expect(texts("select 1 /* open \t\n", dialect)).toEqual(["select 1 /* open"]);
    expect(texts("select 1 -- open  ", dialect)).toEqual(["select 1 -- open"]);
  });

  it("文の端のコメントは、そのまま文の一部として残す", () => {
    expect(texts("-- list\nselect 1 -- all\n;", dialect)).toEqual(["-- list\nselect 1 -- all"]);
    expect(texts("/*+ hint */ select 1", dialect)).toEqual(["/*+ hint */ select 1"]);
  });

  it("CRLF 改行でも同じように区切る", () => {
    expect(texts("select 1;\r\nselect 2;\r\n", dialect)).toEqual(["select 1", "select 2"]);
  });

  it("UTF-16 の位置で返す（日本語・サロゲートペアを含んでも text と位置が一致する）", () => {
    const sql = "select '日本語;😀'; select '𠮷' as x";
    expect(split(sql, dialect).map((s) => s.text)).toEqual([
      "select '日本語;😀'",
      "select '𠮷' as x",
    ]);
  });
});

describe("splitStatements: PostgreSQL のドル引用", () => {
  it("$$...$$ の中の ; では区切らない", () => {
    const sql =
      "create function f() returns int as $$ select 1; select 2; $$ language sql; select 3";
    expect(texts(sql, "postgres")).toEqual([
      "create function f() returns int as $$ select 1; select 2; $$ language sql",
      "select 3",
    ]);
  });

  it("$tag$...$tag$ の中の ; では区切らない。別のタグや $ は本文として扱う", () => {
    expect(texts("do $body$ begin perform 1; end $body$; select 2", "postgres")).toEqual([
      "do $body$ begin perform 1; end $body$",
      "select 2",
    ]);
    expect(texts("select $a$ x; $b$ y; $b$ z; $a$; select 2", "postgres")).toEqual([
      "select $a$ x; $b$ y; $b$ z; $a$",
      "select 2",
    ]);
  });

  it("タグは大文字と小文字を区別し、_ と数字と日本語も使える", () => {
    expect(texts("select $A$ ; $a$ ; $A$; select 2", "postgres")).toEqual([
      "select $A$ ; $a$ ; $A$",
      "select 2",
    ]);
    expect(texts("select $_t1$ ; $_t1$; select $語$ ; $語$", "postgres")).toEqual([
      "select $_t1$ ; $_t1$",
      "select $語$ ; $語$",
    ]);
  });

  it("閉じていないドル引用は、末尾まで 1 つの文にする", () => {
    expect(texts("select $$ abc; select 2", "postgres")).toEqual(["select $$ abc; select 2"]);
  });

  it("$1 のようなパラメータはドル引用ではない", () => {
    expect(texts("select $1; select $2", "postgres")).toEqual(["select $1", "select $2"]);
  });

  it("識別子の途中にある $ は、ドル引用の開始ではない", () => {
    expect(texts("select foo$$bar; select 2", "postgres")).toEqual(["select foo$$bar", "select 2"]);
    expect(texts("select a$b$c; select 2", "postgres")).toEqual(["select a$b$c", "select 2"]);
  });

  it("ドル引用の中の引用符やコメントの開始は無視する", () => {
    expect(texts("select $$ it's -- /* \" $$; select 2", "postgres")).toEqual([
      "select $$ it's -- /* \" $$",
      "select 2",
    ]);
  });

  it("SQLite には無いので、$$ の中の ; でも区切る", () => {
    expect(texts("select $$a; b$$", "sqlite")).toEqual(["select $$a", "b$$"]);
    expect(texts("select $$a; b$$", "postgres")).toEqual(["select $$a; b$$"]);
  });
});

describe("splitStatements: PostgreSQL の文字列とコメント", () => {
  it("E'...' では \\' が引用符のエスケープになる", () => {
    expect(texts(String.raw`select E'it\'s;'; select 2`, "postgres")).toEqual([
      String.raw`select E'it\'s;'`,
      "select 2",
    ]);
    expect(texts(String.raw`select e'a\\'; select 2`, "postgres")).toEqual([
      String.raw`select e'a\\'`,
      "select 2",
    ]);
  });

  it("普通の '...' では \\ は特別な意味を持たない", () => {
    expect(texts(String.raw`select 'a\'; select 2`, "postgres")).toEqual([
      String.raw`select 'a\'`,
      "select 2",
    ]);
  });

  it("識別子の末尾の e の直後の ' は E 文字列ではない", () => {
    expect(texts(String.raw`select name'a\'; select 2`, "postgres")).toEqual([
      String.raw`select name'a\'`,
      "select 2",
    ]);
  });

  it("SQLite には E 文字列が無い", () => {
    expect(texts(String.raw`select E'a\';b'; select 2`, "sqlite")).toEqual([
      String.raw`select E'a\'`,
      "b'; select 2",
    ]);
    expect(texts(String.raw`select E'a\';b'; select 2`, "postgres")).toEqual([
      String.raw`select E'a\';b'`,
      "select 2",
    ]);
  });

  it("ブロックコメントは入れ子にできる", () => {
    expect(texts("select /* a /* ; */ ; */ 1; select 2", "postgres")).toEqual([
      "select /* a /* ; */ ; */ 1",
      "select 2",
    ]);
  });

  it("SQLite のブロックコメントは入れ子にならず、最初の */ で終わる", () => {
    expect(texts("select /* a /* ; */ ; */ 1; select 2", "sqlite")).toEqual([
      "select /* a /* ; */",
      "*/ 1",
      "select 2",
    ]);
  });

  it("行コメントは \\r でも終わる", () => {
    expect(texts("select 1 -- c\r; select 2", "postgres")).toEqual(["select 1 -- c", "select 2"]);
  });

  it("[ ] は配列の添字で、引用符ではない", () => {
    expect(texts("select a[1]; select b[2]", "postgres")).toEqual(["select a[1]", "select b[2]"]);
  });

  it("begin; ... commit は 3 つの文", () => {
    expect(texts("begin; select 1; commit", "postgres")).toEqual(["begin", "select 1", "commit"]);
  });
});

describe("splitStatements: SQLite の識別子とトリガー", () => {
  it("[ ] と ` ` で囲んだ識別子の中の ; では区切らない", () => {
    expect(texts("select [a;b] from t; select 2", "sqlite")).toEqual([
      "select [a;b] from t",
      "select 2",
    ]);
    expect(texts("select `a;b` from t; select 2", "sqlite")).toEqual([
      "select `a;b` from t",
      "select 2",
    ]);
    expect(texts("select `a``;b` from t; select 2", "sqlite")).toEqual([
      "select `a``;b` from t",
      "select 2",
    ]);
  });

  const trigger =
    "create trigger tr after insert on a begin insert into b values (1); update c set x = 1; end";

  it("CREATE TRIGGER の本体の ; では区切らず、END; で文が終わる", () => {
    expect(texts(`${trigger}; select 2`, "sqlite")).toEqual([trigger, "select 2"]);
  });

  it.each([
    ["大文字", "CREATE TRIGGER tr AFTER INSERT ON a BEGIN SELECT 1; END"],
    ["TEMP", "create temp trigger tr after insert on a begin select 1; end"],
    ["TEMPORARY", "create temporary trigger tr after insert on a begin select 1; end"],
    ["IF NOT EXISTS", "create trigger if not exists tr after insert on a begin select 1; end"],
    [
      "本体の CASE ... END",
      "create trigger tr after insert on a begin update c set x = case when 1 then 2 end; end",
    ],
    [
      "本体のコメントの中の end",
      "create trigger tr after insert on a begin select 1; /* end; */ end",
    ],
  ])("トリガーの本体を 1 つの文にする（%s）", (_label, sql) => {
    expect(texts(`${sql}; select 2`, "sqlite")).toEqual([sql, "select 2"]);
  });

  it("END で終わっていないトリガーは、末尾まで 1 つの文にする", () => {
    const sql = "create trigger tr after insert on a begin select 1; select 2;";
    expect(texts(sql, "sqlite")).toEqual([sql]);
  });

  it("トリガーではない文は、end や trigger という名前があっても普通に区切る", () => {
    expect(texts("select 1 as end; select 2", "sqlite")).toEqual(["select 1 as end", "select 2"]);
    expect(texts("create table trigger_log (x); select 2", "sqlite")).toEqual([
      "create table trigger_log (x)",
      "select 2",
    ]);
    expect(texts("begin; select 1; end; select 2", "sqlite")).toEqual([
      "begin",
      "select 1",
      "end",
      "select 2",
    ]);
  });

  it("explain の後ろでも、同じ規則で区切る", () => {
    expect(texts("explain select 1; select 2", "sqlite")).toEqual(["explain select 1", "select 2"]);
  });

  it("PostgreSQL では CREATE TRIGGER の特別扱いはしない", () => {
    expect(
      texts("create trigger t after insert on a begin select 1; end; select 2", "postgres"),
    ).toEqual(["create trigger t after insert on a begin select 1", "end", "select 2"]);
  });
});

describe.each(dialects)("statementAt（%s）", (dialect) => {
  const two = "select 1;\nselect 2;";
  // 位置: "select 1;" は 0..8（; は 8）、改行が 9、"select 2" は 10..17、; は 18、末尾は 19

  it("カーソルがある文を { from, to, text } で返す", () => {
    expect(statementAt(two, 3, dialect)).toEqual({ from: 0, to: 8, text: "select 1" });
    expect(statementAt(two, 14, dialect)).toEqual({ from: 10, to: 18, text: "select 2" });
  });

  it("文の先頭・末尾・終端の ; の直前でも、その文を選ぶ", () => {
    expect(statementAt(two, 0, dialect)?.text).toBe("select 1");
    expect(statementAt(two, 8, dialect)?.text).toBe("select 1");
    expect(statementAt(two, 10, dialect)?.text).toBe("select 2");
    expect(statementAt(two, 18, dialect)?.text).toBe("select 2");
  });

  it("; の直後にカーソルがあるときは、その ; で終わった文を選ぶ", () => {
    expect(statementAt(two, 9, dialect)?.text).toBe("select 1");
    expect(statementAt(two, 19, dialect)?.text).toBe("select 2");
    expect(statementAt("select 1;select 2", 9, dialect)?.text).toBe("select 1");
    expect(statementAt("select 1;select 2", 10, dialect)?.text).toBe("select 2");
  });

  it("文と文の間の空行にあるカーソルは、次の文を選ぶ", () => {
    expect(statementAt("select 1;\n\n\nselect 2", 11, dialect)?.text).toBe("select 2");
  });

  it("文の前のコメントの上にあるカーソルは、その文を選ぶ", () => {
    const sql = "select 1;\n-- the second\nselect 2";
    expect(statementAt(sql, 15, dialect)).toEqual({
      from: 10,
      to: sql.length,
      text: "-- the second\nselect 2",
    });
  });

  it("文字列・コメントの中の ; をまたいでも、1 つの文を返す", () => {
    const sql = "select 'a;b', 2; select 3";
    expect(statementAt(sql, 10, dialect)?.text).toBe("select 'a;b', 2");
    const commented = "select 1 /* ; */ + 2; select 3";
    expect(statementAt(commented, 14, dialect)?.text).toBe("select 1 /* ; */ + 2");
  });

  it.each([
    ["空文字", ""],
    ["空白だけ", "  \n "],
    ["コメントだけ", "-- hello\n/* world */"],
    ["; だけ", ";"],
  ])("%s なら、どこにカーソルがあっても null", (_label, sql) => {
    for (let cursor = 0; cursor <= sql.length; cursor++) {
      expect(statementAt(sql, cursor, dialect)).toBeNull();
    }
  });

  it("最後の文の後ろの空行やコメントの上では、何も選ばない（直前の文を黙って再実行しない）", () => {
    expect(statementAt("select 1;\n\n", 11, dialect)).toBeNull();
    expect(statementAt("select 1; -- done", 15, dialect)).toBeNull();
    expect(statementAt("select 1;\n\n", 9, dialect)?.text).toBe("select 1");
  });

  it("範囲外のカーソルは、先頭と末尾に丸める", () => {
    expect(statementAt(two, -5, dialect)?.text).toBe("select 1");
    expect(statementAt(two, 9999, dialect)?.text).toBe("select 2");
  });

  it("; で終わらない最後の文も選べる", () => {
    expect(statementAt("select 1; select 2", 18, dialect)?.text).toBe("select 2");
  });
});

describe("statementAt: 方言ごとの本体", () => {
  it("PostgreSQL のドル引用の本体のどこにカーソルがあっても、関数全体を返す", () => {
    const sql =
      "create function f() returns int as $$ select 1; select 2; $$ language sql; select 3";
    const wholeFunction = sql.slice(0, sql.indexOf("; select 3"));
    expect(statementAt(sql, sql.indexOf("select 2"), "postgres")?.text).toBe(wholeFunction);
    expect(statementAt(sql, sql.indexOf("select 3") + 2, "postgres")?.text).toBe("select 3");
  });

  it("SQLite のトリガーの本体のどこにカーソルがあっても、トリガー全体を返す", () => {
    const trigger = "create trigger tr after insert on a begin update c set x = 1; end";
    const sql = `${trigger}; select 2`;
    expect(statementAt(sql, sql.indexOf("update"), "sqlite")?.text).toBe(trigger);
  });
});

describe.each(dialects)("hasMultipleStatements（%s）", (dialect) => {
  it.each([
    ["1 文", "select 1"],
    ["1 文と終端の ;", "select 1;"],
    ["; が続くだけ", "select 1;;;"],
    ["後ろに空白だけ", "select 1;  \n "],
    ["後ろにコメントだけ", "select 1; -- done"],
    ["後ろにブロックコメントだけ", "select 1; /* done */"],
    ["先頭の ;", ";select 1"],
    ["空", ""],
    ["文字列の中の ;", "select ';'"],
    ["コメントの中の ;", "select 1 -- ; select 2"],
    ["ブロックコメントの中の ;", "select 1 /* ; select 2 */"],
    ["引用符付き識別子の中の ;", 'select "a;b" from t'],
  ])("%s は false", (_label, sql) => {
    expect(hasMultipleStatements(sql, dialect)).toBe(false);
  });

  it.each([
    ["2 文", "select 1; select 2"],
    ["終端の ; と 2 文目", "select 1;\n\n  select 2;"],
    ["トランザクションを抜ける文", "commit; delete from t"],
    ["コメントを挟んだ 2 文", "select 1; /* x */ select 2"],
    ["3 文", "select 1; select 2; select 3"],
  ])("%s は true", (_label, sql) => {
    expect(hasMultipleStatements(sql, dialect)).toBe(true);
  });
});

describe("hasMultipleStatements: 方言ごとの本体", () => {
  it("PostgreSQL のドル引用の本体の ; は 2 文目ではない", () => {
    expect(hasMultipleStatements("do $$ begin perform 1; perform 2; end $$", "postgres")).toBe(
      false,
    );
    expect(hasMultipleStatements("do $$ begin perform 1; end $$; select 1", "postgres")).toBe(true);
  });

  it("SQLite のトリガーの本体の ; は 2 文目ではない", () => {
    const trigger = "create trigger tr after insert on a begin select 1; select 2; end";
    expect(hasMultipleStatements(trigger, "sqlite")).toBe(false);
    expect(hasMultipleStatements(`${trigger}; select 3`, "sqlite")).toBe(true);
  });
});
