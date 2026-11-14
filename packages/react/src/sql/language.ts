import { PostgreSQL, SQLite, sql } from "@codemirror/lang-sql";
import type { Extension } from "@codemirror/state";
import type { Dialect } from "@myaaaaa_chan/db-viewer-core";
import type { SqlNamespace } from "../lib/sql-schema";

const DIALECTS = { postgres: PostgreSQL, sqlite: SQLite } as const;

// 方言のハイライトと、読み込み済みのテーブル・カラムによる補完。
export const sqlLanguage = (
  dialect: Dialect,
  schema: SqlNamespace,
  defaultSchema: string | null,
): Extension =>
  sql({
    dialect: DIALECTS[dialect],
    schema,
    ...(defaultSchema ? { defaultSchema } : {}),
    upperCaseKeywords: true,
  });
