---
paths:
  - "frontend-web/src/**/*.{ts,tsx}"
  - "frontend-web/e2e/**/*.ts"
  - "frontend-web/test/**/*.{ts,tsx}"
---

# TDD 実施ルール

このプロジェクトは TDD（テスト駆動開発）を必須とする。
実装コードを書く前に必ずテストを書き、失敗を確認してから実装する。

コマンドはすべて Web アプリのルート（`package.json` のある場所）で流す。
★ `package.json` に `test:run`（Node の単体テストだけ）・`test:browser`（ブラウザのコンポーネント・フックのテストだけ）・`typecheck`（`tsc --noEmit`）・`test:e2e`（`playwright test`）を用意する。

## テストの種類と置き場

| 種類 | 対象 | ツール・置き場 | スキル |
|---|---|---|---|
| 単体テスト | 純粋関数・ドメインロジック・reducer | Vitest。対象と同じディレクトリの `<name>.test.ts` | `vitest` |
| コンポーネント・フックのテスト | 自分で判断を持つ Client Component（状態ごとの出し分け・エラーの表示・押せる条件）と、ブラウザ API・時計・通信に触れるフック | Vitest の Browser Mode（Playwright の Chromium と WebKit）。対象と同じディレクトリの `<name>.browser.test.tsx`（フックだけなら `.browser.test.ts`）。共有の代役は `test/browser/` | `vitest`・`playwright-best-practices` |
| E2E テスト | 画面の操作の流れ・Route Handler を通した結果・外枠がすぐ出るか（`instant()`） | Playwright。`e2e/<画面>.spec.ts` | `playwright-best-practices`（`instant()` は `next-cache-components-optimizer`） |

- **ロジックは単体テストで網羅し、E2E は利用者の主な流れに絞る。** 分岐の組み合わせを E2E で網羅しない
- **コンポーネント・フックのテストは、その間を受け持つ。** 純粋関数に切り出せる判断は先に単体テストへ出し（`pure-function-io-separation.md`）、ここでは「画面が状態をどう出し分けるか」「ブラウザ API の知らせにフックがどう動くか」だけを確かめる
- **単体テストを書く・モックやカバレッジを設定するときは `Skill(vitest)` を呼ぶ**
- **`vitest.config.ts` を書く・直すときは `Skill(vite)` も呼ぶ。** Vitest は Vite の設定・プラグインで動く
  （Next.js のビルドは Vite ではないので、アプリ本体の設定には使わない）
- ★ **`import 'server-only'` のあるファイルは、そのままでは Vitest で import できない。** `vitest.config.ts` の
  `resolve.alias` で `server-only` を空のモジュールに向ける。テストごとの `vi.mock` で済ませない
- **パスエイリアス（`@/`）は `tsconfig.json` を正とし、`vitest.config.ts` に別の定義を書かない**（Vite の tsconfig の `paths` を読む仕組みで読ませる。書き方は `Skill(vite)` で確かめる）
- **E2E を書く・直す・不安定なテストを調べるときは `Skill(playwright-best-practices)` を呼ぶ**
- ★ **画面の変更が終わったら `Skill(playwright-cli)` で実際にブラウザを操作して確かめる。** テストが通っただけで完了にしない

## コンポーネント・フックのテストの書き方

- **対象は判断を持つものだけ。** 状態で出し分ける・押せる条件を決める・エラーの出し先を決める・ブラウザ API の知らせに応じて動く部品。
  スタイルや並べ方だけの部品は書かない。判断を持つ部品が親の中に埋もれて描画できないとき（サーバーでデータを読む親の中の分岐など）は、分岐を props で受ける小さな部品に切り出してから書く
- **Node の単体テストとブラウザのテストを、Vitest の `projects` で分ける。** ブラウザ側は `*.browser.test.{ts,tsx}` だけを拾い、Node 側はそれを除く
  （`<name>.browser.test.ts` は `*.test.ts` にも当たるので、Node 側の `exclude` が要る）。`test:run` は Node 側だけ、`test:browser` はブラウザ側だけを流す。
  どちらも直したら流す。ブラウザは一度だけ `playwright install chromium webkit` で入れる
- **ブラウザの設定は `Skill(vitest)` と公式ドキュメントで確かめて書く。** Browser Mode の書き方は版で変わり、スキルの例が古いことがある
  （プロバイダは `@vitest/browser-playwright` の `playwright()` を `provider` に渡し、ブラウザは `instances` に並べる）。
  `vitest` と `@vitest/browser-playwright` の版は同じにそろえる
