import { schemaName, tableName } from "@myaaaaa_chan/db-viewer-core";
import { describe, expect, it } from "vitest";
import { placeholder, quoteIdentifier, quoteTable } from "./dialect";

describe("quoteIdentifier", () => {
  it.each(["postgres", "sqlite"] as const)("%s: 二重引用符で囲む", (dialect) => {
    expect(quoteIdentifier(dialect, "users")).toBe('"users"');
  });

  it.each(["postgres", "sqlite"] as const)(
    "%s: 識別子の中の二重引用符は 2 つ重ねて、SQL を閉じさせない",
    (dialect) => {
      expect(quoteIdentifier(dialect, 'a"b')).toBe('"a""b"');
      expect(quoteIdentifier(dialect, '"; DROP TABLE users; --')).toBe(
        '"""; DROP TABLE users; --"',
      );
    },
  );

  it.each(["postgres", "sqlite"] as const)(
    "%s: 空白・記号・日本語・予約語はそのまま囲むだけ",
    (dialect) => {
      expect(quoteIdentifier(dialect, "order by")).toBe('"order by"');
      expect(quoteIdentifier(dialect, "ユーザー.名")).toBe('"ユーザー.名"');
      expect(quoteIdentifier(dialect, "select")).toBe('"select"');
    },
  );

  it.each(["postgres", "sqlite"] as const)("%s: NUL 文字を含む名前は拒否する", (dialect) => {
    expect(() => quoteIdentifier(dialect, "a\0b")).toThrow(RangeError);
  });
});

describe("quoteTable", () => {
  it("スキーマとテーブルをそれぞれクォートして . でつなぐ", () => {
    const ref = { schema: schemaName("public"), name: tableName('we"ird') };
    expect(quoteTable("postgres", ref)).toBe('"public"."we""ird"');
    expect(quoteTable("sqlite", { schema: schemaName("main"), name: tableName("t") })).toBe(
      '"main"."t"',
    );
  });
});

describe("placeholder", () => {
  it("PostgreSQL は 1 始まりの $n", () => {
    expect(placeholder("postgres", 1)).toBe("$1");
    expect(placeholder("postgres", 12)).toBe("$12");
  });

  it("SQLite は位置に依らず ?", () => {
    expect(placeholder("sqlite", 1)).toBe("?");
    expect(placeholder("sqlite", 12)).toBe("?");
  });
});
