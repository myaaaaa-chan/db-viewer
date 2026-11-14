import { columnName, schemaName, tableName } from "@myaaaaa_chan/db-viewer-core";
import { describe, expect, it } from "vitest";
import {
  buildDdl,
  type ColumnRow,
  columnRowFromRow,
  foreignKeysFromRows,
  indexesFromRows,
  kindOfRelation,
  toColumnInfo,
} from "./catalog";

const ref = { schema: schemaName("public"), name: tableName("users") };

const column = (overrides: Partial<ColumnRow> & Pick<ColumnRow, "name" | "dbType">): ColumnRow => ({
  notNull: false,
  defaultExpr: null,
  identity: "",
  generated: null,
  primaryKeyPosition: null,
  ...overrides,
});

describe("columnRowFromRow", () => {
  it("カタログの 1 行（すべて文字列）を、型のついた列にする", () => {
    expect(columnRowFromRow(["status", "text", "t", "'active'::text", "", "", null])).toEqual(
      column({ name: "status", dbType: "text", notNull: true, defaultExpr: "'active'::text" }),
    );
    expect(columnRowFromRow(["id", "integer", "t", null, "d", "", "1"])).toEqual(
      column({
        name: "id",
        dbType: "integer",
        notNull: true,
        identity: "d",
        primaryKeyPosition: 1,
      }),
    );
    expect(columnRowFromRow(["total", "integer", "f", "(a + b)", "", "s", null])).toEqual(
      column({ name: "total", dbType: "integer", defaultExpr: "(a + b)", generated: "stored" }),
    );
    expect(columnRowFromRow(["v", "integer", "f", "(a * 2)", "", "v", null])).toEqual(
      column({ name: "v", dbType: "integer", defaultExpr: "(a * 2)", generated: "virtual" }),
    );
  });
});

describe("toColumnInfo", () => {
  it("NULL の可否は NOT NULL の反対。既定値の式はそのまま持つ", () => {
    expect(
      toColumnInfo(
        column({ name: "status", dbType: "text", notNull: true, defaultExpr: "'a'::text" }),
      ),
    ).toEqual({
      name: columnName("status"),
      dbType: "text",
      nullable: false,
      defaultValue: "'a'::text",
      primaryKeyPosition: null,
    });
  });

  it("生成列の式と、IDENTITY 列は、既定値として見せない", () => {
    expect(
      toColumnInfo(
        column({ name: "t", dbType: "integer", defaultExpr: "(a + b)", generated: "stored" }),
      ).defaultValue,
    ).toBeNull();
    expect(
      toColumnInfo(column({ name: "id", dbType: "integer", identity: "a" })).defaultValue,
    ).toBeNull();
  });
});

describe("kindOfRelation", () => {
  it.each([
    ["r", "table"],
    ["p", "table"],
    ["f", "table"],
    ["v", "view"],
    ["m", "view"],
  ] as const)("relkind %s は %s", (relkind, kind) => {
    expect(kindOfRelation(relkind)).toBe(kind);
  });
});

describe("indexesFromRows", () => {
  it("同じインデックスの行を、キーの順に 1 つにまとめる。主キーが先頭", () => {
    const rows = [
      ["users_pkey", "t", "t", "1", "tenant_id"],
      ["users_pkey", "t", "t", "2", "id"],
      ["users_email_idx", "t", "f", "1", "email"],
      ["users_lower_idx", "f", "f", "1", "lower(name)"],
      ["users_lower_idx", "f", "f", "2", "age"],
    ];
    expect(indexesFromRows(rows)).toEqual([
      { name: "users_pkey", columns: ["tenant_id", "id"], unique: true, primary: true },
      { name: "users_email_idx", columns: ["email"], unique: true, primary: false },
      { name: "users_lower_idx", columns: ["lower(name)", "age"], unique: false, primary: false },
    ]);
  });

  it("行がなければ空", () => {
    expect(indexesFromRows([])).toEqual([]);
  });
});

