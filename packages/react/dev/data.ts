import {
  type CellValue,
  columnName,
  err,
  ok,
  type QueryOutcome,
} from "@myaaaaa_chan/db-viewer-core";
import {
  createMemoryDataSource,
  type MemoryExecute,
  memoryTable,
} from "@myaaaaa_chan/db-viewer-core/testing";

// 確認用ページとスクリーンショットで使う、メモリ上の DataSource。表示のデザイン（Claude Design のキャンバス）と同じ顔ぶれにしてある。

const N = null;

const BIO = `{"bio": "${"バックエンドとデータ基盤を担当。PostgreSQL の運用、マイグレーションの設計、障害対応の手順書づくりに関わってきた。".repeat(200)}", "lang": "ja"}`;

const userRows: ReadonlyArray<ReadonlyArray<CellValue>> = [
  [
    "1",
    "aiko.tanaka@example.com",
    "田中 愛子",
    "member",
    "2026-11-14 08:41:09+09",
    '{"lang": "ja", "theme": "dark"}',
  ],
  ["4", "yuto.ito@example.com", "伊藤 悠斗", "member", "2026-11-13 22:17:45+09", BIO],
  ["7", "mika.suzuki@example.com", "", "member", "2026-11-13 19:02:31+09", N],
  [
    "12",
    "kenji.sato@example.com",
    "佐藤 健二",
    "member",
    "2026-11-12 09:15:40+09",
    '{"theme": "light"}',
  ],
  [
    "15",
    "nao.kobayashi@example.com",
    "小林 奈央",
    "member",
    "2026-11-11 17:58:02+09",
    '{"lang": "en"}',
  ],
  ["18", "riku.yamamoto@example.com", N, "member", "2026-11-10 12:30:00+09", N],
  [
    "21",
    "sora.nakamura@example.com",
    "中村 空",
    "member",
    "2026-11-09 08:05:51+09",
    '{"theme": "dark"}',
  ],
  ["26", "haruka.kato@example.com", "加藤 遥", "member", "2026-11-07 21:44:18+09", "{}"],
  [
    "30",
    "daiki.yoshida@example.com",
    "吉田 大輝",
    "member",
    "2026-11-05 15:20:39+09",
    '{"lang": "ja"}',
  ],
  ["33", "yui.yamada@example.com", "山田 結衣", "member", "2026-11-03 10:11:27+09", N],
  [
    "37",
    "sho.sasaki@example.com",
    "佐々木 翔",
    "member",
    "2026-11-01 23:59:01+09",
    '{"theme": "light"}',
  ],
  [
    "41",
    "emi.matsumoto@example.com",
    "松本 恵美",
    "member",
    "2026-10-29 07:36:44+09",
    '{"lang": "ja", "beta": true}',
  ],
  ["44", "ren.inoue@example.com", "井上 蓮", "member", "2026-10-27 18:12:09+09", N],
  ["48", "mio.kimura@example.com", "木村 美緒", "member", "2026-10-25 11:48:33+09", "{}"],
  [
    "52",
    "kaito.hayashi@example.com",
    "林 海斗",
    "member",
    "2026-10-21 14:03:17+09",
    '{"theme": "dark"}',
  ],
];

const users = memoryTable({
  name: "users",
  columns: [
    { name: "id", dbType: "bigint", primaryKeyPosition: 1 },
    { name: "email", dbType: "text", nullable: false },
    { name: "display_name", dbType: "varchar(80)" },
    { name: "role", dbType: "user_role", defaultValue: "'member'::user_role" },
    { name: "last_login_at", dbType: "timestamptz" },
    { name: "profile", dbType: "jsonb" },
  ],
  rows: userRows,
  ddl: `CREATE TABLE public.users (
  id bigint NOT NULL,
  email text NOT NULL,
  display_name character varying(80),
  role user_role DEFAULT 'member'::user_role,
  last_login_at timestamp with time zone,
  profile jsonb,
  PRIMARY KEY (id)
);`,
});

