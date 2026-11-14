import type { DbResult, Dialect, SchemaName } from "@myaaaaa_chan/db-viewer-core";
import type { DbAdapter } from "../../adapter";
import type { Limits } from "../../limits";

/** テストごとに開く、空の DB（PostgreSQL では専用のスキーマ）とアダプターの組。 */
export type AdapterEnvironment = {
  readonly adapter: DbAdapter;
  /**
   * テストの表が入っているスキーマ。TableRef.schema にそのまま使う。
   * SQLite は "main"。PostgreSQL ではテストごとに作る専用のスキーマ。
   */
  readonly schema: SchemaName;
  /**
   * アダプターを通さずに、DB へ直接 SQL を流す（シードと、テスト中の状態の確認に使う）。
   * 表名は修飾しない。`schema` の中に作られ、読まれるようにする（PostgreSQL では search_path を合わせる）。
   */
  readonly exec: (sql: string) => Promise<void>;
  readonly close: () => Promise<void>;
};

export type OpenOptions = { readonly readOnly: boolean };

/** 方言に依らない共通テストに、後から差し込むテスト（PostgreSQL のタイムゾーン、中断など）。 */
export type AdapterCase = {
  readonly name: string;
  readonly run: (context: AdapterCaseContext) => Promise<void>;
};

export type AdapterCaseContext = {
  readonly dialect: Dialect;
  /** シード済みの環境を開く。後始末は共通テストが行う。 */
  readonly open: (options?: Partial<OpenOptions>) => Promise<AdapterEnvironment>;
  readonly limits: (overrides?: Partial<Limits>) => Limits;
};

export type AdapterHarness = {
  /** describe の名前に使う（例: "sqlite (better-sqlite3)"） */
  readonly name: string;
  readonly dialect: Dialect;
  /** テストごとに呼ばれる。空の DB を作り、アダプターを返す。シードは共通テストが exec で流す。 */
  readonly open: (options: OpenOptions) => Promise<AdapterEnvironment>;
  /** アダプターが宣言しているべき capabilities。宣言と、それに応じたテストの有無を揃えるために確かめる。 */
  readonly expectedCapabilities: DbAdapter["capabilities"];
  /**
   * 時間のかかる文（PostgreSQL なら `SELECT pg_sleep(5)`）。
   * 渡すと、同時実行数の上限（busy）の確認が、実際に重なる形になる。
   * capabilities.enforcesTimeout が true のアダプターでは、タイムアウトの確認にも必須。
   */
  readonly slowSql?: string;
  /** 方言ごとの追加テスト。共通テストの「方言固有」の中で流れる。 */
  readonly extraCases?: ReadonlyArray<AdapterCase>;
};

// 共通テストの中で、失敗の種類で判別する小さな補助。
export const errorKindOf = <T>(result: DbResult<T>): string =>
  result.ok ? "ok" : result.error.kind;
