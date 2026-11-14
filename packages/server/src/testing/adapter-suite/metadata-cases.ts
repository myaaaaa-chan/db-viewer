import { columnName, schemaName, tableName } from "@myaaaaa_chan/db-viewer-core";
import { describe, expect, it } from "vitest";
import { errorOf, refOf, type SuiteContext, valueOf } from "./context";

export const metadataCases = ({ open }: SuiteContext) =>
  describe("メタデータ", () => {
    it("listSchemas は利用者のスキーマを含み、システムのスキーマを含まない", async () => {
      const { adapter, schema } = await open();
      const schemas = valueOf(await adapter.listSchemas());
      expect(schemas).toContain(schema);
      for (const system of ["pg_catalog", "information_schema", "pg_toast"]) {
        expect(schemas).not.toContain(system);
      }
    });

    it("listTables はテーブルとビューを kind 付きで返す", async () => {
      const { adapter, schema } = await open();
      const tables = valueOf(await adapter.listTables(schema));
      const kindOf = (name: string) => tables.find((t) => t.ref.name === name)?.kind;
      expect(kindOf("users")).toBe("table");
      expect(kindOf("orders")).toBe("table");
      expect(kindOf("adults")).toBe("view");
      expect(tables.every((t) => t.ref.schema === schema)).toBe(true);
    });

    it("存在しないスキーマの listTables は空", async () => {
      const { adapter } = await open();
      expect(valueOf(await adapter.listTables(schemaName("no_such_schema")))).toEqual([]);
    });

    it("getTableDetail: 列の型・NULL の可否・既定値・主キーの順番", async () => {
      const env = await open();
      const detail = valueOf(await env.adapter.getTableDetail(refOf(env, "users")));
      expect(detail.summary).toEqual({ ref: refOf(env, "users"), kind: "table" });
      expect(detail.columns.map((c) => c.name)).toEqual(["id", "name", "email", "age", "status"]);

      const column = (name: string) => detail.columns.find((c) => c.name === name);
      expect(column("id")).toMatchObject({ nullable: false, primaryKeyPosition: 1 });
      expect(column("id")?.dbType.toLowerCase()).toBe("integer");
      expect(column("name")).toMatchObject({ nullable: false, primaryKeyPosition: null });
      expect(column("name")?.dbType.toLowerCase()).toBe("text");
      expect(column("email")).toMatchObject({ nullable: true, defaultValue: null });
      expect(column("status")?.defaultValue).toContain("active");
    });

    it("getTableDetail: 複合主キーの順番と、主キーのインデックス", async () => {
      const env = await open();
      const detail = valueOf(await env.adapter.getTableDetail(refOf(env, "composite")));
      expect(detail.columns.map((c) => [c.name, c.primaryKeyPosition])).toEqual([
        ["a", 1],
        ["b", 2],
        ["label", null],
      ]);
      const primary = detail.indexes.filter((index) => index.primary);
      expect(primary).toHaveLength(1);
      expect(primary[0]).toMatchObject({ columns: ["a", "b"], unique: true });
    });

    it("getTableDetail: ユニークインデックスと外部キー", async () => {
      const env = await open();
      const users = valueOf(await env.adapter.getTableDetail(refOf(env, "users")));
      expect(users.indexes).toContainEqual({
        name: "users_email_idx",
        columns: ["email"],
        unique: true,
        primary: false,
      });

      const orders = valueOf(await env.adapter.getTableDetail(refOf(env, "orders")));
      expect(orders.indexes.find((i) => i.name === "orders_user_id_idx")).toMatchObject({
        columns: ["user_id"],
        unique: false,
      });
      expect(orders.foreignKeys).toHaveLength(1);
      expect(orders.foreignKeys[0]).toMatchObject({
        columns: [columnName("user_id")],
        references: { table: refOf(env, "users"), columns: [columnName("id")] },
      });
    });

    it("getTableDetail: DDL。PostgreSQL は近似、SQLite は保存された文そのもの", async () => {
      const env = await open();
      const detail = valueOf(await env.adapter.getTableDetail(refOf(env, "users")));
      expect(detail.ddl.text.toLowerCase()).toContain("create table");
      expect(detail.ddl.text).toContain("users");
      expect(detail.ddl.approximate).toBe(env.adapter.dialect === "postgres");
    });

    it("getTableDetail: ビューは kind が view で、インデックスと外部キーがない", async () => {
      const env = await open();
      const detail = valueOf(await env.adapter.getTableDetail(refOf(env, "adults")));
      expect(detail.summary.kind).toBe("view");
      expect(detail.columns.map((c) => c.name)).toEqual(["id", "name"]);
      expect(detail.indexes).toEqual([]);
      expect(detail.foreignKeys).toEqual([]);
    });

    it("getTableDetail: 存在しないテーブルとスキーマは tableNotFound", async () => {
      const env = await open();
      const missing = { schema: env.schema, name: tableName("no_such_table") };
      expect(errorOf(await env.adapter.getTableDetail(missing))).toEqual({
        kind: "tableNotFound",
        table: missing,
      });
      const otherSchema = { schema: schemaName("no_such_schema"), name: tableName("users") };
      expect(errorOf(await env.adapter.getTableDetail(otherSchema)).kind).toBe("tableNotFound");
    });
  });