describe("foreignKeysFromRows", () => {
  it("複合の外部キーは、列の組を順に 1 つにまとめる", () => {
    const rows = [
      ["orders_user_fk", "1", "tenant_id", "public", "users", "tenant_id"],
      ["orders_user_fk", "2", "user_id", "public", "users", "id"],
      ["orders_item_fk", "1", "item_id", "shop", "items", "id"],
    ];
    expect(foreignKeysFromRows(rows)).toEqual([
      {
        name: "orders_user_fk",
        columns: [columnName("tenant_id"), columnName("user_id")],
        references: {
          table: { schema: schemaName("public"), name: tableName("users") },
          columns: [columnName("tenant_id"), columnName("id")],
        },
      },
      {
        name: "orders_item_fk",
        columns: [columnName("item_id")],
        references: {
          table: { schema: schemaName("shop"), name: tableName("items") },
          columns: [columnName("id")],
        },
      },
    ]);
  });
});

describe("buildDdl", () => {
  it("テーブル: 列・制約・（制約に使われない）インデックスの順に、識別子は引用符で囲む", () => {
    const ddl = buildDdl({
      ref,
      relkind: "r",
      columns: [
        column({ name: "id", dbType: "integer", notNull: true, primaryKeyPosition: 1 }),
        column({ name: "name", dbType: "character varying(255)", notNull: true }),
        column({ name: "status", dbType: "text", notNull: true, defaultExpr: "'active'::text" }),
        column({ name: "note", dbType: "text" }),
      ],
      constraints: [
        { name: "users_pkey", definition: "PRIMARY KEY (id)" },
        { name: "users_org_fk", definition: "FOREIGN KEY (org) REFERENCES orgs(id)" },
      ],
      indexDefinitions: ["CREATE INDEX users_name_idx ON public.users USING btree (name)"],
      viewDefinition: null,
    });
    expect(ddl).toBe(
      [
        'CREATE TABLE "public"."users" (',
        '  "id" integer NOT NULL,',
        '  "name" character varying(255) NOT NULL,',
        `  "status" text DEFAULT 'active'::text NOT NULL,`,
        '  "note" text,',
        '  CONSTRAINT "users_pkey" PRIMARY KEY (id),',
        '  CONSTRAINT "users_org_fk" FOREIGN KEY (org) REFERENCES orgs(id)',
        ");",
        "",
        "CREATE INDEX users_name_idx ON public.users USING btree (name);",
      ].join("\n"),
    );
  });

  it("生成列と IDENTITY 列は、それが分かる形で書く", () => {
    const ddl = buildDdl({
      ref,
      relkind: "r",
      columns: [
        column({ name: "id", dbType: "bigint", notNull: true, identity: "a" }),
        column({ name: "n", dbType: "integer", notNull: true, identity: "d" }),
        column({ name: "total", dbType: "integer", defaultExpr: "(a + b)", generated: "stored" }),
        column({ name: "half", dbType: "integer", defaultExpr: "(a / 2)", generated: "virtual" }),
      ],
      constraints: [],
      indexDefinitions: [],
      viewDefinition: null,
    });
    expect(ddl).toContain('"id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL');
    expect(ddl).toContain('"n" integer GENERATED BY DEFAULT AS IDENTITY NOT NULL');
    expect(ddl).toContain('"total" integer GENERATED ALWAYS AS ((a + b)) STORED');
    expect(ddl).toContain('"half" integer GENERATED ALWAYS AS ((a / 2)) VIRTUAL');
  });

  it("列も制約もないテーブル", () => {
    expect(
      buildDdl({
        ref,
        relkind: "r",
        columns: [],
        constraints: [],
        indexDefinitions: [],
        viewDefinition: null,
      }),
    ).toBe('CREATE TABLE "public"."users" ();');
  });

  it("ビュー: pg_get_viewdef の結果をそのまま使う", () => {
    const ddl = buildDdl({
      ref: { schema: schemaName("public"), name: tableName("adults") },
      relkind: "v",
      columns: [],
      constraints: [],
      indexDefinitions: [],
      viewDefinition: " SELECT users.id\n   FROM users;",
    });
    expect(ddl).toBe('CREATE VIEW "public"."adults" AS\nSELECT users.id\n   FROM users;');
  });

  it("マテリアライズドビューは、インデックスも書く", () => {
    const ddl = buildDdl({
      ref,
      relkind: "m",
      columns: [],
      constraints: [],
      indexDefinitions: ["CREATE INDEX m_idx ON public.users USING btree (id)"],
      viewDefinition: " SELECT 1 AS id;",
    });
    expect(ddl).toBe(
      'CREATE MATERIALIZED VIEW "public"."users" AS\nSELECT 1 AS id;\n\nCREATE INDEX m_idx ON public.users USING btree (id);',
    );
  });
});
