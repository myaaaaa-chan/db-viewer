# db-viewer

DBeaver のような DB 閲覧 UI（テーブルのツリー、フィルタとページ送り付きのデータ表、簡易的な SQL エディタ）を、Web アプリに組み込むための npm ライブラリです。
自分のアプリに組み込む使い方と、データベースを指定して `npx` で起動する使い方があります。

[English](./README.md) | 日本語

| パッケージ                       | 役割                                               |
| -------------------------------- | -------------------------------------------------- |
| `@myaaaaa_chan/db-viewer-react`  | `<DbViewer>` コンポーネントと部品                  |
| `@myaaaaa_chan/db-viewer-server` | fetch ハンドラと、PostgreSQL / SQLite のアダプター |
| `@myaaaaa_chan/db-viewer-core`   | ほかの 3 つが共有する型と、HTTP 版の `DataSource`  |
| `@myaaaaa_chan/db-viewer-cli`    | 1 つ以上の DB を指定して開く `npx` コマンド        |

4 つのパッケージは常に同じバージョンです。すべて同じ番号を入れてください。
対象は Node.js 20 以上、React 18 / 19 です。配布は ESM のみです。

## まずセキュリティ

このビューアは、利用者が入力した**任意の SQL** を実行します。組み込む前に読んでください。

- `authorize` は必須です。省略するとハンドラを作れません。全員に許可してよい場合だけ `() => true` と明示してください。
- 信頼できないユーザーには公開しないでください。
- `readOnly` は初期値で `true` です。これは守りの 1 つで、最後の砦ではありません。必要な権限だけを持つ DB ユーザーで接続してください。
- ビューア専用の小さな Pool を渡してください（目安は `max` を `maxConcurrentQueries + 1` 程度）。長いクエリが、アプリの接続を使い切らないようにするためです。
- SQLite は、実行中の文を止められません（`statementTimeoutMs` は効きません）。重いクエリはプロセス全体を止めます。専用のインスタンスを渡し、できれば読み取り専用で開いてください。

DB ごとの詳しい注意は [packages/server/README.md](./packages/server/README.md)（英語）にあります。

## CLI で始める

```sh
# PostgreSQL。シェルの履歴にパスワードを残さないよう、環境変数で渡します
DATABASE_URL=postgres://user:pass@localhost:5432/app npx @myaaaaa_chan/db-viewer-cli

# SQLite
npx @myaaaaa_chan/db-viewer-cli ./app.db

# 複数の接続に名前を付ける。書き込みも許可する
npx @myaaaaa_chan/db-viewer-cli --name main=postgres://... --name cache=./cache.sqlite --write
```

Node.js 22 以上で動きます。コマンド名は `db-viewer` です。起動時にまず接続を確かめ（PostgreSQL では `SELECT 1`）、`http://127.0.0.1:51234/#token=...` のような URL を表示して開きます。Ctrl+C で止めます。
`127.0.0.1` だけで待ち受け、ランダムなトークンで API を守ります。トークンは URL のフラグメントで渡します。この URL を知っている人は、DB ユーザーの権限で SQL を実行できます。共有しないでください。

| 引数                     | 説明                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `<接続先>...`            | `postgres://` か `postgresql://` の URL、または `.db` / `.sqlite` / `.sqlite3` のファイル |
| `--name <名前>=<接続先>` | 接続に名前を付ける。何度でも指定できる                                                    |
| `DATABASE_URL`           | 接続先を 1 つも指定しなかったときに使う                                                   |
| `--write`                | すべての接続で書き込みを許可する（初期値は読み取り専用）                                  |
| `--port <番号>`          | 待ち受けるポート。指定しなければ空いているポート                                          |
| `--no-open`              | ブラウザを自動で開かない                                                                  |

## アプリに組み込む

サーバーにハンドラを置き、フロントエンドに `<DbViewer>` を置きます。

```ts
// サーバー
import { createHandler, sqliteAdapter } from "@myaaaaa_chan/db-viewer-server";

const handler = createHandler({
  connections: { main: sqliteAdapter(db) },
  authorize: async (request) => isAdmin(await getSession(request)),
});
```

```tsx
// クライアント
import { createHttpDataSource, DbViewer } from "@myaaaaa_chan/db-viewer-react";
import "@myaaaaa_chan/db-viewer-react/styles.css";

const dataSource = createHttpDataSource({ endpoint: "/admin/db" });

export const Page = () => (
  <div style={{ height: "100vh" }}>
    <DbViewer dataSource={dataSource} />
  </div>
);
```

親の要素には高さを与えてください。ビューアは親いっぱいに広がります。

### Hono

[examples/hono](./examples/hono) に、Hono・SQLite・Vite の動く例があります。

