---
paths:
  - "frontend-web/src/**/*.{ts,tsx}"
---

# 純粋関数・IO・副作用分離ルール

ビジネスロジックは純粋関数として実装し、IO・副作用はシステム境界に押し出す。
パスはすべて Web アプリのルート（`package.json` のある場所）からの相対。

## 純粋関数の原則

ロジック関数は以下の条件を満たすこと：

- 同じ引数に対して常に同じ結果を返す（決定論的）
- 関数の外部状態を変更しない（副作用なし）
- 引数以外の状態（グローバル変数・モジュールスコープ変数・`process.env`）を読まない

## IO の配置ルール

IO はリポジトリ・アダプターに閉じ込める。ドメインロジック関数の内部から直接 IO を呼ばない。

| IO の種類 | 配置先 |
|---|---|
| DB アクセス | `src/lib/<領域>/repository.ts` |
| 外部 API | `src/lib/<領域>/` のアダプター。**インターフェースは呼び出し側の `lib/` に置き、実装を差し替えられるようにする** |
| 環境変数 | `src/lib/env.ts` で起動時に一度だけスキーマで検証し、型の付いた値として引数で渡す。**秘密の値を `NEXT_PUBLIC_` に入れない** |
| 認証（ログイン中のユーザー） | `src/lib/auth/` の `requireUser()`。Route Handler と画面の Server Component が呼ぶ |
| 初期表示のデータ読み取り | 画面の Server Component（`ui-hook-separation.md`）から repository を呼ぶ |
| ブラウザ API | `src/features/<画面>/use<Name>.ts`（`ui-hook-separation.md`） |
| 画面からサーバーへの書き込み・ストリーム | フック → Route Handler（`src/app/api/**/route.ts`）。Server Actions は使わない |
| ログ出力 | Route Handler と画面の Server Component のみ |

### サーバー専用のコードを守る

- **repository・アダプター・`lib/env.ts`・`lib/auth/` の先頭に `import 'server-only'` を書く。**
  Client Component から誤って import するとビルドが落ち、秘密の値や DB 接続がブラウザ側へ漏れない

## 境界で行うこと（認証・検証・認可）

外から入る値は信用しない。**すべての `route.ts` は最初に次の順で処理し、通ったものだけを `lib/` へ渡す。**

1. **認証:** `requireUser()`。`proxy.ts`（Next.js 15 までの `middleware.ts`）だけに任せない（middleware を迂回された事例がある）
2. **入力の検証:** リクエストの body・`params`・`searchParams` をスキーマで検証する
3. **認可:** 対象のリソースが本人のものか。repository の読み取りは `userId` を引数に取り、条件に含める

画面の Server Component での読み取りも 1 と 3 を行う。

- **外部 API の応答（LLM の出力を含む）も外から入る値として扱う。** スキーマで検証してからドメインへ渡す
- **検証を通った ID はブランデッド型にする**（`UserId` など）。ドメインの関数は素の `string` を受け取らない

```typescript
// 悪い例：ロジック内で IO が混在
async function decide(id: ItemId): Promise<Decision> {
  const item = await itemRepo.find(id);  // 禁止
  return judge(item);
}

// 良い例：IO は route / repository で取り、純粋な関数へ渡す
const item = await itemRepo.find(user.id, id);  // IO（境界）。userId で認可
const decision = judge(item, now);              // 純粋
await itemRepo.save(user.id, decision);         // IO（境界）
```

## エラーの扱い

- **ドメインの関数は例外を投げず Result 型で返す。** 失敗の種類は判別可能な union 型で表す
- 例外から Result 型への変換と、Result 型から HTTP ステータスへの変換は境界（アダプター・`route.ts`）で行う

## 状態の表し方

- **画面やドメインの状態は判別可能な union 型で表し、遷移は純粋な reducer にする。**
  boolean のフラグを並べると、ありえない組み合わせ（読み込み中かつ失敗など）が作れてしまう

## 副作用の分離パターン

純粋な計算と副作用の実行を分けて、**計算 → 実行**の順に書く。`useEffect` の中でも同じ。

```typescript
const next = computeNextState(current, action);  // 純粋
await persistState(next);                        // 副作用
```

ブラウザ API も同じ。値の読み取りとタイマーだけをフックに置き、読み取った値の判定は純粋関数にする。

## 非決定的操作の扱い

`Date.now()` / `performance.now()` / `Math.random()` / `crypto.randomUUID()` はロジック関数の内部で呼ばず、**引数で受け取る**
（「今」を引数にすると、時間に依存する判定を固定の時刻でテストできる）。

## テスタビリティとの関係

純粋関数はモックなしで単体テストできる。テストは同じディレクトリの `<name>.test.ts` に置く（`tdd.md`）。
