---
paths:
  - "frontend-web/src/**/*.{ts,tsx}"
---

# 画面の置き場と UI / ロジック分離ルール

**Next.js のコードを書く・レビューするときは `Skill(next-best-practices)` を呼ぶ。**
★ スキルは書き込みに Server Actions を勧めるが、**このルールが優先する**（Server Actions は使わず Route Handler に揃える。下の「置き場」）。

## 置き場

パスはすべて Web アプリのルート（`package.json` のある場所）からの相対。

| 置き場 | 置くもの |
|---|---|
| `src/app/**/page.tsx` | **入口だけ。** `features/<画面>/<Name>Screen.tsx` を呼ぶ 1 行。`params`・`searchParams` はそのまま渡す |
| `src/app/api/**/route.ts` | **書き込み・ストリームの口。** 認証 → 入力の検証 → 認可 → `lib/` の呼び出し → レスポンス・ログ |
| `src/features/<画面>/<Name>Screen.tsx` | **その画面の入口の Server Component。** 静的な UI と `<Suspense>` の配置。動的な読み取りは下の部品に任せる（「画面の組み立て」） |
| `src/features/<画面>/` のその他 | **その画面でしか使わない** Client Component とフック。**平らに置く**（`hooks/` `components/` に分けない） |
| `src/components/` | **2 画面以上で使う**部品 |
| `src/lib/<領域>/` | 純粋関数・IO（repository / アダプター）・認証・そのテスト |

- **`features/` どうしで import しない。** 2 画面で要るようになったら `components/` か `lib/` へ移す
- **`components/`・`lib/` から `features/` を import しない**（共有の側は画面を知らない）
- **Server Actions（`'use server'`）は使わない。** 書き込みは Route Handler に揃え、外から呼べる口を `src/app/api/` だけにする
  （Server Action も実体は公開の POST エンドポイントだが、関数呼び出しに見えるため検証漏れが起きやすく、口の一覧も読み取りにくい）
- ★ この 3 つは import と `'use server'` を検査するテスト（`src/lib/architecture/srcBoundaries.test.ts`）で守り、
  `pnpm test:run` で落ちるようにする。まだ無ければ最初の画面を作るときに用意する

## 画面の組み立て

前提は **Next.js 16.3+ の Cache Components（`next.config.ts` の `cacheComponents: true`）**。
静的な外枠（static shell）をすぐ表示し、リクエストごとに決まる部分だけを後から流す。

```
app/<route>/page.tsx                → <<Name>Screen params={params} /> を返すだけ（params は await せず Promise のまま渡す）
features/<画面>/<Name>Screen.tsx    → Server Component。見出し・枠などの静的な UI を返し、動的な部分を <Suspense> で囲んで置く
features/<画面>/<Name>Content.tsx   → async の Server Component。requireUser()・params の await・repository の読み取り・Client Component へ props で渡す
features/<画面>/<Client部品>.tsx     → 'use client'。フックを呼び、JSX を返す
features/<画面>/use<Name>.ts        → 状態・副作用・Route Handler への通信・ブラウザ API
lib/<領域>/<name>.ts                → 純粋関数
```

- **`page.tsx` に state・effect・fetch・await・計算を書かない。** `layout.tsx`・`loading.tsx`・`error.tsx` も同じく薄く保つ
- **初期表示のデータは Server Component で読む。** Client Component の `useEffect` で取らない
- **リクエストごとに決まる読み取り（`cookies()`・`headers()`・`params`・`searchParams`・認証・キャッシュしない DB 読み取り）は、
  `<Name>Screen.tsx` の直下で await しない。** それを使う部品まで下げ、`<Suspense>` で囲む（上で await すると外枠ごと待たされる）
- **`<Suspense>` の fallback は、出来上がりと同じ寸法のスケルトンにする。** 空の fallback は、中身も見た目の場所を取らないときだけ
- **リクエストをまたいで使い回せる読み取りは `'use cache'` でキャッシュする。** 寿命は `cacheLife`、書き込み後の破棄は `cacheTag` と Route Handler からの `revalidateTag` / `updateTag` で決める。
  **`'use cache'` の中で `cookies()`・`headers()` を読まない。** ユーザーごとに変わる値は外で読み、`userId` などを引数で渡す（引数がキャッシュのキーになる）
- **画面を新しく作る・初期表示の遅さを直すときは `Skill(next-cache-components-optimizer)` を使う。**
  `@next/playwright` の `instant()` で「外枠がすぐ出る」ことを e2e テストにし、本番ビルドで確かめる
- **`'use client'` は操作の要る末端の部品だけに付ける。** `<Name>Screen.tsx` には付けない
- **Server Component から Client Component へ渡すのは、画面に要る値だけの直列化できるオブジェクト。** DB の行をそのまま渡さない（渡した値はブラウザに届く）

## ブラウザに送る JavaScript を増やさない

- **重いライブラリは `'use client'` のファイルから import しない。** 表示だけなら Server Component で描画して結果を渡す
- **操作されるまで要らない機能（モーダル・エディタ・グラフなど）は、`next/dynamic` か `import()` で操作したときに読み込む**
- **`'use client'` のファイルが import するものは、すべてブラウザへ送られる。** サーバー専用のコードは `server-only` で守る（`pure-function-io-separation.md`）
- **次のときは `Skill(next-bundle-optimizer)` を呼ぶ。** 初期表示が遅い・Client Component に大きな依存を足した・同じパッケージが重複していそう・サーバー専用のコードがブラウザに混ざっていないか確かめたい
  - 既定は**調べて報告するだけ**。コードを直すのは、直すと決めてから
  - 静的な外枠の表示の速さは `next-cache-components-optimizer`、こちらはブラウザに送る JS の量。目的で使い分ける

## UI とロジックの分離（Client Component）

状態管理・副作用・サーバーとの通信はカスタムフック（`features/<画面>/use<Name>.ts`）に置き、
Client Component に残すのは次だけにする。

- 純粋な UI state（入力値・開閉など）
- DOM ref（`useRef<HTMLElement>(null)`）
- イベントハンドラ（フックの関数を呼ぶだけのもの）
- JSX

| フック側に置く | コンポーネント側に置く |
|---|---|
| Route Handler への通信（fetch / SSE / WebSocket） | フォーム入力値 |
| ブラウザ API（メディア・音声・位置情報・ストレージなど） | DOM への ref |
| ドメインの state | ボタンなどのイベントハンドラ |
| ローディング・エラー状態・権限の状態 | JSX |

DOM 操作がデータ変化に連動するとき（一覧の自動スクロールなど）は、**ref をフックの引数で受け取り**、
操作をフックの中に閉じる（フックから ref を外へ返さない）。

## 禁止事項

- `page.tsx` にデータ読み取りや計算を書くこと（`features/<画面>/` の Server Component へ出す）
- 外枠を出すために、変わりうるデータをビルド時の import や定数に置き換えること（キャッシュするか、`<Suspense>` で流す）
- `export const instant = false` で検査を外すこと
- Client Component で `fetch` を直接呼ぶ／`useEffect` で初期表示のデータを取る
- `'use server'` を書くこと（Server Actions を使わない）
- 「後でフックに切り出す」という判断（後回し禁止）