```ts
app.post("/admin/db", (c) => handler(c.req.raw));
```

### Next.js（App Router）

[examples/next](./examples/next) に動く例があります。

```ts
// app/admin/db/route.ts
export const POST = handler;
```

```tsx
// app/admin/viewer.tsx。コンポーネントはブラウザで動くので、先頭に "use client" を書きます
"use client";
import "@myaaaaa_chan/db-viewer-react/styles.css";
```

`better-sqlite3` はネイティブモジュールです。`next.config.ts` の `serverExternalPackages` に加えてください。

### Express などの Node サーバー

```ts
import { toNodeHandler } from "@myaaaaa_chan/db-viewer-server/node";

// express.json() などの本文を読む処理より前のルートに置きます。
// 本文を読んだ後に渡すと、リクエストが 500 で失敗します。
app.post("/admin/db", toNodeHandler(handler));
```

`toNodeHandler` には、optional な peerDependencies の `@hono/node-server` と `hono` が要ります。

## オプション

### `createHandler`

| オプション                    | 説明                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| `connections`                 | `Record<string, DbAdapter>`。キーが UI に表示される接続名になる                         |
| `authorize`                   | **必須。** `(request: Request) => boolean \| Promise<boolean>`。`false` なら 401 を返す |
| `limits.maxRows`              | 1 回のクエリで返す行数。初期値 1000                                                     |
| `limits.statementTimeoutMs`   | 文のタイムアウト。初期値 30000。SQLite では効かない                                     |
| `limits.maxCellChars`         | ブラウザに送るセルの最大文字数。初期値 10000                                            |
| `limits.maxConcurrentQueries` | 接続ごとの同時実行数。超えると `busy` で断る。初期値 2                                  |

既定の上限は設計上の値で、計測はしていません。

### アダプター

| アダプター                        | オプション                                                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `postgresAdapter(pool, options?)` | `readOnly`（初期値 `true`）、`timeZone`（例: `"Asia/Tokyo"`）。`pg` 8.12 以上と `pg-cursor` 2.12 以上が要る |
| `sqliteAdapter(db, options?)`     | `readOnly`（初期値 `true`）。`better-sqlite3`、`node:sqlite`（Node.js 22.16 以上）、`bun:sqlite` を渡せる   |

`better-sqlite3` 13 は Node.js 22 以上でしか動きません。Node.js 20 では `better-sqlite3` 12 を使ってください。

### `<DbViewer>`

| props        | 説明                                                            |
| ------------ | --------------------------------------------------------------- |
| `dataSource` | 必須。たいていは `createHttpDataSource({ endpoint, headers? })` |
| `language`   | `"en"`（初期値）、`"ja"`、または `resources` で足した言語       |
| `resources`  | `Record<言語, 一部の文言>`。言語の追加や文言の上書き            |
| `theme`      | `"light"`、`"dark"`、`"system"`（初期値。OS の設定に追従）      |
| `className`  | ルート要素のクラス                                              |

`createHttpDataSource` は `endpoint`、任意の `headers: () => HeadersInit | Promise<HeadersInit>`（リクエストのたびに呼ぶ）、任意の `fetch` を受け取ります。

レイアウトを自分で組みたい場合は、`<DbViewerProvider>`、`<SchemaTree>`、`<TableView>`、`<SqlEditor>`、`<ResultGrid>` も使えます。`<DbViewerProvider>` の内側に置いてください。

## テーマと多言語化

色・フォント・角丸は `--dbv-*` の CSS 変数です。`.dbv-root` の上で上書きします。

```css
.dbv-root {
  --dbv-accent: #0f766e;
  --dbv-radius: 4px;
}
```

変数の定義は `:where()` で詳細度を 0 にしてあるので、`.dbv-root` の素のルールで勝てます。スタイルシートは CSS のレイヤーに入れていません。
組み込み先がクラスや属性でテーマを切り替えている場合は、`theme="light"` か `theme="dark"` を自分で渡してください。`theme="system"` は `prefers-color-scheme` だけを見ます。

```tsx
<DbViewer
  dataSource={dataSource}
  language="ja"
  resources={{ ja: { viewer: { sql: "SQL 実行" } } }}
/>;
```

状態はメモリの上にしか持ちません（`localStorage` は使いません）。ページを再読み込みすると、SQL エディタの内容は消えます。

## 開発

```sh
pnpm install
pnpm build        # パッケージと examples
pnpm test         # PostgreSQL のテストに Docker が要る（Testcontainers）
pnpm lint && pnpm typecheck
```

変更を次のリリースに載せるには、`pnpm changeset` で変更の説明を書きます。

## ライセンス

MIT
