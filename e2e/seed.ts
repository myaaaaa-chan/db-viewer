// SQLite と PostgreSQL に同じ初期データを入れる。E2E の期待値はここから決まる。
export const USER_COUNT = 250;

export const userEmail = (id: number) => `user${id}@example.com`;

const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;

// display_name は 10 の倍数の行だけ NULL にして、NULL の表示を確かめられるようにする
const userRows = Array.from({ length: USER_COUNT }, (_, index) => {
  const id = index + 1;
  const name = id % 10 === 0 ? "NULL" : sqlString(`User ${id}`);
  return `(${id}, ${sqlString(userEmail(id))}, ${name})`;
});

const orderRows = Array.from({ length: 30 }, (_, index) => {
  const id = index + 1;
  return `(${id}, ${id}, ${id * 100})`;
});

export const SEED_SQL = [
  `CREATE TABLE users (id integer PRIMARY KEY, email text NOT NULL, display_name text)`,
  `CREATE TABLE orders (id integer PRIMARY KEY, user_id integer NOT NULL REFERENCES users (id), total integer NOT NULL)`,
  `INSERT INTO users (id, email, display_name) VALUES ${userRows.join(", ")}`,
  `INSERT INTO orders (id, user_id, total) VALUES ${orderRows.join(", ")}`,
  `CREATE VIEW active_users AS SELECT id, email FROM users WHERE id <= 10`,
];