- **描画は `vitest-browser-react` の `render`（フックは `renderHook`）、要素は `getByRole`・`getByLabelText`、確認は `expect.element`**（満たされるまで自動で待つ）。固定の待ち時間は使わない
- ★ **`toHaveTextContent` は完全一致。部分一致は `toMatchTextContent`。** 外れたときの待ちはテストの制限時間いっぱいなので、ブラウザ側の `testTimeout` を短く（5 秒ほど）する
- **本物のマイク・スピーカー・通信・時計に頼らない。** ブラウザ API は `vi.stubGlobal`・`vi.spyOn` で代役に替え、テストごとの後始末（`vi.unstubAllGlobals`・`vi.restoreAllMocks`・`vi.useRealTimers`）は setup ファイルに 1 度だけ書く。
  複数のテストで使う代役（fetch・音声・録音・音声認識など）は `test/browser/` に置く。代役は本物の非同期の順（停止の知らせが遅れて届く、など）をなぞる
- **時間は `vi.useFakeTimers({ toFake: [...] })` で、読む関数（`Date`・`setInterval` など）だけを替える。** 長い時間を進めるときは、まとめて進めてから後続の処理を流す（1 刻みずつ待つと遅い）
- **フレームワークの Router・Link はブラウザのテストの設定で代役に替える**（`resolve.alias`）。`vi.mock` は、依存が CJS だと Vite が default を取り出し直して壊れることがあった。
  CSS を読み込まないテストでは、毎フレーム描く canvas が自分の大きさで枠を押し広げ続け、Playwright が「安定しない」と待ち続ける。そうした描画の部品は、それを含む親のテストでは代役に替える（部品自身のテストでは枠の寸法だけ与える）
- **実行中に見つけた依存で Vite が事前バンドルをやり直すと、テストが途中で読み込み直される。** 警告が出たら `optimizeDeps.include` に足す
- ★ **テストを書いたら、対象の実装を一時的に壊して（分岐を消す、順番を逆にする）落ちることを確かめる。** 落ちないテストは何も守っていない

## 実装前に必ず行うこと

- `src/lib/` 以下のモジュールを新規作成・変更する場合は、
  先に**同じディレクトリ**に `<name>.test.ts` を用意する（例: `lib/<領域>/<name>.ts` ↔ `<name>.test.ts`）
- `pnpm vitest run <テストファイル>` を実行し、テストが **失敗する** ことを確認してから実装に進む
- 既存テストを壊す変更をする場合は、先にテストを更新してから実装を変更する
- 判断を持つ Client Component・フックを新しく作る・変える場合は、先に `<name>.browser.test.tsx` に失敗するテストを書く
- 画面の流れを新しく作る・変える場合は、先に `e2e/` に失敗する spec を書く。「E2E は後でまとめて書く」と後回しにしない（後回しにすると、画面の流れのテストが 1 本も無いまま次の画面に進んでしまう）
- ★ **テストを自動で流すフックは無い。** 直したら `pnpm test:run`・`pnpm typecheck`・`pnpm lint` を自分で流す。コンポーネント・フックを触ったら `pnpm test:browser`、画面を触ったら `pnpm test:e2e` も流す

## 外部 API のテスト

- **実 API をテストで呼ばない**（料金がかかる・結果が毎回変わる・ネットワークに依存する）
- アダプターのインターフェースに合わせた**インメモリ実装（フェイク）**を渡してテストする
- ★ **E2E では `page.route()` で外部 API を止められない。** 外部 API を呼ぶのはサーバー（Route Handler・Server Component）で、
  `page.route()` が横取りできるのはブラウザからのリクエストだけ。E2E 用のビルドでは、サーバー側のアダプターを環境変数でフェイクに差し替える
  （切り替えは `lib/env.ts` で検証し、本番の環境では有効にできないようにする）

## E2E テストの書き方

- **本番ビルド（`next build && next start`）に対して流す。** `next dev` の結果で合否を決めない
- **要素は役割と名前で探す**（`getByRole`・`getByLabel`）。CSS セレクタや DOM の構造に頼らない
- **`waitForTimeout()` で待たない。** `expect(...).toBeVisible()` などの自動で待つアサーションを使う
- **テストどうしで状態を共有しない。** 各テストが自分のデータを用意し、どの順で流しても通るようにする
- 認証が要る画面は、ログイン済みの状態（`storageState`）を setup の project で一度だけ作って使い回す

## 禁止事項

- テストを書かずに実装コードを追加すること（純粋関数・ドメインロジックの場合）
- 「後でテストを書く」という判断（後回し禁止）
- テストの失敗を確認しないまま Green フェーズに進むこと
- テストを削除・コメントアウトして実装を通すこと

## 各フェーズの完了条件

| フェーズ | 完了条件 |
|---|---|
| Red | 新しいテストが失敗し、既存テストはすべてパスしている |
| Green | 全テストがパスしている（実装は最小限） |
| Refactor | 全テストがパスしており、コードの重複・命名・構造が改善されている |