const simpleTable = (name: string, kind: "table" | "view" = "table") =>
  memoryTable({
    name,
    kind,
    columns: [
      { name: "id", dbType: "bigint", primaryKeyPosition: 1 },
      { name: "name", dbType: "text" },
    ],
    rows: Array.from({ length: 250 }, (_, i) => [String(i + 1), `${name} ${i + 1}`]),
  });

const sessionRows = (): ReadonlyArray<ReadonlyArray<CellValue>> => {
  const head: ReadonlyArray<readonly [string, string, string]> = [
    ["1", "aiko.tanaka@example.com", "214"],
    ["4", "yuto.ito@example.com", "187"],
    ["12", "kenji.sato@example.com", "163"],
    ["15", "nao.kobayashi@example.com", "150"],
    ["21", "sora.nakamura@example.com", "141"],
    ["26", "haruka.kato@example.com", "128"],
    ["30", "daiki.yoshida@example.com", "117"],
    ["33", "yui.yamada@example.com", "109"],
    ["37", "sho.sasaki@example.com", "96"],
    ["41", "emi.matsumoto@example.com", "88"],
    ["44", "ren.inoue@example.com", "81"],
    ["48", "mio.kimura@example.com", "73"],
    ["52", "kaito.hayashi@example.com", "66"],
    ["18", "riku.yamamoto@example.com", "58"],
    ["7", "mika.suzuki@example.com", "51"],
  ];
  const rest = Array.from({ length: 985 }, (_, i): [string, string, string] => [
    String(100 + i),
    `user${100 + i}@example.com`,
    String(50 - Math.floor(i / 20)),
  ]);
  return [...head, ...rest].map((row) => [...row]);
};

const execute: MemoryExecute = (connection, sql) => {
  if (/emial/i.test(sql)) {
    return err({
      kind: "query",
      message: 'column "emial" does not exist',
      sqlState: "42703",
      position: sql.toLowerCase().indexOf("emial"),
    });
  }
  if (/^\s*(insert|update|delete)/i.test(sql)) {
    if (connection.readOnly) {
      return err({
        kind: "readOnlyViolation",
        message: "cannot execute a write statement in a read-only transaction",
      });
    }
    return ok<QueryOutcome>({ kind: "command", affectedRows: 3, elapsedMs: 12 });
  }
  if (/sessions/i.test(sql)) {
    return ok<QueryOutcome>({
      kind: "rows",
      columns: [
        { name: "id", dbType: "int8" },
        { name: "email", dbType: "text" },
        { name: "sessions", dbType: "int8" },
      ],
      rows: sessionRows(),
      truncated: true,
      truncatedCells: [],
      elapsedMs: 128,
    });
  }
  return ok<QueryOutcome>({
    kind: "rows",
    columns: [{ name: "result", dbType: "int4" }],
    rows: [["1"]],
    truncated: false,
    truncatedCells: [],
    elapsedMs: 3,
  });
};

export const createDemoDataSource = () =>
  createMemoryDataSource({
    connections: [
      {
        name: "main",
        dialect: "postgres",
        readOnly: true,
        cancel: true,
        schemas: [
          {
            name: "public",
            tables: [
              ...[
                "order_items",
                "orders",
                "personas",
                "products",
                "scenarios",
                "sessions",
                "settings",
              ].map((name) => simpleTable(name)),
              users,
              simpleTable("active_users", "view"),
              simpleTable("recent_orders", "view"),
            ],
          },
          { name: "drizzle", tables: [simpleTable("__drizzle_migrations")] },
        ],
      },
      {
        name: "local",
        dialect: "sqlite",
        readOnly: false,
        cancel: false,
        schemas: [{ name: "main", tables: [simpleTable("notes")] }],
      },
    ],
    execute,
  });

export const demoColumn = columnName("id");
