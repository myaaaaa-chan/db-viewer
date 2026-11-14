import type { Dialect } from "@myaaaaa_chan/db-viewer-core";

// 方言で書き方が違うのは、型の名前とバイナリのリテラルだけ。表の形と値は同じにして、期待値を共通にする。
const int = (dialect: Dialect) => (dialect === "postgres" ? "integer" : "INTEGER");
const bigint = (dialect: Dialect) => (dialect === "postgres" ? "bigint" : "INTEGER");
const blobType = (dialect: Dialect) => (dialect === "postgres" ? "bytea" : "BLOB");
const blobLiteral = (dialect: Dialect, hex: string) =>
  dialect === "postgres" ? `'\\x${hex}'::bytea` : `x'${hex}'`;

export const seedStatements = (dialect: Dialect): ReadonlyArray<string> => [
  `CREATE TABLE users (
    id ${int(dialect)} PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    age ${int(dialect)},
    status TEXT NOT NULL DEFAULT 'active'
  )`,
  `CREATE UNIQUE INDEX users_email_idx ON users (email)`,
  `INSERT INTO users (id, name, email, age, status) VALUES
    (1, 'alice', 'alice@example.com', 30, 'active'),
    (2, 'bob', NULL, NULL, 'inactive'),
    (3, 'carol', '', 41, 'active')`,
  `CREATE VIEW adults AS SELECT id, name FROM users WHERE age >= 18`,

  `CREATE TABLE orders (
    id ${int(dialect)} PRIMARY KEY,
    user_id ${int(dialect)} NOT NULL REFERENCES users (id),
    note TEXT
  )`,
  `CREATE INDEX orders_user_id_idx ON orders (user_id)`,
  `INSERT INTO orders (id, user_id, note) VALUES (1, 1, 'first'), (2, 1, NULL)`,

  `CREATE TABLE numbers (id ${int(dialect)} PRIMARY KEY, big ${bigint(dialect)})`,
  `INSERT INTO numbers (id, big) VALUES
    (1, 9007199254740993), (2, 9223372036854775807), (3, -9007199254740993)`,

  `CREATE TABLE docs (id ${int(dialect)} PRIMARY KEY, body TEXT)`,
  `INSERT INTO docs (id, body) VALUES
    (1, 'abcdefghijKLMNOP'),
    (2, 'abcdefghij'),
    (3, 'あいうえおかきくけこさ'),
    (4, '😀😀😀😀😀😀'),
    (5, ''),
    (6, NULL)`,

  `CREATE TABLE blobs (id ${int(dialect)} PRIMARY KEY, data ${blobType(dialect)})`,
  `INSERT INTO blobs (id, data) VALUES
    (1, ${blobLiteral(dialect, "0aff112233")}),
    (2, ${blobLiteral(dialect, "")}),
    (3, NULL)`,

  `CREATE TABLE many (id ${int(dialect)} PRIMARY KEY)`,
  `INSERT INTO many (id) VALUES ${Array.from({ length: 25 }, (_, i) => `(${i + 1})`).join(", ")}`,

  `CREATE TABLE composite (
    a ${int(dialect)} NOT NULL,
    b TEXT NOT NULL,
    label TEXT,
    PRIMARY KEY (a, b)
  )`,
  `INSERT INTO composite (a, b, label) VALUES (1, 'x', 'one-x'), (1, 'y', 'one-y'), (2, 'x', 'two-x')`,

  `CREATE TABLE no_pk (v TEXT)`,
  `INSERT INTO no_pk (v) VALUES ('a'), ('a')`,

  `CREATE TABLE "odd""table" ("col""x" ${int(dialect)} PRIMARY KEY, "select" TEXT)`,
  `INSERT INTO "odd""table" ("col""x", "select") VALUES (1, 'v')`,
];

// 同じ意味の文を方言ごとに書くもの。
export const sqlFor = (dialect: Dialect) => ({
  blobLiteral: (hex: string) => blobLiteral(dialect, hex),
  // 読み取り専用を解除しようとする文。実行した後でも、次の書き込みが拒否されなければならない。
  readOnlyEscapes:
    dialect === "postgres"
      ? ["SET TRANSACTION READ WRITE", "SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE"]
      : ["PRAGMA query_only = OFF"],
});
