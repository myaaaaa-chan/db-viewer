import { schemaName, type TableRef, tableName } from "@myaaaaa_chan/db-viewer-core";
import { describe, expect, it } from "vitest";
import { buildSqlSchema, referencedTables } from "./sql-schema";

const ref = (schema: string, name: string): TableRef => ({
  schema: schemaName(schema),
  name: tableName(name),
});
const tables = [ref("public", "users"), ref("public", "orders"), ref("audit", "users")];

describe("buildSqlSchema", () => {
  it("スキーマ → テーブル → カラム名の入れ子にする。カラムが未取得のテーブルは空の配列にする", () => {
    const schema = buildSqlSchema(tables, {
      [JSON.stringify(["public", "users"])]: ["id", "email"],
    });
    expect(schema).toEqual({
      public: { users: ["id", "email"], orders: [] },
      audit: { users: [] },
    });
  });

  it("テーブルがなければ空にする", () => {
    expect(buildSqlSchema([], {})).toEqual({});
  });
});

describe("referencedTables", () => {
  it("SQL に書かれた名前に一致するテーブルを返す（大文字小文字は区別しない）", () => {
    expect(
      referencedTables("SELECT * FROM Users u JOIN orders o ON o.user_id = u.id", tables),
    ).toEqual([ref("public", "users"), ref("public", "orders"), ref("audit", "users")]);
  });

  it("引用符付きの名前や、スキーマ付きの名前も見つける", () => {
    expect(referencedTables('SELECT 1 FROM audit."orders"', tables)).toEqual([
      ref("public", "orders"),
    ]);
  });

  it("一致しなければ空にする。単語の一部には一致させない", () => {
    expect(referencedTables("SELECT users_count FROM stats", tables)).toEqual([]);
  });

  it("同じテーブルは 1 回だけ返す", () => {
    expect(referencedTables("users users users", [ref("public", "users")])).toEqual([
      ref("public", "users"),
    ]);
  });
});
