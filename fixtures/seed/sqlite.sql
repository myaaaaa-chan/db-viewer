CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  age INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT '2026-01-01 09:00:00'
);

INSERT INTO users (id, name, email, age, status) VALUES
  (1, 'alice', 'alice@example.com', 30, 'active'),
  (2, 'bob', NULL, NULL, 'inactive'),
  (3, 'carol', 'carol@example.com', 41, 'active'),
  (4, 'dave', 'dave@example.com', 17, 'active');

CREATE VIEW adults AS SELECT id, name FROM users WHERE age >= 18;

CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id),
  total INTEGER NOT NULL,
  note TEXT
);

CREATE INDEX orders_user_id_idx ON orders (user_id);

INSERT INTO orders (id, user_id, total, note) VALUES
  (1, 1, 1200, 'first order'),
  (2, 1, 800, NULL),
  (3, 3, 4500, 'gift'),
  (4, 4, 300, NULL);
